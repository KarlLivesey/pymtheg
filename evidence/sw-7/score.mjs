// SPDX-License-Identifier: MIT
// SW-7: per finished pin of a sweep run, the installed TypeScript figures by
// the coverage rules on main, from the stored graph:
//   links, Level 2 (resolved, or a library link whose stored identity is
//   Level 2), assumption-marked Level 2, and D20's library module links
//   (`imports` links with a library unit, not Level 2, no stored reason).
// With --detail PIN it also writes, for that pin: the links below Level 2
// (and not D20 module links) by first stored blocker; every figure by area
// of the tree; the failed files by area and by diagnostic; and the links
// that carry C-13's `no-unseen-declarations` marker.
// Usage: node evidence/sw-7/score.mjs RUN.json OUT.json [--detail PIN] [--any-outcome]
// Attempts are read under $SWEEP_SCRATCH, or the run file's directory.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { storedLibraryIdentity } from "../../scripts/sweep/coverage-rules.mjs";
import {
  firstBlocker,
  storedReasons,
} from "../../scripts/sweep/coverage-refresh-data.mjs";

const args = process.argv.slice(2);
const at = args.indexOf("--detail");
const detail = at < 0 ? undefined : args.splice(at, 2)[1];
// --any-outcome: score an attempt whose store exists though the sweep did
// not record it as finished (a wall limit after the index completed).
const anyAt = args.indexOf("--any-outcome");
const anyOutcome = anyAt >= 0;
if (anyOutcome) args.splice(anyAt, 1);
const [runPath, out] = args;
const run = JSON.parse(readFileSync(runPath, "utf8"));
const scratch = process.env.SWEEP_SCRATCH ?? dirname(runPath);

/** The area of microsoft/TypeScript's tree a file is in (the Go port at
 * pin 21ba970: the compiler is Go under tsc/, its test corpus is TypeScript
 * under tsc/testdata/). Other pins: their top folder. */
export function area(file) {
  for (const [prefix, name] of [
    ["tsc/testdata/baselines/", "tsc/testdata/baselines (expected-output baselines)"],
    ["tsc/testdata/tests/", "tsc/testdata/tests (compiler, conformance and fourslash test inputs)"],
    ["tsc/testdata/fixtures/", "tsc/testdata/fixtures (test fixtures)"],
    ["tsc/testdata/", "tsc/testdata (other)"],
    ["tsc/internal/bundled/", "tsc/internal/bundled (bundled lib .d.ts files)"],
    ["tsc/", "tsc (other TypeScript files beside the Go compiler)"],
    ["packages/typescript/src/", "packages/typescript/src (the TypeScript-written package source)"],
    ["packages/typescript/test/", "packages/typescript/test"],
    ["packages/", "packages (other)"],
    ["tools/", "tools (build and release scripts)"],
  ])
    if (file.startsWith(prefix)) return name;
  return file.includes("/") ? `${file.split("/")[0]}/ (other)` : "(root files)";
}

const add = (map, key, field, n = 1) => {
  const row = (map[key] ??= { links: 0, level2: 0, assumed: 0, moduleLinks: 0 });
  row[field] += n;
};
const pins = [];
const details = {};
for (const repo of run.repos) {
  if (repo.outcome !== "finished" && !(anyOutcome && repo.attempt)) {
    pins.push({ id: repo.id, outcome: repo.outcome });
    continue;
  }
  const db = new DatabaseSync(
    join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
  const deep = repo.id === detail;
  const pin = { id: repo.id, links: 0, level2: 0, assumed: 0, moduleLinks: 0 };
  const blockers = {};
  const areas = {};
  const unseen = { links: 0, level2: 0 };
  const assumptions = {};
  for (const row of db
    .prepare(
      `SELECT l.file,l.kind,l.resolution,l.body,t.unit,t.symbol,t.evidence FROM graph_links l
    LEFT JOIN graph_library_targets t ON l.resolution='library' AND t.link=l.id AND t.role='target'
    WHERE l.module='typescript'`,
    )
    .iterate()) {
    const link = JSON.parse(row.body);
    const data = link.data ?? {};
    const library =
      row.resolution === "library"
        ? storedLibraryIdentity({ file: row.file, resolution: row.resolution, library: row })
        : null;
    const level2 = row.resolution === "resolved" || library?.level === 2;
    const assumed = level2 && Array.isArray(data.assumes) && data.assumes.length > 0;
    const reasons = storedReasons(data);
    const moduleLink =
      !level2 && row.kind === "imports" && row.resolution === "library" && !reasons.length;
    pin.links++;
    if (level2) pin.level2++;
    if (assumed) pin.assumed++;
    if (moduleLink) pin.moduleLinks++;
    if (!deep) continue;
    const where = area(row.file);
    add(areas, where, "links");
    if (level2) add(areas, where, "level2");
    if (assumed) add(areas, where, "assumed");
    if (moduleLink) add(areas, where, "moduleLinks");
    if (!level2 && !moduleLink) {
      const key = firstBlocker(reasons, row.resolution);
      const entry = (blockers[key] ??= { links: 0, areas: {} });
      entry.links++;
      entry.areas[where] = (entry.areas[where] ?? 0) + 1;
    }
    const assumes = Array.isArray(data.assumes) ? data.assumes : [];
    if (assumes.includes("no-unseen-declarations")) {
      unseen.links++;
      if (level2) unseen.level2++;
    }
    if (assumed)
      for (const name of assumes) assumptions[name] = (assumptions[name] ?? 0) + 1;
  }
  pins.push(pin);
  if (deep) {
    const failed = { files: 0, areas: {}, diagnostics: {}, linksStored: 0 };
    for (const { path, body } of db
      .prepare("SELECT path, body FROM graph_files WHERE status='failed'")
      .iterate()) {
      const file = JSON.parse(body);
      if (file.module && file.module !== "typescript") continue;
      failed.files++;
      const where = area(path);
      failed.areas[where] = (failed.areas[where] ?? 0) + 1;
      const message = file.result?.diagnostics?.[0]?.message ?? "(no diagnostic)";
      const kind = `${file.result?.failureKind ?? "?"}: ${message
        .replace(/\d+/g, "N")
        .replace(/'[^']*'/g, "'…'")
        .slice(0, 120)}`;
      failed.diagnostics[kind] = (failed.diagnostics[kind] ?? 0) + 1;
    }
    failed.linksStored = db
      .prepare(
        "SELECT count(*) AS n FROM graph_links l JOIN graph_files f ON f.path=l.file WHERE f.status='failed' AND l.module='typescript'",
      )
      .get().n;
    const files = db
      .prepare("SELECT status, count(*) AS n FROM graph_files GROUP BY status")
      .all();
    const sort = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => (b[1].links ?? b[1]) - (a[1].links ?? a[1])));
    details[repo.id] = {
      files,
      blockers: sort(blockers),
      areas: sort(areas),
      failed: { ...failed, areas: sort(failed.areas), diagnostics: sort(failed.diagnostics) },
      unseenMarked: unseen,
      assumedLevel2ByAssumption: assumptions,
    };
  }
  db.close();
}
writeFileSync(out, JSON.stringify({ pins, details }, null, 1) + "\n");
for (const p of pins)
  console.log(
    p.outcome
      ? [p.id, p.outcome].join("\t")
      : [p.id, p.links, p.level2, p.assumed, p.moduleLinks].join("\t"),
  );
