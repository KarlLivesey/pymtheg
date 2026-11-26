// SPDX-License-Identifier: MIT
// C-52 threshold.mjs DIST FIXTURE.json STEPS... : indexes FIXTURE.json (path
// → text) with DIST's TypeScript module at each taint step budget and prints,
// per budget, each link's resolution and reason (a diagnosis aid for tests).
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dist, fixture, ...budgets] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { indexProject, LanguageRegistry, SqliteGraphStore } = await load("graph/index.js");
const { typescriptModule } = await load("graph/languages/typescript/index.js");
const { taintStatistics } = await load("graph/languages/typescript/taint.js");
const files = JSON.parse(readFileSync(fixture, "utf8"));
for (const steps of budgets.map(Number)) {
  const base = mkdtempSync(join(tmpdir(), "c52-threshold-"));
  const root = join(base, "tree");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const store = new SqliteGraphStore(join(base, "g.sqlite"));
  const before = taintStatistics.exhausted;
  try {
    await indexProject(root, new LanguageRegistry([typescriptModule({ taintSteps: steps || undefined })]), store);
    const outcomes = store
      .links()
      .filter((link) => link.kind !== "contains")
      .map((link) => `${link.file}:${link.targetName}=${link.resolution}:${link.data?.reason ?? ""}`);
    console.log(steps, "exhausted", taintStatistics.exhausted - before, outcomes.join(" "));
  } finally {
    store.close();
    rmSync(base, { recursive: true, force: true });
  }
}
