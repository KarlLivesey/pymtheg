// SPDX-License-Identifier: MIT
// Update the committed Rust plan input with a C-15 export:
//   node plan.mjs ARCHIVE.json.gz EXPORT.json OUT.json.gz
// Replaces the archive's rows for every repository in the export and adds
// any that are missing (vercel/turborepo, a TypeScript pin whose Rust
// workspace the Rust section counts; otherwise its rows come from the
// archive's older comparison base). Then:
//   node scripts/sweep/coverage.mjs --results OUT.json.gz --plan PLAN.md --rust-section
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

const [archivePath, exportPath, out] = process.argv.slice(2);
const archive = JSON.parse(gunzipSync(readFileSync(archivePath)));
const measured = JSON.parse(readFileSync(exportPath, "utf8"));
const rows = new Map(archive.repos.map((row) => [row.id, row]));
for (const row of measured.repos) {
  if (!row.breakdown || !row.strata || !row.sourceFiles)
    throw Error(`Not a measured export row: ${row.id}`);
  rows.set(row.id, row);
}
writeFileSync(
  out,
  gzipSync(
    JSON.stringify({
      ...archive,
      repos: [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    }),
  ),
);
console.log(`${rows.size} rows`);
