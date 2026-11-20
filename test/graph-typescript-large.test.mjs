// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { queryObjects } from "node:v8";
import ts from "typescript";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import typescript, {
  statistics,
  typescriptModule,
} from "../dist/graph/languages/typescript/index.js";

/**
 * Indexes `files` (twice when `twice` is set) and returns the report, the
 * stored files and every link with its text, line, outcome and target.
 */
async function indexFiles(
  files,
  { twice = false, module: language = typescript } = {},
) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-ts-large-"));
  const root = join(scratch, "project");
  const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "large");
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const read = async () => {
      const report = await indexProject(
        root,
        new LanguageRegistry([language]),
        store,
      );
      const symbols = new Map(
        store.findSymbols().map((s) => [s.id, `${s.file}#${s.identity}`]),
      );
      const stored = new Map(store.files().map((f) => [f.path, f]));
      const links = store.links().map((l) => {
        const text = stored.get(l.file).text;
        const lineStart = text.lastIndexOf("\n", l.range.start - 1) + 1;
        const lineEnd = text.indexOf("\n", l.range.start);
        return {
          file: l.file,
          kind: l.kind,
          text: text.slice(l.range.start, l.range.end),
          line: text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd),
          resolution: l.resolution,
          reason: l.data?.reason,
          assumes: l.data?.assumes ?? [],
          target: l.resolution === "resolved" ? symbols.get(l.targetId) : null,
        };
      });
      return { report, stored, links };
    };
    const first = await read();
    return twice ? { first, second: await read() } : first;
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
const linkOn = (result, file, marker, text) => {
  const found = result.links.filter(
    (l) =>
      l.file === file &&
      l.text === text &&
      l.kind !== "contains" &&
      l.line.includes(marker),
  );
  assert.equal(
    found.length,
    1,
    `one link ${text} on ${marker}; ${file} has ${JSON.stringify(
      result.links
        .filter((l) => l.file === file && l.kind !== "contains")
        .map((l) => [l.kind, l.text, l.resolution, l.reason ?? null]),
    )}`,
  );
  return found[0];
};
/** Each failed file with the first diagnostic of its stored result. */
const failedReasons = (result) =>
  Object.fromEntries(
    result.report.failed.map((path) => [
      path,
      result.stored.get(path).result.diagnostics[0]?.message,
    ]),
  );

// microsoft/TypeScript at the sweep pin: script files under tests/cases
// declare the same global enum in several files. Reading a member whose
// initialiser indexes a member declared in another file trips the
// compiler's assertion in evaluateElementAccessExpression. On main the
// exception failed every TS and JS file of the repository (27,194).
const MERGED_ENUM = {
  "a.ts": 'enum E { A = E["B"] }\n',
  "b.ts": "enum E { B = 1 }\n",
  "c.ts": "const v = { x: E.A }; // trips\n",
  "d.ts": ["function helper() {}", "helper(); // unrelated-call", ""].join(
    "\n",
  ),
  "src/lib.ts": "export function shared() {}\n",
  "src/use.ts": [
    'import { shared } from "./lib";',
    "shared(); // imported-call",
    "",
  ].join("\n"),
};

test("a compiler assertion fails only the file it was analysing, with the compiler's message", async () => {
  const { first, second } = await indexFiles(MERGED_ENUM, { twice: true });
  for (const result of [first, second]) {
    assert.deepEqual(failedReasons(result), {
      "c.ts":
        "The TypeScript compiler failed while analysing this file: Debug Failure. False expression.",
    });
    assert.equal(result.stored.get("c.ts").result.status, "failed");
    // Not a defect of pymtheg and not invalid code: never cached as content.
    assert.equal(result.stored.get("c.ts").result.failureKind, undefined);
    // The rest of the project is still analysed.
    for (const path of ["a.ts", "b.ts", "d.ts", "src/lib.ts", "src/use.ts"])
      assert.notEqual(result.stored.get(path).result.status, "failed", path);
    const unrelated = linkOn(result, "d.ts", "// unrelated-call", "helper");
    assert.equal(unrelated.resolution, "resolved");
    assert.equal(unrelated.target, "d.ts#helper");
    const imported = linkOn(result, "src/use.ts", "// imported-call", "shared");
    assert.equal(imported.resolution, "resolved");
    assert.equal(imported.target, "src/lib.ts#shared");
    // The program held a file it could not read: links say so.
    assert.ok(imported.assumes.includes("no-unseen-declarations"));
  }
});

