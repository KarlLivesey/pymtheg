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
