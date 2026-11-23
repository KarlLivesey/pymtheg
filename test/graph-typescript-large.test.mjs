// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
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
import { JUDGE_BOUND_REASON } from "../dist/graph/languages/typescript/judge.js";

/**
 * Indexes `files` (twice when `twice` is set) and returns the report, the
 * stored files and every link with its text, line, outcome and target.
 * `between` runs on the store between the two indexes.
 */
async function indexFiles(
  files,
  { twice = false, between, module: language = typescript } = {},
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
          cause: l.data?.cause ?? null,
          assumes: l.data?.assumes ?? [],
          target: l.resolution === "resolved" ? symbols.get(l.targetId) : null,
        };
      });
      return { report, stored, links };
    };
    const first = await read();
    if (!twice) return first;
    await between?.(store);
    return { first, second: await read() };
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

test("an invalid analysis range is contained to its file", async () => {
  const result = await indexFiles(
    {
      "bad.ts": "export function damaged() {}\ndamaged();",
      "use.ts": 'import { damaged } from "./bad";\ndamaged();',
      "good.ts": "export function healthy() {}\nhealthy(); // unaffected",
    },
    {
      module: typescriptModule({
        checkerFault(method, node) {
          if (
            method === "getSymbolAtLocation" &&
            node &&
            ts.isIdentifier(node) &&
            ts.isCallExpression(node.parent) &&
            node.getSourceFile().fileName === "/bad.ts"
          )
            node.end = 1_000_000;
        },
      }),
    },
  );
  assert.deepEqual(result.report.analysisErrors, []);
  assert.deepEqual(result.report.failed, ["bad.ts"]);
  assert.match(
    result.stored.get("bad.ts").result.diagnostics[0].message,
    /Invalid UTF-16 range/,
  );
  const entry = linkOn(result, "use.ts", "import", '"./bad"');
  assert.equal(entry.resolution, "unresolved");
  assert.equal(entry.reason, "target-unavailable");
  assert.equal(
    linkOn(result, "good.ts", "unaffected", "healthy").target,
    "good.ts#healthy",
  );
});
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

// A receiver that reaches a failed file only through other files' names.
const FAILED_AT_DEPTH = {
  "broken.ts": "export const conf = { run() {} };\nconst = ;\n",
  "dep.ts":
    'import { conf } from "./broken";\nexport function make() { return conf; }\n',
  "use.ts": 'import { make } from "./dep";\nmake().run(); // depth-call\n',
  "bad.ts": "export const thing = { m() {} };\nconst = ;\n",
  "mid.ts":
    'import { thing } from "./bad";\nexport const holder = { inner: thing };\n',
  "nested.ts":
    'import { holder } from "./mid";\nholder.inner.m(); // nested-call\n',
};
const depthLinks = (result) =>
  [
    ["use.ts", "// depth-call", "run"],
    ["nested.ts", "// nested-call", "m"],
  ].map(([file, marker, text]) => {
    const link = linkOn(result, file, marker, text);
    return [file, link.resolution, link.reason, link.cause];
  });

test("a receiver that reaches a failed file at depth keeps that cause within the walk's budget", async () => {
  const result = await indexFiles(FAILED_AT_DEPTH);
  assert.deepEqual(depthLinks(result), [
    [
      "use.ts",
      "unresolved",
      "invalid-code",
      { file: "broken.ts", via: "callee make; binding conf" },
    ],
    [
      "nested.ts",
      "unresolved",
      "invalid-code",
      { file: "bad.ts", via: "receiver holder; binding thing" },
    ],
  ]);
});

