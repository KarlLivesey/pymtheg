// SPDX-License-Identifier: MIT
// C-49: TypeScript symbol keys are name paths, not source offsets. A body
// edit leaves every other file's stored rows as they were; keys are unique
// within a file, and later same-named or anonymous siblings take `~n` in
// source order; after any edit (including inserting, removing and
// reordering such siblings) the store equals a cold index row for row.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import typescript from "../dist/graph/languages/typescript/index.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";

const registry = new LanguageRegistry([typescript]);

async function withTree(files, run) {
  const base = mkdtempSync(join(tmpdir(), "c49-keys-"));
  const root = join(base, "tree");
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  const database = join(base, "graph.sqlite");
  const store = new SqliteGraphStore(database);
  let colds = 0;
  const tree = {
    write,
    remove: (path) => rmSync(join(root, path)),
    store,
    database,
    index: () => indexProject(root, registry, store),
    rows: () => storeRows(database),
    /** A cold index of the tree must equal the incremental store. */
    async equalsCold(name) {
      const cold = join(base, `cold-${colds++}.sqlite`);
      const other = new SqliteGraphStore(cold, store.projectId);
      try {
        await indexProject(root, registry, other);
      } finally {
        other.close();
      }
      assert.deepEqual(
        compareRows(storeRows(database), storeRows(cold)),
        [],
        name,
      );
    },
  };
  try {
    await run(tree);
  } finally {
    store.close();
    rmSync(base, { recursive: true, force: true });
  }
}

const keysOf = (store, file) =>
  Object.fromEntries(
    store
      .findSymbols({ file })
      .map((symbol) => [
        `${symbol.kind} ${symbol.identity} ${symbol.ordinal}`,
        symbol.key,
      ])
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );

/**
 * The key property on every stored TypeScript symbol: unique within its
 * file, and its `~n` suffix the core's stored ordinal.
 */
function assertKeysAreOrdinals(store) {
  const seen = new Set();
  let numbered = 0;
  for (const symbol of store.findSymbols()) {
    if (symbol.module !== "typescript") continue;
    const unique = `${symbol.file}\0${symbol.key}`;
    assert.ok(
      !seen.has(unique),
      `duplicate key ${symbol.key} in ${symbol.file}`,
    );
    seen.add(unique);
    if (symbol.key === "module") continue;
    if (symbol.ordinal) numbered++;
    assert.equal(
      symbol.key,
      `${symbol.kind}:${symbol.identity}${symbol.ordinal ? `~${symbol.ordinal}` : ""}`,
      symbol.file,
    );
  }
  return numbered;
}

const lib = (body) =>
  [
    `export function first() { ${body} }`,
    "export function second() { return 2; }",
    "export const settings = { mode: 1, run() { return 3; } };",
    "export class Box { open() { return 4; } }",
    "export interface Shape { size: number }",
    "export type Alias = Shape;",
    "",
  ].join("\n");
const use = [
  'import { first, second, settings, Box, type Alias } from "./lib";',
  "export function main(shape: Alias) {",
  "  first(); second(); settings.run();",
  "  new Box().open();",
  "  return shape.size;",
  "}",
  "",
].join("\n");

test("a body edit leaves the other files' stored rows and the file's other keys as they were", async () => {
  await withTree(
    { "lib.ts": lib("return 1;"), "use.ts": use },
    async (tree) => {
      await tree.index();
      const targets = tree.store
        .links()
        .filter((link) => link.file === "use.ts")
        .flatMap((link) => link.data?.targets ?? []);
      assert.ok(targets.length >= 6, "use.ts links name targets in lib.ts");
      for (const target of targets)
        assert.doesNotMatch(target.key, /@\d+$/, "no target key is an offset");
      const before = tree.rows();
      const keys = keysOf(tree.store, "lib.ts");
      tree.write(
        "lib.ts",
        lib("const padding = [1, 2, 3, 4, 5, 6, 7, 8]; return padding.length;"),
      );
      await tree.index();
      const after = tree.rows();
      const outside = (rows) => ({
        files: rows.graph_files.filter(
          (row) => JSON.parse(row).path !== "lib.ts",
        ),
        links: rows.graph_links.filter(
          (row) => JSON.parse(row).file !== "lib.ts",
        ),
      });
      assert.deepEqual(outside(after), outside(before));
      const now = keysOf(tree.store, "lib.ts");
      for (const name of Object.keys(now))
        if (!(name in keys)) {
          assert.match(name, /padding/, "the new local is the only new symbol");
          delete now[name];
        }
      assert.deepEqual(now, keys);
      await tree.equalsCold("after the body edit");
    },
  );
});

