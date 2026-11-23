// SPDX-License-Identifier: MIT
// C-49: what the stable keys cost by themselves. Parses every TypeScript and
// JavaScript file of <root> (git ls-files, as the indexer captures them,
// without node_modules) and computes each file's keys once, reporting the
// files, nodes walked and symbols keyed, and the time of the key walks next
// to the time of parsing. Times are observations; counts are deterministic.
//   node scripts/keys/key-cost.mjs <dist> <root>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const [dist, root] = process.argv.slice(2);
const { keyOf } = await import(
  pathToFileURL(resolve(dist, "graph/languages/typescript/symbols.js")).href
);
const extensions = /\.(c|m)?(t|j)sx?$/;
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString()
  .split("\0")
  .filter((path) => extensions.test(path));
let parseMs = 0;
let keyMs = 0;
let nodes = 0;
let keyed = 0;
for (const path of files) {
  const text = readFileSync(join(root, path), "utf8");
  let started = performance.now();
  const file = ts.createSourceFile(
    `/${path}`,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  parseMs += performance.now() - started;
  started = performance.now();
  keyOf(file);
  keyMs += performance.now() - started;
  const count = (node) => {
    nodes++;
    try {
      if (keyOf(node)) keyed++;
    } catch {
      // Not a symbol.
    }
    ts.forEachChild(node, count);
  };
  count(file);
}
console.log(
  JSON.stringify({
    files: files.length,
    nodes,
    keyed,
    parseMs: Math.round(parseMs),
    keyMs: Math.round(keyMs),
  }),
);