// Each file the compiler throws on costs one rebuild of its program. A
// rebuild must not keep the programs before it alive: on swc and on the
// TypeScript repository (tens of thousands of files, dozens of rebuilds)
// that ran Node out of its default heap. The count of live checker types
// when each program is built (after a full collection) must not grow with
// the number of rebuilds.
test("rebuilding a program after a compiler exception releases the programs before it", async () => {
  const files = {
    "a.ts": 'enum E { A = E["B"] }\n',
    "b.ts": "enum E { B = 1 }\n",
  };
  for (let i = 0; i < 8; i++)
    files[`trip${String(i).padStart(2, "0")}.ts`] =
      `const trip${i} = { x: E.A };\n`;
  for (let i = 0; i < 10; i++)
    files[`src/m${i}.ts`] = Array.from(
      { length: 10 },
      (_, j) =>
        `export function f${i}_${j}(n: number): string { const value = n + ${j}; return String(value); }`,
    ).join("\n");
  const Type = ts.objectAllocator.getTypeConstructor();
  const live = [];
  let programs = statistics.programs;
  const descriptor = Object.getOwnPropertyDescriptor(statistics, "programs");
  Object.defineProperty(statistics, "programs", {
    configurable: true,
    enumerable: true,
    get: () => programs,
    set(value) {
      programs = value;
      live.push(queryObjects(Type, { format: "count" }));
    },
  });
  let result;
  try {
    result = await indexFiles(files);
  } finally {
    Object.defineProperty(statistics, "programs", {
      ...descriptor,
      value: programs,
    });
  }
  assert.equal(result.report.failed.length, 8);
  // One program, then a rebuild for each of the 8 files.
  assert.equal(live.length, 9);
  // Live types when the 2nd program is built (the 1st is then alive) and
  // when the 9th is: with every earlier program kept alive the count grows
  // by one program's worth per rebuild (8 times as many by the 9th).
  assert.ok(
    live[1] > 0 && live[8] < live[1] * 2,
    `live checker types by program: ${live.join(", ")}`,
  );
});

test("a global declared only in a file the compiler threw on is failed, never guessed", async () => {
  const result = await indexFiles({
    ...MERGED_ENUM,
    "c.ts": "const v = { x: E.A }; // trips\nfunction onlyInC() {}\n",
    "e.ts": "onlyInC(); // declared-in-failed\n",
  });
  assert.deepEqual(Object.keys(failedReasons(result)), ["c.ts"]);
  const link = linkOn(result, "e.ts", "// declared-in-failed", "onlyInC");
  assert.notEqual(link.resolution, "resolved");
  assert.equal(link.reason, "invalid-code");
});

// Vite at the sweep pin: playground/resolve/utf8-bom-package/package.json
// starts with a UTF-8 byte-order mark. On main its JSON.parse failed and
// with it every file of the package.
test("a package manifest that starts with a byte-order mark is read", async () => {
  const result = await indexFiles({
    "package.json": '{ "name": "root", "private": true }\n',
    "utf8-bom-package/package.json":
      '\uFEFF{\n  "name": "@vitejs/test-utf8-bom-package",\n  "private": true,\n  "version": "1.0.0",\n  "type": "module",\n  "exports": "./index.mjs"\n}\n',
    "utf8-bom-package/index.mjs": "export const msg = '[success]';\n",
    "utf8-bom-package/use.js": [
      'import { msg } from "./index.mjs"; // bom-package',
      "msg.length;",
      "",
    ].join("\n"),
    // A source file with a byte-order mark keeps its text and offsets.
    "utf8-bom-package/marked.js":
      '\uFEFFimport { msg } from "./index.mjs"; // marked-source\nmsg.length;\n',
  });
  assert.deepEqual(result.report.failed, []);
  const link = linkOn(
    result,
    "utf8-bom-package/use.js",
    "// bom-package",
    "msg",
  );
  assert.equal(link.resolution, "resolved");
  assert.equal(link.target, "utf8-bom-package/index.mjs#msg");
  const marked = result.stored.get("utf8-bom-package/marked.js");
  assert.ok(marked.text.startsWith("\uFEFFimport"));
  const fromMarked = linkOn(
    result,
    "utf8-bom-package/marked.js",
    "// marked-source",
    "msg",
  );
  assert.equal(fromMarked.target, "utf8-bom-package/index.mjs#msg");
});