test("keys are unique name paths; later same-named and anonymous siblings take ~n in source order", async () => {
  const source = [
    "interface Merged { a: 1 }",
    "interface Merged { b: 1 }",
    "namespace Space { export const v = 1; }",
    "namespace Space { export const w = 1; }",
    "declare const flag: boolean;",
    "declare function describe(name: string, body: () => void): void;",
    "export function host() {",
    '  describe("same", () => { const helper = () => 1; });',
    '  describe("same", () => { const helper = () => 2; });',
    "  if (flag) { const inner = () => 1; }",
    "  if (flag) { const inner = () => 2; }",
    "}",
    "export default function () { return { x: 1, x2: { y: 1 } }; }",
    "",
  ].join("\n");
  await withTree({ "x.ts": source }, async (tree) => {
    await tree.index();
    const symbols = tree.store.findSymbols({ file: "x.ts" });
    const keys = symbols.map((symbol) => symbol.key);
    assert.equal(new Set(keys).size, keys.length, "unique within the file");
    for (const key of keys) assert.doesNotMatch(key, /@\d+$/);
    assert.ok(keys.includes("module"));
    const merged = symbols
      .filter((symbol) => symbol.identity === "Merged")
      .sort((a, b) => a.range.start - b.range.start)
      .map((symbol) => [symbol.key, symbol.ordinal]);
    assert.deepEqual(merged, [
      ["interface:Merged", 0],
      ["interface:Merged~1", 1],
    ]);
    // Anonymous-scoped siblings: the same local in two identical callbacks
    // and in two identical blocks.
    for (const name of ["helper", "inner"]) {
      const same = symbols
        .filter((symbol) => symbol.name === name)
        .sort((a, b) => a.range.start - b.range.start);
      assert.equal(same.length, 2, name);
      assert.equal(same[0].identity, same[1].identity, name);
      assert.deepEqual(
        same.map((symbol) => [symbol.key.endsWith("~1"), symbol.ordinal]),
        [
          [false, 0],
          [true, 1],
        ],
        name,
      );
    }
    // Each key's ordinal suffix is the core's ordinal of that symbol.
    for (const symbol of symbols)
      if (symbol.key !== "module")
        assert.equal(
          symbol.key,
          `${symbol.kind}:${symbol.identity}${symbol.ordinal ? `~${symbol.ordinal}` : ""}`,
        );
  });
});

test("inserting, removing and reordering same-named and anonymous siblings equals cold after every re-index", async () => {
  const parts = [
    "export interface Merged { a: 1 }",
    'export function g() { describe("same", () => { const helper = () => 1; }); }',
    "export function f() { if (flag) { const inner = () => 1; } if (flag) { const inner = () => 2; } return 1; }",
    "export interface Merged { b: 1 }",
    "export default class { m() { return { k: 1 }; } }",
    "export const o = { k: 1, n() { return 1; } };",
    "export function f2() { return f(); }",
  ];
  const consumer = [
    'import Anonymous, { f, f2, o, type Merged } from "./x";',
    "export const value: Merged = { a: 1, b: 1 };",
    "f(); f2(); o.n(); new Anonymous().m();",
    "",
  ].join("\n");
  const prefix =
    "declare const flag: boolean;\ndeclare function describe(name: string, body: () => void): void;\n";
  const text = (list) => prefix + list.join("\n") + "\n";
  await withTree({ "x.ts": text(parts), "y.ts": consumer }, async (tree) => {
    await tree.index();
    await tree.equalsCold("first index");
    const steps = [
      [
        "insert a same-named sibling first",
        ["export interface Merged { c: 1 }", ...parts],
      ],
      [
        "insert an anonymous sibling first",
        [
          parts[0],
          'export function g() { describe("same", () => { const helper = () => 3; }); describe("same", () => { const helper = () => 1; }); }',
          ...parts.slice(2),
        ],
      ],
      ["remove the first same-named sibling", parts.filter((_, i) => i !== 0)],
      ["remove the first anonymous sibling", parts.filter((_, i) => i !== 1)],
      [
        "reorder same-named siblings",
        [parts[3], parts[1], parts[2], parts[0], ...parts.slice(4)],
      ],
      [
        "reorder anonymous siblings",
        [parts[0], parts[2], parts[1], ...parts.slice(3)],
      ],
      ["duplicate a function", [...parts, parts[2]]],
      ["back to the start", parts],
    ];
    for (const [name, list] of steps) {
      tree.write("x.ts", text(list));
      await tree.index();
      await tree.equalsCold(name);
      assertKeysAreOrdinals(tree.store);
    }
  });
});

