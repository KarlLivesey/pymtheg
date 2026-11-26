// SPDX-License-Identifier: MIT
// C-56a: Go's analysis notes pass names symbols by the ids the store gives
// them (kind, identity, ordinal), never by a source offset. A body edit
// leaves every other symbol's id as it was; Go's overloaded-looking shapes
// get distinct ids; the stored graph equals a cold index.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import go from "../dist/graph/languages/go/index.js";
import { notesSymbols } from "../dist/graph/languages/go/resolve.js";

const registry = new LanguageRegistry([go]);
// Every shape the review named: methods of one name on different
// receivers, several init functions in one file and across files, blank
// declarations, same-named locals in one function, generic type parameters,
// fields of anonymous structs, and build-tag twins declaring one name.
const files = {
  "go.mod": "module example.com/m\n\ngo 1.22\n",
  "p/a.go": [
    "package p",
    "",
    "type A struct{}",
    "type B struct{}",
    "func (A) Run() int { return 1 }",
    "func (B) Run() int { return 2 }",
    "func init() {}",
    "func init() {}",
    "var _ = 1",
    "var _ = 2",
    "func _() {}",
    "func Locals() int {",
    "\tx := 1",
    "\t{ x := 2; _ = x }",
    "\tfunc() { x := 3; _ = x }()",
    "\treturn x",
    "}",
    "type Box[T any, U comparable] struct{ v T; u U }",
    "func Map[T, U any](t T, f func(T) U) U { return f(t) }",
    "var Anon = struct{ A int; B struct{ A int } }{}",
    "var Anon2 = struct{ A int }{}",
    "",
  ].join("\n"),
  "p/b.go": "package p\n\nfunc init() {}\nfunc init() {}\n",
  "p/os_linux.go":
    "//go:build linux\n\npackage p\n\nfunc Twin() int { return 1 }\n",
  "p/os_windows.go":
    "//go:build windows\n\npackage p\n\nfunc Twin() int { return 2 }\n",
};

function tree() {
  const base = mkdtempSync(join(tmpdir(), "c56a-"));
  const root = join(base, "tree");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { base, root };
}

