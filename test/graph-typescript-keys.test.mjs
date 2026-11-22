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
    "[1].map(() => 1);",
    "[1].map(() => 1);",
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
    "[1].map(() => 1);",
    "export function f() { return [1].map(() => 1); }",
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
  const text = (list) => list.join("\n") + "\n";
  await withTree({ "x.ts": text(parts), "y.ts": consumer }, async (tree) => {
    await tree.index();
    await tree.equalsCold("first index");
    const steps = [
      [
        "insert a same-named sibling first",
        ["export interface Merged { c: 1 }", ...parts],
      ],
      ["insert an anonymous sibling first", ["[1].map(() => 1);", ...parts]],
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
