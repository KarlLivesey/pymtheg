// SPDX-License-Identifier: MIT
// Write the tree digests of every test fixture .rs file that a grammar parses
// cleanly (the same cursor walk as tree-compare.mjs and the identity test).
//   node tree-digests.mjs <grammar.wasm> <out.json>
// Run with the grammar before C-21 (sha256 66a1d357…) to make the golden file
// test/fixtures/rust-grammar/ordinary-trees.json.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { Language, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);
const [wasm, out] = process.argv.slice(2);
await Parser.init({ locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm") });
const parser = new Parser();
parser.setLanguage(await Language.load(wasm));
const root = new URL("../../test/fixtures/", import.meta.url).pathname;
const files = readdirSync(root, { recursive: true })
  .filter((f) => f.endsWith(".rs"))
  .sort();
const digests = {};
for (const file of files) {
  const tree = parser.parse(readFileSync(join(root, file), "utf8"));
  const hash = createHash("sha256");
  let failed = false;
  const c = tree.walk();
  walk: for (;;) {
    const n = c.currentNode;
    failed ||= n.type === "ERROR" || n.isMissing;
    hash.update(`${c.currentFieldName ?? ""}:${n.type}:${n.isNamed ? 1 : 0}:${n.startIndex}:${n.endIndex};`);
    if (c.gotoFirstChild()) continue;
    while (!c.gotoNextSibling()) if (!c.gotoParent()) break walk;
  }
  c.delete();
  tree.delete();
  if (!failed) digests[relative(root, join(root, file))] = hash.digest("hex");
}
writeFileSync(out, `${JSON.stringify(digests, null, 2)}\n`);
console.log(`${Object.keys(digests).length} of ${files.length} fixtures parse cleanly`);