test("a byte-order mark anywhere but the start still makes a manifest unreadable", async () => {
  const result = await indexFiles({
    "pkg/package.json": '{ "name": "pkg", \uFEFF"private": true }\n',
    "pkg/index.js": "export const value = 1;\n",
    "other.ts": "export const fine = 1;\n",
  });
  assert.deepEqual(Object.keys(failedReasons(result)), ["pkg/index.js"]);
  assert.match(
    failedReasons(result)["pkg/index.js"],
    /^Unreadable package manifest pkg\/package\.json: /,
  );
});

test("a project with more source than one program may hold leaves out its largest files, failed with the reason", async () => {
  // Budget: the small files fit, the large one does not.
  {
    const large = [
      "function onlyInLarge() {}",
      "function common() {}",
      "// " + "x".repeat(3_000),
      "",
    ].join("\n");
    const result = await indexFiles(
      {
        "large.js": large,
        "small.js": [
          "function common() {}",
          "function local() {}",
          "local(); // local-call",
          "common(); // also-in-large",
          "onlyInLarge(); // only-in-large",
          "",
        ].join("\n"),
        // A project of its own (a config) under the budget is untouched.
        "app/tsconfig.json": '{ "compilerOptions": { "strict": true } }\n',
        "app/main.ts": "export function run() {}\nrun(); // config-call\n",
      },
      { module: typescriptModule({ programCharacters: 2_000 }) },
    );
    assert.deepEqual(Object.keys(failedReasons(result)), ["large.js"]);
    assert.match(
      failedReasons(result)["large.js"],
      /^Not analysed: its TypeScript project \(the files no tsconfig or jsconfig includes\) holds 3,1\d\d characters of source, more than one compiler program is given \(2,000\); its largest files, this one \(3,0\d\d characters\) among them, are left out until the rest fits$/,
    );
    const local = linkOn(result, "small.js", "// local-call", "local");
    assert.equal(local.target, "small.js#local");
    assert.ok(local.assumes.includes("no-unseen-declarations"));
    // A name the left-out file declares: failed, never narrowed to the
    // one declaration that was read, nor left as an ordinary miss.
    const only = linkOn(result, "small.js", "// only-in-large", "onlyInLarge");
    assert.equal(only.resolution, "unresolved");
    assert.equal(only.reason, "invalid-code");
    const config = linkOn(result, "app/main.ts", "// config-call", "run");
    assert.equal(config.target, "app/main.ts#run");
    assert.deepEqual(config.assumes, []);
  }
});

test("the program budget counts the checkout files a program imports, not only its roots", async () => {
  // Two configured projects: p1 imports p2's file. Each project's roots are
  // within the budget; p1's program would load both.
  const big = [
    "export function bigThing() {}",
    "// " + "y".repeat(1_400),
    "",
  ].join("\n");
  const result = await indexFiles(
    {
      "p1/tsconfig.json": "{}\n",
      "p1/a.ts": [
        'import { bigThing } from "../p2/big"; // import-big',
        "bigThing(); // call-big",
        "export function own() {}",
        "own(); // call-own",
        "// " + "z".repeat(900),
        "",
      ].join("\n"),
      "p2/tsconfig.json": "{}\n",
      "p2/big.ts": big,
      "p2/use.ts":
        'import { bigThing } from "./big";\nbigThing(); // call-in-p2\n',
    },
    { module: typescriptModule({ programCharacters: 2_000 }) },
  );
  // Nothing fails: p2's own program reads big.ts.
  assert.deepEqual(result.report.failed, []);
  const inP2 = linkOn(result, "p2/use.ts", "// call-in-p2", "bigThing");
  assert.equal(inP2.target, "p2/big.ts#bigThing");
  // In p1's program big.ts was not loaded: links into it are never
  // definite, and the rest of the program is flagged.
  const call = linkOn(result, "p1/a.ts", "// call-big", "bigThing");
  assert.equal(call.resolution, "unresolved");
  assert.ok(call.reason, "an unresolved link always has a reason");
  const own = linkOn(result, "p1/a.ts", "// call-own", "own");
  assert.equal(own.target, "p1/a.ts#own");
  assert.ok(own.assumes.includes("no-unseen-declarations"));
});

