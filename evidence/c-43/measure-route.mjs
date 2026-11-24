// SPDX-License-Identifier: MIT
// C-43: one pin, two cold indexes with the same project id (so link ids
// match): source-only, then with the Rust toolchain route on. Writes the
// pin's Rust figures: Level 2 both ways (proven, assumption-marked,
// toolchain-decided; D20 library module links apart), the route's state,
// what each gate withheld, agreement on source-only definite links,
// rust-analyzer's time and peak memory (from the wrapper's GNU time log),
// and a check that no source-only Level 2 link was lost or changed.
//   node measure-route.mjs <dist> <pin dir> <out.json> <rust-analyzer wrapper> <time log> <work dir>
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { storedReasons } from "../../scripts/sweep/coverage-refresh-data.mjs";
import { storedLibraryIdentity } from "../../scripts/sweep/coverage-rules.mjs";
import { c19, funnel } from "./funnel.mjs";
import { taintEstimate } from "./taint-estimate.mjs";
import { readdirSync } from "node:fs";

const [dist, pin, out, wrapper, timeLog, work] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { discoverLanguages, indexProject, SqliteGraphStore } = await load("graph/index.js");
mkdirSync(work, { recursive: true });

async function cold(name, options) {
  const path = join(work, `${name}.sqlite`);
  for (const suffix of ["", "-wal", "-shm"]) if (existsSync(path + suffix)) rmSync(path + suffix);
  const store = new SqliteGraphStore(path, "c43-measure");
  const started = performance.now();
  const cpu = process.cpuUsage();
  try {
    const report = await indexProject(pin, await discoverLanguages(), store, {
      excludeDirectories: [".pymtheg"],
      signal: new AbortController().signal,
      ...options,
    });
    const used = process.cpuUsage(cpu);
    return { path, report, wallS: (performance.now() - started) / 1000, cpuS: (used.user + used.system) / 1e6 };
  } finally {
    store.close();
  }
}

/** Every Rust link: outcome, target and the stored facts the scoring reads. */
function rustLinks(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const links = new Map();
    const rows = db.prepare(`SELECT l.id, l.file, l.kind, l.resolution, l.target, l.body, t.unit, t.symbol, t.evidence
      FROM graph_links l LEFT JOIN graph_library_targets t ON l.resolution='library' AND t.link=l.id AND t.role='target'
      WHERE l.module='rust'`).iterate();
    for (const row of rows) {
      const { data = {} } = JSON.parse(row.body);
      const library = row.resolution === "library"
        ? storedLibraryIdentity({ file: row.file, resolution: row.resolution, library: row }) : null;
      const level2 = row.resolution === "resolved" || library?.level === 2;
      const moduleLink = row.kind === "imports" && row.resolution === "library" && !level2 && storedReasons(data).length === 0;
      links.set(row.id, { kind: row.kind, resolution: row.resolution, target: row.target, level2, moduleLink,
        assumed: level2 && Array.isArray(data.assumes) && data.assumes.length > 0, toolchain: data.toolchain,
        // The stored data without the route's outcome field, for the check that
        // a link the route did not decide stores its route-off data exactly.
        outcome: data.toolchainOutcome ?? null,
        plain: JSON.stringify(Object.fromEntries(Object.entries(data).filter(([key]) => key !== "toolchainOutcome"))) });
    }
    return links;
  } finally {
    db.close();
  }
}

function score(links) {
  const s = { links: 0, level2: 0, assumed: 0, proven: 0, toolchainDecided: 0, libraryModuleLinks: 0 };
  for (const link of links.values()) {
    s.links++;
    if (link.moduleLink) s.libraryModuleLinks++;
    if (!link.level2) continue;
    s.level2++;
    if (link.assumed) s.assumed++;
    else if (link.toolchain && link.toolchain.from !== "definite") s.toolchainDecided++;
    else s.proven++;
  }
  return s;
}
const pct = (n, d) => (d ? Math.round((10000 * n) / d) / 100 : null);
const parseTime = (text) => {
  const value = (label) => text.match(new RegExp(`${label}: (.*)`))?.[1];
  const clock = value("Elapsed \\(wall clock\\) time \\(h:mm:ss or m:ss\\)") ?? "";
  const parts = clock.split(":").map(Number);
  const wall = parts.reduce((total, part) => total * 60 + part, 0);
  return { wallS: Math.round(wall * 10) / 10, cpuS: Math.round((Number(value("User time \\(seconds\\)")) + Number(value("System time \\(seconds\\)"))) * 10) / 10,
    peakMiB: Math.round(Number(value("Maximum resident set size \\(kbytes\\)")) / 1024) };
};

