// SPDX-License-Identifier: MIT
// C-43 part 2 (D24): an audit sample of applied library answers. Each pin is
// indexed cold with the Rust route on; every link the route made definite to
// a library target is collected (sorted by pin, file and offset), and
// <count> of them are drawn with a seeded generator. Each sample gives the
// written path, the library key and the source line, for checking by hand.
//   node audit-library.mjs <dist> <out.json> <seed> <count> <pin dir>...
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dist, out, seed, countArg, ...pins] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { discoverLanguages, indexProject, SqliteGraphStore } = await load("graph/index.js");
const registry = await discoverLanguages();
const scratch = mkdtempSync(join(process.env.PYM_SCRATCH ?? tmpdir(), "audit-"));
const applied = [];
for (const pin of pins) {
  const store = new SqliteGraphStore(join(scratch, `${basename(pin)}.sqlite`), "audit");
  try {
    await indexProject(pin, registry, store, {
      excludeDirectories: [".pymtheg"],
      toolchains: { rust: true },
      toolchainDirectory: join(scratch, "toolchain", basename(pin)),
      environment: process.env,
      signal: new AbortController().signal,
    });
    for (const link of store.links()) {
      // Applied by the route: the stored library target's evidence says so.
      const target = link.libraries?.find((t) => t.evidence === "toolchain-declaring-path");
      if (link.resolution !== "library" || !target) continue;
      const record = { written: link.data?.toolchainLibrary?.written ?? link.targetName, library: target };
      const text = readFileSync(join(pin, link.file), "utf8");
      const before = text.slice(0, link.range.start);
      const line = before.split("\n").length;
      const lineText = text.split("\n")[line - 1].trim().slice(0, 160);
      applied.push({
        pin: basename(pin),
        file: link.file,
        line,
        offset: link.range.start,
        kind: link.kind,
        written: record.written,
        library: { ecosystem: record.library.ecosystem, unit: record.library.unit, symbol: record.library.symbol, version: record.library.version ?? null },
        source: lineText,
      });
    }
  } finally {
    store.close();
  }
}
applied.sort((a, b) => (a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : a.file < b.file ? -1 : a.file > b.file ? 1 : a.offset - b.offset));
// mulberry32 seeded by the SHA-256 of the seed string.
let state = createHash("sha256").update(seed).digest().readUInt32LE(0);
const next = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pool = [...applied.keys()];
const sample = [];
for (let i = 0; i < Number(countArg) && pool.length; i++)
  sample.push(applied[pool.splice(Math.floor(next() * pool.length), 1)[0]]);
writeFileSync(out, JSON.stringify({ seed, applied: applied.length, pins: pins.map((p) => basename(p)), sample }, null, 1) + "\n");
console.log(JSON.stringify({ applied: applied.length, sampled: sample.length }));