test("a project within the budget is analysed whole", async () => {
  const result = await indexFiles({
    "large.js": "function onlyInLarge() {}\n// " + "x".repeat(3_000) + "\n",
    "small.js": "onlyInLarge(); // only-in-large\n",
  });
  assert.deepEqual(result.report.failed, []);
  const only = linkOn(result, "small.js", "// only-in-large", "onlyInLarge");
  assert.equal(only.target, "large.js#onlyInLarge");
  assert.deepEqual(only.assumes, []);
});

// A program with a failed file computes which links depend on it (taint.ts),
// walking every file. The walk has a step budget; when it is reached the
// answer is unknown, so links must not resolve as if nothing depended on the
// failed file. A link that binds the failed file directly still names it.
const WITH_FAILED_FILE = {
  "broken.js": "export function value() {}\nconst = ;\n",
  "lib.ts": "export function helper() {}\n",
  "use.ts": [
    'import { helper } from "./lib"; // import-helper',
    "helper(); // call-helper",
    'import { value } from "./broken.js"; // import-broken',
    "value(); // call-broken",
    'import * as b from "./broken.js"; // namespace-broken',
    "b.value(); // member-broken",
    "",
  ].join("\n"),
};
const brokenLinks = (result) =>
  [
    ["// import-broken", "value"],
    ["// call-broken", "value"],
    ["// member-broken", "value"],
  ].map(([marker, text]) => {
    const link = linkOn(result, "use.ts", marker, text);
    assert.equal(link.resolution, "unresolved", marker);
    assert.equal(link.reason, "invalid-code", marker);
    return marker;
  });

test("a program whose failed-file walk stays within its budget resolves as before", async () => {
  const result = await indexFiles(WITH_FAILED_FILE);
  assert.deepEqual(Object.keys(failedReasons(result)), ["broken.js"]);
  const call = linkOn(result, "use.ts", "// call-helper", "helper");
  assert.equal(call.resolution, "resolved");
  assert.equal(call.target, "lib.ts#helper");
  assert.ok(call.assumes.includes("no-unseen-declarations"));
  assert.equal(brokenLinks(result).length, 3);
});

for (const steps of [1, 5])
  test(`a failed-file walk that reaches its budget (${steps} steps) leaves the program's links unresolved, and links into the failed file keep their cause`, async () => {
    const result = await indexFiles(WITH_FAILED_FILE, {
      module: typescriptModule({ taintSteps: steps }),
    });
    // No file fails for the budget: the caller is still read.
    assert.deepEqual(Object.keys(failedReasons(result)), ["broken.js"]);
    for (const [marker, text] of [
      ["// call-helper", "helper"],
      ["// import-helper", "helper"],
    ]) {
      const link = linkOn(result, "use.ts", marker, text);
      assert.equal(link.resolution, "unresolved", marker);
      assert.equal(link.reason, "taint-budget-exhausted", marker);
      assert.equal(link.target, null, marker);
    }
    // Direct bindings of the failed file: failed with it as the cause.
    assert.equal(brokenLinks(result).length, 3);
  });

test("a program with no failed file needs no walk, whatever the budget", async () => {
  const clean = await indexFiles(
    {
      "lib.ts": "export function helper() {}\n",
      "use.ts": 'import { helper } from "./lib";\nhelper(); // call-helper\n',
    },
    { module: typescriptModule({ taintSteps: 1 }) },
  );
  const call = linkOn(clean, "use.ts", "// call-helper", "helper");
  assert.equal(call.target, "lib.ts#helper");
});

/** An exception that reads like the compiler's own assertion. */
const assertion = (what) => new Error(`Debug Failure. injected ${what}`);
const inFile = (node, path) => node?.getSourceFile().fileName === `/${path}`;
const fromTaint = () => new Error().stack.includes("/taint.js");
const fromExtraction = () => new Error().stack.includes("/extract.js");

