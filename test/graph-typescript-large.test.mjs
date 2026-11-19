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
} from "../dist/graph/languages/typescript/index.js";
import { programBudget } from "../dist/graph/languages/typescript/project.js";
import { taintLimits } from "../dist/graph/languages/typescript/taint.js";

/**
 * Indexes `files` (twice when `twice` is set) and returns the report, the
 * stored files and every link with its text, line, outcome and target.
 */
async function indexFiles(files, { twice = false } = {}) {
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
        new LanguageRegistry([typescript]),
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
  const saved = programBudget.characters;
  // Budget: the small files fit, the large one does not.
  programBudget.characters = 2_000;
  try {
    const large = [
      "function onlyInLarge() {}",
      "function common() {}",
      "// " + "x".repeat(3_000),
      "",
    ].join("\n");
    const result = await indexFiles({
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
    });
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
  } finally {
    programBudget.characters = saved;
  }
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
// failed file.
const WITH_FAILED_FILE = {
  "broken.js": "const = ;\n",
  "lib.ts": "export function helper() {}\n",
  "use.ts": [
    'import { helper } from "./lib"; // import-helper',
    "helper(); // call-helper",
    'import { value } from "./broken.js"; // import-broken',
    "",
  ].join("\n"),
};

test("a program whose failed-file walk stays within its budget resolves as before", async () => {
  const result = await indexFiles(WITH_FAILED_FILE);
  assert.deepEqual(Object.keys(failedReasons(result)), ["broken.js"]);
  const call = linkOn(result, "use.ts", "// call-helper", "helper");
  assert.equal(call.resolution, "resolved");
  assert.equal(call.target, "lib.ts#helper");
  assert.ok(call.assumes.includes("no-unseen-declarations"));
  const broken = linkOn(result, "use.ts", "// import-broken", "value");
  assert.equal(broken.reason, "invalid-code");
});

test("a failed-file walk that reaches its budget leaves the program's links unresolved, never resolved", async () => {
  const saved = taintLimits.steps;
  taintLimits.steps = 1;
  try {
    const result = await indexFiles(WITH_FAILED_FILE);
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
    // A link already failed by the failed file keeps that reason.
    const broken = linkOn(result, "use.ts", "// import-broken", "value");
    assert.equal(broken.reason, "invalid-code");
    // A file whose program has no failed file needs no walk.
    const clean = await indexFiles({
      "lib.ts": "export function helper() {}\n",
      "use.ts": 'import { helper } from "./lib";\nhelper(); // call-helper\n',
    });
    const call = linkOn(clean, "use.ts", "// call-helper", "helper");
    assert.equal(call.target, "lib.ts#helper");
  } finally {
    taintLimits.steps = saved;
  }
});