test("a file in two programs has the same keys, and links from both resolve to it", async () => {
  await withTree(
    {
      "shared/lib.ts": lib("return 1;"),
      "a/use.ts": use.replace('"./lib"', '"../shared/lib"'),
      "b/use.ts": use.replace('"./lib"', '"../shared/lib"'),
      "a/tsconfig.json": JSON.stringify({
        include: ["*.ts", "../shared/*.ts"],
      }),
      "b/tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true },
        include: ["*.ts", "../shared/*.ts"],
      }),
    },
    async (tree) => {
      await tree.index();
      const symbols = tree.store.findSymbols({ file: "shared/lib.ts" });
      const ids = new Map(symbols.map((symbol) => [symbol.key, symbol.id]));
      const resolved = (file) =>
        tree.store
          .links()
          .filter((link) => link.file === file && link.kind === "calls")
          .map((link) => {
            assert.equal(
              link.resolution,
              "resolved",
              `${file} ${link.targetName}`,
            );
            for (const target of link.data?.targets ?? [])
              if (target.file === "shared/lib.ts")
                assert.ok(ids.has(target.key), `${target.key} names a symbol`);
            return link.targetId;
          })
          .sort();
      assert.deepEqual(resolved("a/use.ts"), resolved("b/use.ts"));
      await tree.equalsCold("two programs");
    },
  );
});

test("a renamed JavaScript file numbers its keys by the restored names, and stays clean", async () => {
  await withTree(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { allowJs: true },
        include: ["src"],
      }),
      "src/r.js": [
        "function require(name) { return name; }",
        "exports.require = function () { return 1; };",
        'exports.other = function () { return require("x"); };',
        "",
      ].join("\n"),
      "src/ruse.js": 'const r = require("./r"); r.require(); r.other();\n',
      "src/other.ts": "export const unrelated = 1;\n",
    },
    async (tree) => {
      const report = await tree.index();
      assert.deepEqual(report.analysisErrors, []);
      for (const file of tree.store.files())
        assert.equal(file.result.status, "clean", file.path);
      const named = tree.store
        .findSymbols({ file: "src/r.js" })
        .filter((symbol) => symbol.identity === "require")
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((symbol) => [symbol.kind, symbol.key, symbol.ordinal]);
      assert.deepEqual(named, [
        ["function", "function:require", 0],
        ["function", "function:require~1", 1],
      ]);
      assertKeysAreOrdinals(tree.store);
      await tree.equalsCold("renamed");
    },
  );
});

