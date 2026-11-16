// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  Language,
  LANGUAGE_VERSION,
  MIN_COMPATIBLE_VERSION,
  Parser,
  Query,
} from "web-tree-sitter";

const require = createRequire(import.meta.url);
const samples = [
  {
    package: "tree-sitter-go",
    wasm: "tree-sitter-go.wasm",
    // The Go module loads the vendored, patched build (grammars/go, W2-S);
    // the npm package still supplies the tags query checked against it.
    vendored: new URL("../grammars/go/tree-sitter-go.wasm", import.meta.url)
      .pathname,
    node: "function_declaration",
    // Go 1.26 `new(expr)`: only the vendored build reads it.
    source:
      "package example\nfunc greet() int { return 42 }\nvar p = new(42)\n",
  },
  {
    package: "tree-sitter-rust",
    wasm: "tree-sitter-rust.wasm",
    // The Rust module loads the vendored, patched build (grammars/rust, W2-V);
    // the npm package still supplies the tags query checked against it.
    vendored: new URL("../grammars/rust/tree-sitter-rust.wasm", import.meta.url)
      .pathname,
    node: "function_item",
    // Edition-2024 `unsafe extern` and `&raw` on a variable: only the vendored
    // build reads them.
    source:
      'fn greet() -> i32 { 42 }\nunsafe extern "C" {\n    fn abs(x: i32) -> i32;\n}\nfn r(raw: u8) -> u8 { *&raw }\n',
  },
  {
    package: "@tree-sitter-grammars/tree-sitter-lua",
    wasm: "tree-sitter-lua.wasm",
    node: "function_declaration",
    source: "function greet() return 42 end\n",
  },
];

await Parser.init({
  locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
});
console.log(
  `Node ${process.version}; runtime ABI ${MIN_COMPATIBLE_VERSION}..${LANGUAGE_VERSION}`,
);

for (const sample of samples) {
  const metadata = JSON.parse(
    await readFile(require.resolve(`${sample.package}/package.json`), "utf8"),
  );
  const language = await Language.load(
    sample.vendored ?? require.resolve(`${sample.package}/${sample.wasm}`),
  );
  const parser = new Parser();
  let tree;
  let query;
  try {
    parser.setLanguage(language);
    tree = parser.parse(sample.source);
    assert.ok(tree, `${sample.package}: parser returned no tree`);
    assert.equal(
      tree.rootNode.hasError,
      false,
      `${sample.package}: parse error`,
    );
    const nodes = tree.rootNode.descendantsOfType(sample.node);
    assert.ok(
      nodes.some((node) => node.isNamed && !node.isMissing),
      `${sample.package}: missing named ${sample.node}`,
    );
    query = new Query(
      language,
      await readFile(
        require.resolve(`${sample.package}/queries/tags.scm`),
        "utf8",
      ),
    );
    const definitions = query
      .captures(tree.rootNode)
      .filter((capture) => capture.name.startsWith("definition."));
    assert.ok(
      definitions.length > 0,
      `${sample.package}: no definition capture`,
    );
    assert.ok(
      definitions.some((capture) => capture.node.text.includes("greet")),
      `${sample.package}: no definition of sample function`,
    );
    console.log(
      `PASS ${sample.vendored ? `${sample.package} (vendored ${sample.vendored.split("/").slice(-3, -1).join("/")}; npm ${metadata.version} queries)` : `${sample.package}@${metadata.version}`}: ABI ${language.abiVersion}; ` +
        `no parse errors; named ${sample.node}; ` +
        `tags.scm definitions: ${definitions.map((capture) => capture.name).join(", ")}`,
    );
  } finally {
    query?.delete();
    tree?.delete();
    parser.delete();
  }
}

console.log("PASS all three WASM grammars and bundled tags queries");