test("Go's overloaded-looking shapes get distinct notes ids, the ones the store gives", async () => {
  const { base, root } = tree();
  const store = new SqliteGraphStore(join(base, "graph.sqlite"));
  try {
    await indexProject(root, registry, store);
    for (const file of store.files()) {
      if (file.module !== "go" || file.result.status === "failed") continue;
      const named = notesSymbols(file);
      const ids = named.map((symbol) => symbol.id);
      assert.equal(new Set(ids).size, ids.length, `distinct in ${file.path}`);
      for (const id of ids) assert.doesNotMatch(id, /^draft:/);
      // Each symbol gets the store's own ordinal, matched by key, and the id
      // the core builds from it (under the notes pass's project id).
      const stored = new Map(
        store
          .findSymbols({ file: file.path })
          .map((symbol) => [symbol.key, symbol]),
      );
      for (const symbol of named) {
        const own = stored.get(symbol.key);
        assert.ok(own, `${symbol.key} in ${file.path}`);
        assert.equal(symbol.ordinal, own.ordinal, `${symbol.key}`);
        assert.equal(
          symbol.id,
          `symbol:${createHash("sha256")
            .update(
              JSON.stringify([
                "v2",
                "go-overflow",
                file.module,
                file.path,
                own.kind,
                own.identity,
                own.ordinal,
              ]),
            )
            .digest("hex")}`,
          `${symbol.key}`,
        );
      }
    }
    // Each shape as Go's extractor names it. Several init functions share
    // kind and identity: the tie is broken by the ordinal, in source order.
    const named = (path) =>
      notesSymbols(store.getFile(path)).map(
        (symbol) => `${symbol.kind} ${symbol.identity} ${symbol.ordinal}`,
      );
    const a = named("p/a.go");
    for (const shape of [
      "method (A).Run 0",
      "method (B).Run 0",
      "function init 0",
      "function init 1",
      "function _ 0",
      "struct Box 0",
      "field Box.v 0",
      "field Box.u 0",
      "function Map 0",
      "field a.go:Anon.anon#1.A 0",
      "field a.go:Anon.anon#1.B.anon#1.A 0",
      "field a.go:Anon2.anon#1.A 0",
    ])
      assert.ok(a.includes(shape), shape);
    // Blank variables, locals and type parameters are not symbols, so they
    // cannot share an id.
    for (const line of a) assert.doesNotMatch(line, /^\S+ (x|T|U) /, line);
    assert.ok(a.every((line) => !line.startsWith("var _")));
    assert.deepEqual(
      named("p/b.go").filter((line) => line.startsWith("function")),
      ["function init 0", "function init 1"],
    );
    // init across files and build-tag twins: one identity, distinct ids,
    // because the file is part of the id.
    const ids = (path, identity) =>
      notesSymbols(store.getFile(path))
        .filter((symbol) => symbol.identity === identity)
        .map((symbol) => symbol.id);
    const inits = [...ids("p/a.go", "init"), ...ids("p/b.go", "init")];
    assert.equal(new Set(inits).size, 4);
    const twins = [
      ...ids("p/os_linux.go", "Twin"),
      ...ids("p/os_windows.go", "Twin"),
    ];
    assert.equal(twins.length, 2);
    assert.notEqual(twins[0], twins[1]);
  } finally {
    store.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("a body edit above every declaration leaves every notes id as it was", async () => {
  const { base, root } = tree();
  const store = new SqliteGraphStore(join(base, "graph.sqlite"));
  try {
    await indexProject(root, registry, store);
    const before = notesSymbols(store.getFile("p/a.go")).map((symbol) => [
      symbol.kind,
      symbol.identity,
      symbol.id,
    ]);
    // Moves every offset in the file; changes no declaration.
    writeFileSync(
      join(root, "p/a.go"),
      files["p/a.go"].replace(
        "package p\n",
        "package p\n\n// moved\n// moved\n",
      ),
    );
    await indexProject(root, registry, store);
    const after = notesSymbols(store.getFile("p/a.go")).map((symbol) => [
      symbol.kind,
      symbol.identity,
      symbol.id,
    ]);
    assert.deepEqual(after, before);
  } finally {
    store.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("the ordinal follows source order, not key order", async () => {
  // One init at a two-digit offset from 20 on and one at a three-digit
  // offset under 200: their keys (`function:<start>:init`) sort the other
  // way round as strings (`function:1…` before `function:7…`).
  const text =
    "package p\n\n// a comment so the first declaration starts past offset 40\n" +
    "func init() {}\n" +
    "// padding so the second declaration starts past offset 100\n" +
    "func init() {}\n";
  const second = text.lastIndexOf("func init");
  const first = text.indexOf("func init");
  // Two digits from 2 on, then three from 1: string order reverses them.
  assert.ok(first >= 20 && first < 100 && second >= 100 && second < 200);
  const base = mkdtempSync(join(tmpdir(), "c56a-order-"));
  const root = join(base, "tree");
  mkdirSync(join(root, "p"), { recursive: true });
  writeFileSync(join(root, "go.mod"), "module example.com/m\n\ngo 1.22\n");
  writeFileSync(join(root, "p/o.go"), text);
  const store = new SqliteGraphStore(join(base, "graph.sqlite"));
  try {
    await indexProject(root, registry, store);
    const inits = (symbols) =>
      symbols
        .filter((symbol) => symbol.name === "init")
        .map((symbol) => [symbol.range.start, symbol.ordinal])
        .sort((a, b) => a[0] - b[0]);
    const keys = notesSymbols(store.getFile("p/o.go"))
      .filter((symbol) => symbol.name === "init")
      .map((symbol) => symbol.key)
      .sort();
    assert.ok(keys[0].includes(`:${second}:`), "key order differs");
    assert.deepEqual(
      inits(notesSymbols(store.getFile("p/o.go"))).map(([, n]) => n),
      [0, 1],
    );
    assert.deepEqual(
      inits(store.findSymbols({ file: "p/o.go" })).map(([, n]) => n),
      [0, 1],
    );
  } finally {
    store.close();
    rmSync(base, { recursive: true, force: true });
  }
});
