// SPDX-License-Identifier: MIT
// Parse cost observation: parse every .rs file under a root with grammar A,
// then B, then A again (one process, same files in memory), and report the
// .wasm size and the total parse time of each pass. Timings are observations
// on a shared server, not assertions.
//   node parse-cost.mjs <a.wasm> <b.wasm> <root>
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Language, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);
const [a, b, root] = process.argv.slice(2);
await Parser.init({ locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm") });
const texts = readdirSync(root, { recursive: true })
  .filter((f) => f.endsWith(".rs") && !f.split("/").includes(".git"))
  .map((f) => readFileSync(join(root, f), "utf8"));
const bytes = texts.reduce((n, t) => n + Buffer.byteLength(t), 0);
console.log(`${texts.length} files, ${bytes} bytes`);
for (const [label, wasm] of [["A", a], ["B", b], ["A", a], ["B", b]]) {
  const parser = new Parser();
  parser.setLanguage(await Language.load(wasm));
  const start = performance.now();
  for (const text of texts) parser.parse(text).delete();
  const ms = performance.now() - start;
  parser.delete();
  console.log(`${label} ${statSync(wasm).size} bytes wasm, parse ${ms.toFixed(0)} ms`);
}
