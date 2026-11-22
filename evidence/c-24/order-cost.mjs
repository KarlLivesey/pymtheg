// SPDX-License-Identifier: MIT
// C-24: what the canonical input order costs. Loads a finished store's Rust
// inputs as the indexer hands them over (store order) and times the same
// ordering `src/graph/languages/rust/index.ts` applies (path; then file,
// position, kind and what is written), repeated to show the spread. The
// comparator below mirrors index.ts; it is a measurement copy, not used by
// the product.
// Usage: node order-cost.mjs BUILD graph.sqlite [REPEATS]
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const [build, path, repeats = "5"] = process.argv.slice(2);
const { SqliteGraphStore } = await import(
  join(resolve(build), "dist/graph/store.js")
);
const { compare } = await import(join(resolve(build), "dist/graph/identity.js"));
const store = new SqliteGraphStore(path);
const files = store.files().filter((f) => f.module === "rust");
const symbols = store.findSymbols().filter((s) => s.module === "rust");
const links = store.moduleLinks("rust");
store.close();
const pathOrder = (items) => [...items].sort((a, b) => compare(a.path, b.path));
const bySite = (items, written) =>
  [...items].sort(
    (a, b) =>
      compare(a.file, b.file) ||
      a.range.start - b.range.start ||
      a.range.end - b.range.end ||
      compare(a.kind, b.kind) ||
      written(a).reduce(
        (order, part, i) => order || compare(part, written(b)[i]),
        0,
      ) ||
      compare(JSON.stringify(a.data ?? null), JSON.stringify(b.data ?? null)),
  );
const times = [];
for (let i = 0; i < Number(repeats); i++) {
  const start = performance.now();
  pathOrder(files);
  bySite(symbols, (s) => [s.key, s.identity, s.name]);
  bySite(links, (l) => [l.origin, l.targetName, l.sourceKey ?? ""]);
  times.push(performance.now() - start);
}
console.log(
  JSON.stringify({
    files: files.length,
    symbols: symbols.length,
    links: links.length,
    milliseconds: times.map((t) => Math.round(t)),
  }),
);
