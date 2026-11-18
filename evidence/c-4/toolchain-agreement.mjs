// SPDX-License-Identifier: MIT
// C-4 evidence: indexes a copy of a Go project with the opt-in toolchain route
// on, using a given Pymtheg build, and reports how the toolchain's decisions
// relate to the source-only route: disagreements (`data.toolchain.sourceOnly`,
// or a source-only definite target withdrawn), confirmations of source-only
// definite links, and upgrades. Also lists the toolchain's view of every link
// in a given list of keys (file, kind, start).
// Usage: node toolchain-agreement.mjs --build DIR --project DIR --work DIR
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { build: { type: "string" }, project: { type: "string" }, work: { type: "string" } },
});
const root = join(values.work, "project");
rmSync(values.work, { recursive: true, force: true });
mkdirSync(values.work, { recursive: true });
cpSync(values.project, root, { recursive: true, filter: (path) => !path.includes("/.git/") && !path.endsWith("/.git") && !path.includes("/.pymtheg") });
// The pinned corpus is read-only; the copy must be writable.
execFileSync("chmod", ["-R", "u+w", root]);
const cli = (...args) =>
  execFileSync(process.execPath, [join(values.build, "dist/cli/main.js"), ...args], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
cli("init", ".", "--name", "agreement", "--format", "json");
writeFileSync(
  join(root, ".pymtheg/settings.json"),
  JSON.stringify({ version: 1, scenarios: {}, graph: { toolchain: { go: true } } }),
);
let report;
try {
  report = cli("graph", "index", "--root", ".", "--json");
} catch (error) {
  if (error.status !== 2) throw error; // 2: incomplete, graph kept
  report = error.stdout;
}
writeFileSync(join(values.work, "index.json"), report);
const db = new DatabaseSync(join(root, ".pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
const counts = { links: 0, toolchainDecided: 0, confirmedDefinite: 0, upgraded: 0, disagreements: 0, withdrawn: 0 };
const disagreements = [];
for (const row of db.prepare("SELECT file, kind, body FROM graph_links WHERE module='go'").iterate()) {
  counts.links++;
  const body = JSON.parse(row.body);
  const t = body.data?.toolchain;
  if (!t || t.origin !== "toolchain") continue;
  counts.toolchainDecided++;
  if (t.sourceOnly) {
    counts.disagreements++;
    disagreements.push({ file: row.file, kind: row.kind, start: body.range.start, name: body.targetName, sourceOnly: t.sourceOnly, upgrade: t.upgrade });
  } else if (t.from === "definite" && t.upgrade === "external") counts.withdrawn++;
  else if (t.from === "definite") counts.confirmedDefinite++;
  else counts.upgraded++;
}
const files = {};
for (const row of db.prepare("SELECT path, body FROM graph_files").iterate()) {
  const status = JSON.parse(row.body).result?.data?.toolchain?.status ?? "none";
  files[status] = (files[status] ?? 0) + 1;
}
console.log(JSON.stringify({ counts, files, disagreements }, null, 1));