test("an exception inside the failed-file walk is never read as a negative answer", async () => {
  let thrown = 0;
  const result = await indexFiles(
    {
      "broken.js": "const = ;\n",
      "d.ts": "export function make() {}\nexport const made = make();\n",
      "e.ts": 'import { made } from "./d"; // import-made\nmade;\n',
    },
    {
      module: typescriptModule({
        checkerFault: (method, node) => {
          if (
            method === "getSymbolAtLocation" &&
            inFile(node, "d.ts") &&
            fromTaint()
          ) {
            thrown++;
            throw assertion("taint");
          }
        },
      }),
    },
  );
  assert.ok(thrown > 0);
  // The file the walk was reading fails with the compiler's message.
  assert.equal(
    failedReasons(result)["d.ts"],
    "The TypeScript compiler failed while analysing this file: Debug Failure. injected taint",
  );
  const made = linkOn(result, "e.ts", "// import-made", "made");
  assert.equal(made.resolution, "unresolved");
  assert.ok(made.reason, "an unresolved link always has a reason");
});

test("a file the compiler throws on after files that used it were extracted fails everywhere, and those files are decided again", async () => {
  let cFailed = false;
  const files = {
    "a.ts": [
      "export class Other { foo() {} }",
      "export function mf(): Other { return new Other(); }",
      "export const mv = new Other();",
      "",
    ].join("\n"),
    "b.ts": [
      'import { mf, mv } from "./a"; // import-a',
      "mf(); // direct-call",
      "mf().foo(); // through-call",
      "mv.foo(); // through-value",
      "",
    ].join("\n"),
    "broken.js": "const = ;\n",
    "c.ts": "export function trips() {}\ntrips(); // trips\n",
  };
  const result = await indexFiles(files, {
    module: typescriptModule({
      checkerFault: (method, node) => {
        // First c.ts trips the compiler while it is extracted (after a.ts
        // and b.ts); after that,
        // the failed-file walk trips on a.ts, which was extracted already.
        if (
          !cFailed &&
          inFile(node, "c.ts") &&
          fromExtraction() &&
          !fromTaint()
        ) {
          cFailed = true;
          throw assertion("c");
        }
        if (cFailed && inFile(node, "a.ts") && fromTaint())
          throw assertion("a");
      },
    }),
  });
  const reasons = failedReasons(result);
  assert.equal(
    reasons["a.ts"],
    "The TypeScript compiler failed while analysing this file: Debug Failure. injected a",
  );
  assert.equal(
    reasons["c.ts"],
    "The TypeScript compiler failed while analysing this file: Debug Failure. injected c",
  );
  // b.ts was extracted before either failure: decided again, every link
  // through a.ts unresolved with a reason, none still resolved.
  for (const [marker, text] of [
    ["// direct-call", "mf"],
    ["// through-call", "foo"],
    ["// through-value", "foo"],
  ]) {
    const link = linkOn(result, "b.ts", marker, text);
    assert.equal(link.resolution, "unresolved", marker);
    assert.ok(link.reason, `${marker} has a reason`);
  }
});

test("exceptions in the syntax phase count toward the one cap on contained exceptions", async () => {
  const files = {};
  for (let i = 0; i < 105; i++)
    files[`f${String(i).padStart(3, "0")}.ts`] = `export const v${i} = ${i};\n`;
  const result = await indexFiles(files, {
    module: typescriptModule({
      syntaxFault: () => {
        throw assertion("syntax");
      },
    }),
  });
  const reasons = Object.values(failedReasons(result));
  assert.equal(reasons.length, 105);
  assert.equal(
    reasons.filter((reason) => reason.endsWith("injected syntax")).length,
    100,
  );
  assert.equal(
    reasons.filter((reason) => reason.endsWith("so the rest were not analysed"))
      .length,
    5,
  );
});

// microsoft/TypeScript's tests/cases/compiler/unreachableFlowAfterThrowing-
// ForHead1.ts, reduced: a `for` head of throwing, immediately invoked
// (generator) functions. The compiler's flow analysis of `console` in the
// body follows a cycle of flow nodes without a limit and never returns. The
// test is given a generous timeout only so that a regression fails instead
// of hanging the run; nothing is asserted about time.
const NON_RETURNING = {
  "loop.ts": [
    "for ((function () { throw 1; })(); (function* () { throw 2; })(); (function* () { throw 3; })()) {",
    '  console.log("x");',
    "}",
    "",
  ].join("\n"),
  "other.ts": "export function fine() {}\nfine(); // fine-call\n",
};