// Under a stopped walk the judge does not explore (C-26): the same links
// are unresolved without the cause. Links into the failed file itself keep
// theirs (the budget tests above).
test("a receiver that reaches a failed file at depth is taint-budget-exhausted when the walk stops", async () => {
  const result = await indexFiles(FAILED_AT_DEPTH, {
    module: typescriptModule({ taintSteps: 1 }),
  });
  assert.deepEqual(depthLinks(result), [
    ["use.ts", "unresolved", "taint-budget-exhausted", null],
    ["nested.ts", "unresolved", "taint-budget-exhausted", null],
  ]);
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

// C-47: reduced from oclif/core (MIT; test/fixtures/graph-typescript-judge-bound/LICENSE)
// after a seeded edit broke src/parser/index.ts. Judging `defaults.options`
// recurses through Arg, ArgParser, ArgParserContext and Command without end.
// On main the judge swallowed each stack overflow and went on, so the run
// could take an unbounded time.
async function fixtureFiles(name) {
  const root = new URL(`fixtures/${name}/`, import.meta.url);
  const files = {};
  const walk = async (dir) => {
    for (const entry of await readdir(new URL(dir, root), {
      withFileTypes: true,
    })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) await walk(`${path}/`);
      else if (entry.name !== "LICENSE")
        files[path] = await readFile(new URL(path, root), "utf8");
    }
  };
  await walk("");
  return files;
}

test(
  "a recursive generic type beside a failed file is judged once per binding; the judge's bound is the backstop",
  { timeout: 120_000 },
  async () => {
    const files = await fixtureFiles("graph-typescript-judge-bound");
    const bound = (result) =>
      result.links
        .filter((l) => l.cause?.via?.includes("judge-budget-exhausted"))
        .map((l) => [l.file, l.text, l.reason, l.cause.file]);
    // The cycle Arg -> ArgParser -> opts: P & Arg<T, P> -> Arg is cut by the
    // judgement's own cycle check: the link is judged, not bounded.
    const judged = await indexFiles(files);
    assert.deepEqual(Object.keys(failedReasons(judged)), [
      "src/parser/index.ts",
    ]);
    assert.deepEqual(bound(judged), []);
    const options = judged.links.find(
      (l) => l.file === "src/args.ts" && l.text === "defaults.options",
    );
    assert.equal(options.reason, "local");
    // With a budget of one step the same judgement stops at the bound and
    // fails the link with the bound as the reason.
    const stopped = await indexFiles(files, {
      module: typescriptModule({ judgeSteps: 1 }),
    });
    assert.ok(
      bound(stopped).some(
        ([file, text, reason, cause]) =>
          file === "src/args.ts" &&
          text === "defaults.options" &&
          reason === "invalid-code" &&
          cause === "src/parser/index.ts",
      ),
      JSON.stringify(bound(stopped)),
    );
    // The program-wide budget: once a program's judge has spent it, every
    // later judgement of that program stops at the same bound.
    const program = await indexFiles(files, {
      module: typescriptModule({ judgeProgramSteps: 1 }),
    });
    assert.deepEqual(
      bound(program).filter(
        ([file, text]) => file === "src/args.ts" && text === "defaults.options",
      ),
      [
        [
          "src/args.ts",
          "defaults.options",
          "invalid-code",
          "src/parser/index.ts",
        ],
      ],
    );
    // Every link a one-step budget per judgement bounds is bounded too (a
    // judgement answered from the memo costs no step there).
    const programBound = new Set(bound(program).map((row) => row.join("|")));
    for (const row of bound(stopped))
      assert.ok(programBound.has(row.join("|")), row.join(" "));
    // A second, independent index gives the same links.
    const again = await indexFiles(files, {
      module: typescriptModule({ judgeSteps: 1 }),
    });
    assert.deepEqual(
      again.links.map((l) => [l.file, l.text, l.resolution, l.reason, l.cause]),
      stopped.links.map((l) => [
        l.file,
        l.text,
        l.resolution,
        l.reason,
        l.cause,
      ]),
    );
  },
);

// C-47: a stack overflow at any point of the failed-file checks is never a
// clean answer. The injected overflow is placed on each lookup of `conf` in
// turn (the order of the module's checker calls is fixed).
test("a stack overflow in the failed-file checks never makes a link clean", async () => {
  const files = {
    "broken.ts": "export const conf = { run() {} };\nconst = ;\n",
    "dep.ts":
      'import { conf } from "./broken";\nexport function make() { return conf; }\n',
    "use.ts": 'import { make } from "./dep";\nmake().run(); // depth-call\n',
  };
  const outcomes = [];
  for (let k = 1; k <= 4; k++) {
    let seen = 0;
    const result = await indexFiles(files, {
      module: typescriptModule({
        checkerFault: (_method, node) => {
          if (
            node?.getSourceFile?.().fileName.endsWith("dep.ts") &&
            node.getText() === "conf" &&
            ++seen === k
          )
            throw new RangeError("Maximum call stack size exceeded");
        },
      }),
    });
    const run = linkOn(result, "use.ts", "// depth-call", "run");
    assert.equal(run.resolution, "unresolved", `overflow at lookup ${k}`);
    outcomes.push([k, run.reason, run.cause?.via ?? null]);
  }
  assert.deepEqual(outcomes, [
    [1, "taint-budget-exhausted", null],
    [
      2,
      "invalid-code",
      "callee make; the structural judgement reached its bound (judge-budget-exhausted)",
    ],
    [3, "invalid-code", "callee make; binding conf"],
    [4, "invalid-code", "callee make; binding conf"],
  ]);
});

// C-47 review: an overflow at any checker call on a receiver name, in the
// receiver's causes, its names, its member set or its judgement, is never
// an answer: the link keeps the answer it has without the overflow, or
// carries a bound (the walk unknown, the checker's stack at the link, or
// the judgement's bound), never a different answer.
const SITES = ["receiverCauses", "namesInReceiver", "structural", "judge"];
async function overflowAtEachCall(files, file, marker, name, onName) {
  const site = () => {
    for (const frame of new Error().stack.split("\n").slice(3)) {
      if (frame.includes("/judge.js")) return "judge";
      const fn = frame.trim().split(" ")[1];
      if (SITES.includes(fn)) return fn;
    }
    return "other";
  };
  const sites = [];
  const plain = await indexFiles(files, {
    module: typescriptModule({
      checkerFault: (_method, node) => {
        if (onName(node)) sites.push(site());
      },
    }),
  });
  const base = linkOn(plain, file, marker, name);
  const outcomes = [];
  for (let k = 1; k <= sites.length; k++) {
    let seen = 0;
    const result = await indexFiles(files, {
      module: typescriptModule({
        checkerFault: (_method, node) => {
          if (onName(node) && ++seen === k)
            throw new RangeError("Maximum call stack size exceeded");
        },
      }),
    });
    const link = linkOn(result, file, marker, name);
    outcomes.push([sites[k - 1], link.reason ?? null, link.cause?.via ?? null]);
    const same =
      link.resolution === base.resolution &&
      link.reason === base.reason &&
      link.target === base.target;
    const bound =
      link.resolution === "unresolved" &&
      (link.reason === "taint-budget-exhausted" ||
        link.reason === "compiler-limit" ||
        (link.reason === "invalid-code" &&
          link.cause?.via?.includes(JUDGE_BOUND_REASON)));
    assert.ok(
      same || bound,
      `overflow at call ${k} (${sites[k - 1]}): ${link.resolution} ${link.reason} ${link.cause?.via}`,
    );
  }
  return { base, outcomes };
}

test("a stack overflow at any checker call on a receiver never changes the member's answer", async () => {
  const shared = {
    "clean.ts": "export class CleanBase { run() {} }\n",
    "broken.ts":
      'import { CleanBase } from "./clean";\nexport class Base extends CleanBase {}\nexport const pick = 0;\nconst = ;\n',
    "dep.ts":
      'import { Base } from "./broken";\nexport class Kid extends Base {}\n',
  };
  const inUse = (text) => (node) =>
    node?.getSourceFile?.().fileName.endsWith("use.ts") &&
    node.getText() === text;
  // The reviewer's case: the receiver's causes, its member set and its
  // judgement.
  const member = await overflowAtEachCall(
    {
      ...shared,
      "use.ts":
        'import { Kid } from "./dep";\nconst k = new Kid();\nk.run(); // depth-member\n',
    },
    "use.ts",
    "// depth-member",
    "run",
    inUse("k"),
  );
  assert.equal(member.base.reason, "invalid-code");
  assert.deepEqual(member.outcomes, [
    [
      "other",
      "invalid-code",
      "member of Kid, whose member set reaches the failed file",
    ],
    ["other", "compiler-limit", null],
    ["other", "compiler-limit", null],
    ["other", "compiler-limit", null],
    [
      "receiverCauses",
      "invalid-code",
      "member of Kid, whose member set reaches the failed file",
    ],
    [
      "receiverCauses",
      "invalid-code",
      "member of Kid, whose member set reaches the failed file",
    ],
    ["judge", "invalid-code", `receiver k; ${JUDGE_BOUND_REASON}`],
    [
      "structural",
      "invalid-code",
      `the receiver's member set is unknown: ${JUDGE_BOUND_REASON}`,
    ],
  ]);
  // A name inside the receiver that its causes do not follow (an index).
  const names = await overflowAtEachCall(
    {
      ...shared,
      "use.ts":
        'import { CleanBase } from "./clean";\nimport { pick } from "./broken";\nconst list = [new CleanBase()];\nlist[pick].run(); // index-member\n',
    },
    "use.ts",
    "// index-member",
    "run",
    inUse("pick"),
  );
  assert.equal(names.base.reason, "invalid-code");
  assert.deepEqual(names.outcomes, [
    [
      "namesInReceiver",
      "invalid-code",
      `whether a name in the receiver is tainted is unknown: ${JUDGE_BOUND_REASON}; element access with a key that is not plainly clean`,
    ],
    [
      "judge",
      "invalid-code",
      `name pick in the receiver; ${JUDGE_BOUND_REASON}`,
    ],
  ]);
});

// C-47 review: the defect main has. An overloaded callee with an argument
// from the failed file fails the link, although the checker resolves the
// member to a clean class. An overflow in the judgement must not make the
// link resolved (main took it as a clean receiver).
test("a stack overflow in the judgement never makes a link definite", async () => {
  const files = {
    "clean.ts":
      "export class Clean { run() {} }\nexport class Other { run() {} }\n",
    "broken.ts": "export const bad = 1;\nconst = ;\n",
    "dep.ts": [
      'import { Clean, Other } from "./clean";',
      "export function pick(x: string): Clean;",
      "export function pick(x: number): Other;",
      "export function pick(x: unknown): Clean | Other {",
      "  return new Clean();",
      "}",
      "",
    ].join("\n"),
    "use.ts": [
      'import { bad } from "./broken";',
      'import { pick } from "./dep";',
      "pick(bad).run(); // overloaded",
      "",
    ].join("\n"),
  };
  const onBad = (node) =>
    node?.getSourceFile?.().fileName.endsWith("use.ts") &&
    node.getText() === "bad";
  let calls = 0;
  const plain = await indexFiles(files, {
    module: typescriptModule({
      checkerFault: (_method, node) => {
        if (onBad(node)) calls++;
      },
    }),
  });
  const base = linkOn(plain, "use.ts", "// overloaded", "run");
  assert.equal(base.reason, "invalid-code");
  assert.equal(base.target, null);
  assert.ok(calls > 0);
  for (let k = 1; k <= calls; k++) {
    let seen = 0;
    const result = await indexFiles(files, {
      module: typescriptModule({
        checkerFault: (_method, node) => {
          if (onBad(node) && ++seen === k)
            throw new RangeError("Maximum call stack size exceeded");
        },
      }),
    });
    const run = linkOn(result, "use.ts", "// overloaded", "run");
    assert.equal(run.resolution, "unresolved", `overflow at call ${k}`);
    assert.equal(run.target, null, `overflow at call ${k}`);
  }
});

// C-47 review: an expanding type (each level binds a larger value) never
// repeats a key; the second check of the same declaration checks only the
// values it names, so the judgement ends and is not cut by a bound.
test("an expanding generic type beside a failed file is judged, not bounded", async () => {
  const result = await indexFiles({
    "broken.ts": "export interface Bad { x: number }\nconst = ;\n",
    "use.ts": [
      'import type { Bad } from "./broken";',
      "type Builder<C> = {",
      "  add<K extends string>(k: K): Builder<{ prev: C; key: K }>;",
      "  ctx: C;",
      "  bad: Bad;",
      "};",
      "declare const b: Builder<{ n: number }>;",
      "declare function wrap<T>(x: { v: T }): T;",
      "wrap({ v: b }).ctx.n.toFixed(); // expanding",
      "",
    ].join("\n"),
  });
  const fixed = linkOn(result, "use.ts", "// expanding", "toFixed");
  assert.equal(fixed.reason, "invalid-code");
  assert.equal(fixed.cause?.file, "broken.ts");
  assert.ok(
    !fixed.cause.via.includes("judge-budget-exhausted"),
    fixed.cause.via,
  );
});

// C-47 review F1: a taint check that met a check in progress is provisional;
// memoising it made `x.a.v.go` depend on `r1.v.go` being judged first.
test("a taint answer that met a check in progress is not kept for later links", async () => {
  const result = await indexFiles({
    "broken.ts": "export interface Bad { go(): void }\nconst = ;\n",
    "box.ts": "export interface Box<T> { v: T }\n",
    "use.ts": [
      'import type { Bad } from "./broken";',
      'import type { Box } from "./box";',
      "type L<T> = { a: typeof holder; b: Bad; t: T };",
      'declare const holder: Box<L<string>["b"]>;',
      'declare const r1: Box<L<string>["b"]>;',
      "declare const x: L<string>;",
      "r1.v.go(); // first",
      "x.a.v.go(); // second",
      "",
    ].join("\n"),
  });
  for (const marker of ["// first", "// second"]) {
    const go = linkOn(result, "use.ts", marker, "go");
    assert.equal(go.resolution, "unresolved", marker);
    assert.equal(go.reason, "invalid-code", marker);
    assert.equal(go.cause?.file, "broken.ts", marker);
  }
});

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

// microsoft/TypeScript's moduleElementsInWrongContext.ts: a namespace inside
// a plain block is no symbol, but its members were linked to it as their
// container, and that one invalid link failed every file of the repository.
test("members of a namespace inside a block belong to the next container out", async () => {
  const result = await indexFiles({
    "block.ts":
      "{\n  export namespace N {\n    export interface I {}\n  }\n}\n",
    "other.ts":
      "function helper() {}\nhelper(); // unrelated-call\nexport {};\n",
  });
  assert.deepEqual(result.report.failed, []);
  const contains = result.links.filter(
    (l) => l.file === "block.ts" && l.kind === "contains",
  );
  assert.deepEqual(
    contains.map((l) => [l.text, l.resolution, l.target]),
    [["export interface I {}", "resolved", "block.ts#I"]],
  );
  assert.equal(
    linkOn(result, "other.ts", "unrelated-call", "helper").target,
    "other.ts#helper",
  );
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

// microsoft/TypeScript: every stored result carried the map of all 12,473
// failed files, about 52 GB as JSON across 27,190 results, which ran the
// indexer out of heap after analysis. A clean file's stored result must not
// grow with the number of failed files in its project.
test("a clean file's stored result does not grow with the number of failed files", async () => {
  const stored = async (failing) => {
    const files = { "clean.ts": "export function ok() {}\nok(); // ok-call\n" };
    for (let i = 0; i < failing; i++)
      files[`broken${String(i).padStart(3, "0")}.js`] = "const = ;\n";
    const result = await indexFiles(files);
    assert.equal(result.report.failed.length, failing);
    const ok = linkOn(result, "clean.ts", "// ok-call", "ok");
    assert.equal(ok.target, "clean.ts#ok");
    return JSON.stringify(result.stored.get("clean.ts").result).length;
  };
  assert.equal(await stored(200), await stored(2));
});

test("an unchanged re-index reuses stored results when files have failed", async () => {
  let reusedBefore;
  const { first, second } = await indexFiles(
    {
      "broken.js": "const = ;\n",
      "clean.ts": "export function ok() {}\nok(); // ok-call\n",
    },
    {
      twice: true,
      // Rewriting the failed file without its content marker makes the
      // core retry it; nothing else changed, so the module must reuse its
      // stored results instead of building a program.
      between: (store) => {
        store.replaceFile(store.files().find((f) => f.path === "broken.js"));
        reusedBefore = statistics.reused;
      },
    },
  );
  assert.equal(statistics.reused, reusedBefore + 1);
  for (const result of [first, second]) {
    assert.deepEqual(Object.keys(failedReasons(result)), ["broken.js"]);
    assert.equal(
      linkOn(result, "clean.ts", "// ok-call", "ok").target,
      "clean.ts#ok",
    );
  }
  assert.deepEqual(
    second.stored.get("clean.ts").result,
    first.stored.get("clean.ts").result,
  );
});
