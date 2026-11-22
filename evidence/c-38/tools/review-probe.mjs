// Probe: for each case, index base files, apply one edit, re-index
// incrementally, cold-index, compare rows; report scoped/declined.
// Run from the tree root: node <this> [caseFilter]
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const tree = process.cwd();
const imp = (p) => import(pathToFileURL(join(tree, p)).href);
const { indexProject, LanguageRegistry, SqliteGraphStore } = await imp(
  "dist/graph/index.js",
);
const tsMod = await imp("dist/graph/languages/typescript/index.js");
const { compareRows, storeRows } = await imp("scripts/reindex/dump.mjs");
const typescript = tsMod.default;
const { statistics } = tsMod;
const cold = new LanguageRegistry([typescript]);

const casesFile = process.argv[2];
const filter = process.argv[3];
const cases = (await import(pathToFileURL(casesFile).href)).default;

async function run(c) {
  const base = mkdtempSync(join(tmpdir(), "probe-"));
  const root = join(base, "tree");
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [p, t] of Object.entries(c.files)) write(p, t);
  const incPath = join(base, "inc.sqlite");
  const inc = new SqliteGraphStore(incPath);
  const registry = new LanguageRegistry([typescript]);
  const out = [];
  try {
    await indexProject(root, registry, inc);
    const steps = c.steps ?? [c.edit];
    let i = 0;
    for (const edit of steps) {
      for (const [p, t] of Object.entries(edit)) write(p, t);
      const before = statistics.scoped;
      const declinedBefore = { ...statistics.declined };
      await indexProject(root, registry, inc);
      const scoped = statistics.scoped - before;
      const dec = Object.entries(statistics.declined)
        .filter(([k, v]) => v !== (declinedBefore[k] ?? 0))
        .map(([k]) => k);
      const coldPath = join(base, `cold-${i++}.sqlite`);
      const store = new SqliteGraphStore(coldPath, inc.projectId);
      try {
        await indexProject(root, cold, store);
      } finally {
        store.close();
      }
      const diff = compareRows(storeRows(incPath), storeRows(coldPath));
      out.push(
        `  step ${i}: scoped=${scoped} declined=${JSON.stringify(dec)} diff=${diff.length}` +
          diff
            .map(
              (d) =>
                `\n    ${d.table} inc=${d.onlyIncremental} cold=${d.onlyCold}` +
                (d.table === "graph_links" || d.table === "graph_candidates"
                  ? `\n      inc: ${(d.examples?.incremental ?? []).map((s) => s.replace(/\\/g, "").slice(150, 420)).join("\n      inc: ")}` +
                    `\n      cold: ${(d.examples?.cold ?? []).map((s) => s.replace(/\\/g, "").slice(150, 420)).join("\n      cold: ")}`
                  : ""),
            )
            .join(""),
      );
    }
  } finally {
    inc.close();
  }
  return out.join("\n");
}

for (const c of cases) {
  if (filter && !c.name.includes(filter)) continue;
  try {
    console.log(`CASE ${c.name}\n${await run(c)}`);
  } catch (e) {
    console.log(`CASE ${c.name} ERROR ${e?.stack ?? e}`);
  }
}
