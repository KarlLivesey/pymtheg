import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTagsParser,
  tagsFromPackage,
  validateResult,
} from "../dist/graph/index.js";

test("Tree-sitter helper loads real Go WASM and bundled tags.scm with UTF-16 ranges", async () => {
  const options = await tagsFromPackage(
    "tree-sitter-go",
    "tree-sitter-go.wasm",
  );
  const helper = await createTagsParser(options);
  try {
    const text =
      "// 😀 unicode before the definition\npackage example\nfunc greet() int { return 42 }\ntype Thing struct {}\n";
    const result = helper.parse(text);
    assert.equal(result.status, "clean");
    validateResult(text, result);
    assert.deepEqual(
      result.symbols.map(({ name, kind }) => ({ name, kind })),
      [
        { name: "greet", kind: "function" },
        { name: "Thing", kind: "type" },
      ],
    );
    const greet = result.symbols[0];
    assert.equal(greet.range.start, text.indexOf("func greet"));
    assert.equal(
      text.slice(greet.range.start, greet.range.end),
      "func greet() int { return 42 }",
    );
    assert.deepEqual(helper.parse(text), result);
    const partial = helper.parse("package example\nfunc broken( {\n");
    assert.equal(partial.status, "partial");
    assert.ok(partial.diagnostics.length);
    validateResult("package example\nfunc broken( {\n", partial);
  } finally {
    helper.dispose();
  }
  assert.throws(() => helper.parse("package example"), /disposed/);
});

test("Tree-sitter capture mapping is optional and query errors are explicit", async () => {
  const options = await tagsFromPackage(
    "tree-sitter-go",
    "tree-sitter-go.wasm",
  );
  await assert.rejects(
    createTagsParser({
      ...options,
      query: "(unknown_node) @definition.unknown",
    }),
  );
  const helper = await createTagsParser({
    ...options,
    mapDefinition(_match, symbol) {
      return { ...symbol, kind: "custom" };
    },
  });
  try {
    assert.equal(
      helper.parse("package example\nfunc greet() {}\n").symbols[0].kind,
      "custom",
    );
  } finally {
    helper.dispose();
  }
});

test("A9: reference captures and live tree second pass can create language-specific links", async () => {
  const options = await tagsFromPackage(
    "tree-sitter-go",
    "tree-sitter-go.wasm",
  );
  let passes = 0;
  const helper = await createTagsParser({
    ...options,
    mapReference(reference, symbols) {
      if (reference.kind !== "call") return undefined;
      assert.equal(reference.node.text, "greet()");
      const owner = symbols.find(
        (symbol) =>
          symbol.range.start <= reference.range.start &&
          symbol.range.end >= reference.range.end,
      );
      return {
        sourceKey: owner.key,
        kind: "calls",
        targetName: reference.name,
        range: reference.range,
      };
    },
    secondPass({ tree, references, result, matches }) {
      passes++;
      assert.equal(tree.rootNode.type, "source_file");
      assert.equal(
        tree.rootNode.descendantsOfType("call_expression").length,
        1,
      );
      assert.ok(matches.length);
      assert.equal(
        references.find((reference) => reference.kind === "call").name,
        "greet",
      );
      for (const symbol of result.symbols)
        symbol.identity = `sample.${symbol.name}`;
    },
  });
  try {
    const text =
      "package example\nfunc greet() {}\nfunc caller() { greet() }\n";
    const result = helper.parse(text);
    validateResult(text, result);
    assert.equal(passes, 1);
    assert.equal(result.links.length, 1);
    assert.equal(result.links[0].targetName, "greet");
    assert.equal(
      text.slice(result.links[0].range.start, result.links[0].range.end),
      "greet()",
    );
    assert.ok(
      result.symbols.every((symbol) => symbol.identity.startsWith("sample.")),
    );
  } finally {
    helper.dispose();
  }
});

test("A9: Rust duplicate definition kinds can be filtered by the module while the impl tree is alive", async () => {
  const options = await tagsFromPackage(
    "tree-sitter-rust",
    "tree-sitter-rust.wasm",
  );
  const seen = [];
  const helper = await createTagsParser({
    ...options,
    mapDefinition(_match, symbol) {
      if (symbol.name === "new") {
        seen.push(symbol.kind);
        if (symbol.kind === "function") return undefined;
        return { ...symbol, identity: "B::new" };
      }
      return symbol;
    },
    secondPass({ tree }) {
      assert.equal(tree.rootNode.descendantsOfType("impl_item").length, 1);
    },
  });
  try {
    const result = helper.parse(
      "struct B; impl B { fn new() -> Self { B } }\n",
    );
    assert.equal(result.status, "clean");
    assert.ok(seen.includes("function"));
    assert.ok(seen.includes("method"));
    assert.deepEqual(
      result.symbols
        .filter((symbol) => symbol.name === "new")
        .map((symbol) => symbol.identity),
      ["B::new"],
    );
  } finally {
    helper.dispose();
  }
});

test("A7: a valid extracted definition in a Tree-sitter partial file is a qualified link target", async () => {
  const { SqliteGraphStore, contentHash } = await import(
    "../dist/graph/index.js"
  );
  const helper = await createTagsParser(
    await tagsFromPackage("tree-sitter-go", "tree-sitter-go.wasm"),
  );
  const store = new SqliteGraphStore(":memory:");
  try {
    const text = "package example\nfunc good() {}\nfunc broken( {\n";
    const result = helper.parse(text);
    assert.equal(result.status, "partial");
    store.replaceFile({
      path: "partial.source",
      text,
      hash: contentHash(text),
      module: "helper-fixture",
      version: "1",
      result,
    });
    const caller = "call good";
    store.replaceFile({
      path: "caller.source",
      text: caller,
      hash: contentHash(caller),
      module: "helper-fixture",
      version: "1",
      result: {
        status: "clean",
        diagnostics: [],
        symbols: [],
        links: [
          {
            sourceKey: null,
            kind: "calls",
            targetName: "good",
            range: { start: 0, end: caller.length },
          },
        ],
      },
    });
    const good = store.findSymbols({ name: "good" })[0];
    assert.equal(good.status, "partial");
    store.resolveLinks([{ linkId: store.links()[0].id, targetId: good.id }]);
    assert.equal(store.links()[0].resolution, "resolved");
    assert.equal(store.links()[0].targetStatus, "partial");
    assert.equal(store.neighbourhood(good.id, 1).symbols[0].status, "partial");
  } finally {
    helper.dispose();
    store.close();
  }
});