test("on a mixed corpus every key is unique in its file and its ~n is the stored ordinal", async () => {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { allowJs: true, checkJs: true },
      include: ["src"],
    }),
    "src/cjs.js": [
      "const module = { id: 1 };",
      "function exports() { return module.id; }",
      "function require(name) { return name; }",
      "exports.require = function () { return require('a'); };",
      "module.exports.module = function () { return 2; };",
      "",
    ].join("\n"),
    "src/merged.ts": [
      "interface M { a: 1 }",
      "interface M { b: 1 }",
      "interface M { c: 1 }",
      "namespace N { export const x = 1; }",
      "namespace N { export const y = 1; }",
      "function over(a: string): void;",
      "function over(a: number): void;",
      "function over(a: unknown) {}",
      "export const objects = { k: 1, ['k']: 2, n: { k: 3 } };",
      "",
    ].join("\n"),
    "src/scopes.ts": [
      "declare const flag: boolean;",
      "declare function describe(name: string, body: () => void): void;",
      "export function host() {",
      ...Array.from(
        { length: 3 },
        (_, i) =>
          `describe("same", () => { const helper = () => ${i}; function inner() { return ${i}; } });`,
      ),
      ...Array.from(
        { length: 3 },
        (_, i) => `if (flag) { const local = () => ${i}; }`,
      ),
      "}",
      "export default class { m() { return { k: 1 }; } m2() { return { k: 2 }; } }",
      "",
    ].join("\n"),
  };
  await withTree(files, async (tree) => {
    await tree.index();
    for (const file of tree.store.files())
      assert.notEqual(file.result.status, "failed", file.path);
    assert.ok(assertKeysAreOrdinals(tree.store) >= 6, "siblings were numbered");
  });
});

// C-60: a hashed scope part (`[callback:…]`, `[block:…]`, `[case:…]`) is a
// hash of the restored text. A locally bound `require`, `module` or
// `exports` reaches the compiler under a fresh name that depends on every
// captured file's text, so before C-60 an edit to an unrelated file (one
// that contains `requirf`, the first fresh name) changed these keys.
test("an unrelated edit leaves the keys, identities and ids of a renamed file's scoped symbols as they were", async () => {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { allowJs: true, noEmit: true },
      include: ["**/*"],
    }),
    "amd.js": [
      "define(function (require, exports, module) {",
      "  function helper() { return 1; }",
      "  exports.run = function () { return helper(); };",
      "});",
      "",
    ].join("\n"),
    "lib.cjs": [
      "function take(v, cb) { return cb(v); }",
      "function outer(require) { return take(require, () => { function inner() { return 1; } return inner(); }); }",
      "exports.outer = outer;",
      "",
    ].join("\n"),
    "use.ts": 'import { outer } from "./lib.cjs";\nouter(1);\n',
    "other.ts": "export const other = 1;\n",
  };
  const scoped = (store) =>
    store
      .findSymbols()
      .filter((s) => ["amd.js", "lib.cjs"].includes(s.file))
      .map((s) => `${s.file} ${s.key} ${s.identity} ${s.id}`)
      .sort();
  await withTree(files, async (tree) => {
    await tree.index();
    const before = scoped(tree.store);
    assert.ok(
      before.some((row) => row.includes("[callback:")),
      before.join("\n"),
    );
    tree.write("other.ts", "export const requirf = 1;\n");
    await tree.index();
    assert.deepEqual(scoped(tree.store), before);
    await tree.equalsCold("after the unrelated edit");
  });
});

// C-60 review: a name next to an escape. Serialised first, `enabled &&\n
// require` became `enabled &&\\nrequire`, and the restore did not see the
// fresh name after `\n`. Each text part is restored before it is
// serialised. Every hashed part kind: a block, a callback, a case, and a
// conditional and a logical member.
const MULTILINE = [
  "function take(v, cb) { return cb(v); }",
  "function outer(require, enabled, x, module) {",
  "  if (enabled &&",
  "require) { function branchHelper() { return 1; } branchHelper(); }",
  "  take(1, (v = enabled &&",
  "require) => { function callbackHelper() { return v; } return callbackHelper(); });",
  "  switch (x) { case enabled &&",
  "require: { function caseHelper() { return 2; } caseHelper(); } }",
  "  const picked = (enabled &&",
  'require) ? { conditional() { return "\\n"; } } : {};',
  "  const either = (enabled &&",
  "require) || { logical() { return 3; } };",
  '  if (typeof module === "object" &&',
  "\t\tmodule.exports) { function umdHelper() { return 4; } umdHelper(); }",
  "  switch (x) { case x &&",
  "\t\trequire.main: { function mainHelper() { return 5; } mainHelper(); } }",
  "  return [picked, either];",
  "}",
  "exports.outer = outer;",
  "",
].join("\n");
const scopedRows = (store, files) =>
  store
    .findSymbols()
    .filter((s) => files.includes(s.file))
    .map((s) => `${s.file} ${s.key} ${s.identity} ${s.id}`)
    .sort();