if (existsSync(timeLog)) rmSync(timeLog);
const off = await cold("source-only", {});
const on = await cold("route", { toolchains: { rust: wrapper }, toolchainDirectory: join(work, "toolchain") });
const before = rustLinks(off.path);
const after = rustLinks(on.path);
let lost = 0, changed = 0, outcomes = 0, outcomeDataDiffers = 0;
for (const [id, link] of before) {
  const now = after.get(id);
  if (!now) { lost++; continue; }
  if (link.level2 && (!now.level2 || now.target !== link.target || now.resolution !== link.resolution)) changed++;
  // Fifth review: a link that records an outcome took no answer; its data
  // must be the route-off data exactly, apart from the outcome.
  if (now.outcome) {
    outcomes++;
    if (now.plain !== link.plain) outcomeDataDiffers++;
  }
}
const notes = (on.report.toolchains ?? []).filter((n) => n.module === "rust").map((n) => n.note);
const available = notes.find((n) => n.status === "available");
const unavailable = notes.find((n) => n.status === "unavailable");
const merged = notes.find((n) => n.status === "merged");
const decided = merged?.decided ?? {};
const S = score(before);
const R = score(after);
const confirmed = decided["definite:definite"] ?? 0;
const differs = decided["kept:source-only-differs"] ?? 0;
const result = {
  pin: basename(pin),
  state: unavailable ? "unavailable" : available?.partial?.length ? "partial" : available ? "used" : "no report",
  reason: unavailable?.reason ?? available?.partial?.[0],
  partialCauses: available?.partial?.length ?? 0,
  analyzer: available ? { version: available.version, configuration: available.configuration, documents: available.documents } : undefined,
  sourceOnly: { ...S, level2Percent: pct(S.level2, S.links), withModuleLinksPercent: pct(S.level2 + S.libraryModuleLinks, S.links) },
  route: { ...R, level2Percent: pct(R.level2, R.links), withModuleLinksPercent: pct(R.level2 + R.libraryModuleLinks, R.links),
    toolchainDecidedPercent: pct(R.toolchainDecided, R.links) },
  decided,
  join: available?.join ?? {},
  agreement: { confirmed, differs, percent: pct(confirmed, confirmed + differs) },
  disagreements: (merged?.disagreements ?? []).slice(0, 10),
  check: { linksBefore: before.size, linksAfter: after.size, lost, changedLevel2: changed, outcomes, outcomeDataDiffers },
  // Sixth review B: what a deny-by-default cfg rule would keep (an estimate).
  design: (() => {
    try {
      return taintEstimate(on.path);
    } catch (error) {
      return { error: String(error) };
    }
  })(),
  analyzerRun: existsSync(timeLog) ? parseTime(readFileSync(timeLog, "utf8")) : null,
  index: { sourceOnly: { wallS: Math.round(off.wallS * 10) / 10, cpuS: Math.round(off.cpuS * 10) / 10 },
    route: { wallS: Math.round(on.wallS * 10) / 10, cpuS: Math.round(on.cpuS * 10) / 10 } },
  errors: { sourceOnly: [...off.report.analysisErrors, ...off.report.resolutionErrors].map((e) => e.message).slice(0, 3),
    route: [...on.report.analysisErrors, ...on.report.resolutionErrors].map((e) => e.message).slice(0, 3) },
};
// Where the open links go, from the route's own cached index.
const cacheDir = join(work, "toolchain", "rust");
const stem = existsSync(cacheDir) ? readdirSync(cacheDir).find((n) => /^scip-[0-9a-f]{32}\.scip$/.test(n)) : undefined;
if (stem) {
  const facts = JSON.parse(readFileSync(join(cacheDir, stem.replace(/\.scip$/, ".json")), "utf8")).facts;
  result.funnel = await funnel(load, off.path, on.path, "c43-measure", join(cacheDir, stem), facts);
}
result.c19 = c19(basename(pin).split("_").slice(1).join("_").toLowerCase());
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ pin: result.pin, state: result.state, reason: result.reason, sourceOnly: result.sourceOnly.level2Percent,
  route: result.route.level2Percent, decided: R.toolchainDecided, agreement: result.agreement, check: result.check, ra: result.analyzerRun }));
for (const name of ["source-only", "route"]) for (const suffix of ["", "-wal", "-shm"]) rmSync(join(work, `${name}.sqlite${suffix}`), { force: true });