test(
  "a file whose flow analysis would not return fails with that reason, and the rest is read",
  { timeout: 120_000 },
  async () => {
    const result = await indexFiles(NON_RETURNING);
    assert.deepEqual(Object.keys(failedReasons(result)), ["loop.ts"]);
    assert.equal(
      failedReasons(result)["loop.ts"],
      "The TypeScript compiler failed while analysing this file: its control-flow analysis would not return (the compiler follows a cycle of flow nodes from line 1, column 1 without a limit)",
    );
    const fine = linkOn(result, "other.ts", "// fine-call", "fine");
    assert.equal(fine.target, "other.ts#fine");
  },
);

test("loops whose flow analysis returns are not failed", async () => {
  const result = await indexFiles({
    "update.ts":
      'for (let i = 0; i < 3; (function* () { throw 3; })()) {\n  console.log("x");\n}\n',
    "condition.ts":
      'for (let i = 0; (function* () { throw 2; })(); i++) {\n  console.log("x");\n}\n',
    "ordinary.ts": "for (let i = 0; i < 3; i++) {\n  console.log(i);\n}\n",
    "of.ts":
      "for (const x of (function* () { throw 1; })()) {\n  console.log(x);\n}\n",
    "body.ts":
      "for (let i = 0; i < 3; i++) {\n  (function () { throw 1; })();\n  console.log(i);\n}\n",
  });
  assert.deepEqual(result.report.failed, []);
});

test("a file the compiler throws on in a later project is failed for the store, and earlier projects that read it are decided again", async () => {
  const result = await indexFiles(
    {
      "a/tsconfig.json": "{}\n",
      "a/use.ts": [
        'import { shared } from "../b/x"; // import-shared',
        "shared(); // call-shared",
        "export function local() {}",
        "local(); // call-local",
        "",
      ].join("\n"),
      "b/tsconfig.json": "{}\n",
      "b/x.ts": "export function shared() {}\nshared();\n",
    },
    {
      module: typescriptModule({
        // b/x.ts trips the compiler when its own call on line 2 is read,
        // which only project b's extraction of it does; project a read the
        // file's declaration without trouble before.
        checkerFault: (method, node) => {
          if (
            inFile(node, "b/x.ts") &&
            fromExtraction() &&
            !fromTaint() &&
            node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
              .line === 1
          )
            throw assertion("x");
        },
      }),
    },
  );
  assert.deepEqual(failedReasons(result), {
    "b/x.ts":
      "The TypeScript compiler failed while analysing this file: Debug Failure. injected x",
  });
  for (const [marker, text] of [
    ["// import-shared", "shared"],
    ["// call-shared", "shared"],
  ]) {
    const link = linkOn(result, "a/use.ts", marker, text);
    assert.equal(link.resolution, "unresolved", marker);
    assert.equal(link.reason, "target-unavailable", marker);
  }
  const local = linkOn(result, "a/use.ts", "// call-local", "local");
  assert.equal(local.target, "a/use.ts#local");
  assert.ok(local.assumes.includes("no-unseen-declarations"));
});

test("the cap counts compiler failures a program imports from another project", async () => {
  const files = { "a/tsconfig.json": "{}\n", "b/tsconfig.json": "{}\n" };
  for (let i = 0; i < 60; i++)
    files[`a/f${String(i).padStart(2, "0")}.ts`] =
      `export const a${i} = ${i};\n`;
  // Each of b's 60 files imports one of a's: b's program loads all 60.
  for (let i = 0; i < 60; i++)
    files[`b/g${String(i).padStart(2, "0")}.ts`] =
      `import { a${i} } from "../a/f${String(i).padStart(2, "0")}";\nexport const b${i} = a${i};\n`;
  const result = await indexFiles(files, {
    module: typescriptModule({
      syntaxFault: () => {
        throw assertion("syntax");
      },
    }),
  });
  const reasons = failedReasons(result);
  const own = (prefix, ending) =>
    Object.entries(reasons).filter(
      ([path, reason]) => path.startsWith(prefix) && reason.endsWith(ending),
    ).length;
  assert.equal(own("a/", "injected syntax"), 60);
  // b's program loads the 60 failed a-files: with 40 of its own the cap of
  // 100 is reached, and b's other 20 files fail for the cap.
  assert.equal(own("b/", "injected syntax"), 40);
  assert.equal(own("b/", "so the rest were not analysed"), 20);
});