const renamedTree = (files) => ({
  "tsconfig.json": JSON.stringify({
    compilerOptions: { allowJs: true, noEmit: true },
    include: ["**/*"],
  }),
  "other.ts": "export const other = 1;\n",
  ...files,
});

test("multi-line scope text keeps its keys when the fresh name changes, for every hashed part kind", async () => {
  await withTree(renamedTree({ "lib.cjs": MULTILINE }), async (tree) => {
    await tree.index();
    const before = scopedRows(tree.store, ["lib.cjs"]);
    for (const name of [
      "branchHelper",
      "callbackHelper",
      "caseHelper",
      "conditional",
      "logical",
      "umdHelper",
      "mainHelper",
    ])
      assert.ok(
        before.some((row) => row.includes(name)),
        `${name}: ${before.join("\n")}`,
      );
    tree.write("other.ts", "export const requirf = 1;\n");
    await tree.index();
    assert.deepEqual(scopedRows(tree.store, ["lib.cjs"]), before);
    await tree.equalsCold("after the unrelated edit");
  });
});

test("for scope texts with the bound names beside escapes, quotes and unicode, a changed fresh name changes no key", async () => {
  // A seeded generator: the same cases on every run.
  let seed = 60;
  const next = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  const operands = [
    "require",
    "module",
    "exports",
    '"\\n"',
    "'\\''",
    '"\\""',
    '"\\\\"',
    '"é😀"',
    "`a${require}b`",
  ];
  const operators = [" && ", " +\n", "\n&& ", " + ", " ||\n", " &&\n\t\t"];
  for (let round = 0; round < 12; round++) {
    // Always a bound name, then operands with operators between them.
    let expression = "require";
    for (let i = 0, n = 3 + next(5); i < n; i++)
      expression +=
        operators[next(operators.length)] + operands[next(operands.length)];
    const text = [
      "function outer(require, module, exports) {",
      `  if ((${expression})) { function helper() { return 1; } helper(); }`,
      `  [1].map((v = (${expression})) => { function inner() { return v; } return inner(); });`,
      "}",
      "exports.outer = outer;",
      "",
    ].join("\n");
    await withTree(renamedTree({ "lib.cjs": text }), async (tree) => {
      await tree.index();
      const before = scopedRows(tree.store, ["lib.cjs"]);
      assert.ok(
        before.some((row) => row.includes("[block:")),
        `${round}: ${text}\n${before.join("\n")}`,
      );
      tree.write("other.ts", "export const requirf = 1;\n");
      await tree.index();
      assert.deepEqual(
        scopedRows(tree.store, ["lib.cjs"]),
        before,
        `${round}: ${text}`,
      );
    });
  }
});

// C-60 review: the module version moves with the keys, so a store written
// by an earlier version is rebuilt, never reused with its old keys. The
// store here is made to look so: its TypeScript rows carry version 49, and
// one symbol row differs as main's keys did.
test("a store written by the previous TypeScript module version is rebuilt and equals a cold index", async () => {
  await withTree(renamedTree({ "lib.cjs": MULTILINE }), async (tree) => {
    await tree.index();
    const db = new DatabaseSync(tree.database);
    try {
      // The current version's leading number, and the one before it.
      const current = /"version":"(\d+)\+typescript-/.exec(
        db
          .prepare("SELECT body FROM graph_files WHERE path='lib.cjs'")
          .get().body,
      )[1];
      const previous = String(Number(current) - 1);
      const changed = db
        .prepare(
          "UPDATE graph_files SET body=replace(body, ?, ?) WHERE instr(body, ?) > 0",
        )
        .run(
          `"version":"${current}+typescript-`,
          `"version":"${previous}+typescript-`,
          `"version":"${current}+typescript-`,
        ).changes;
      assert.ok(changed > 0, `TypeScript rows at version ${current}`);
      db.prepare(
        "UPDATE graph_symbols SET body=replace(body, '\"identity\":\"', '\"identity\":\"old.') WHERE rowid=(SELECT min(rowid) FROM graph_symbols WHERE file='lib.cjs')",
      ).run();
    } finally {
      db.close();
    }
    await tree.index();
    await tree.equalsCold("rebuilt");
  });
});
