// SPDX-License-Identifier: MIT
// C-24: build the committed plan input: main's plan input with the rows of
// the pins measured here replaced by this chunk's export, every other row
// and the embedded comparison base kept byte-for-byte.
// Usage: node overlay.mjs BASE.json.gz EXPORT.json OUT.json.gz
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

const [basePath, exportPath, out] = process.argv.slice(2);
const read = (path) =>
  JSON.parse(
    path.endsWith(".gz")
      ? gunzipSync(readFileSync(path)).toString("utf8")
      : readFileSync(path, "utf8"),
  );
const base = read(basePath);
const measured = read(exportPath);
if (JSON.stringify(base.columns) !== JSON.stringify(measured.columns))
  throw Error("Export columns differ from the plan input");
const rows = new Map(
  measured.repos
    .filter((repo) => repo.outcome === "finished")
    .map((repo) => [`${repo.id}@${repo.commit}`, repo]),
);
let replaced = 0;
const repos = base.repos.map((repo) => {
  const row = rows.get(`${repo.id}@${repo.commit}`);
  if (!row) return repo;
  replaced++;
  return row;
});
if (replaced !== rows.size)
  throw Error(`Replaced ${replaced} of ${rows.size} measured pins`);
writeFileSync(out, gzipSync(JSON.stringify({ ...base, repos })));
console.log(`replaced ${replaced} rows; kept ${repos.length - replaced}`);
