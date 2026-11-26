// SPDX-License-Identifier: MIT
import { hash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { modules, outcomes, storedLibraryIdentity, storedTotalsAgree } from "./coverage-rules.mjs";
import { compare, firstBlocker, missColumns, sampleSize, seed, storedReasons } from "./coverage-refresh-data.mjs";

// Keep raw process output in scratch. Source excerpts are from public pins,
// but may still contain address or e-mail literals in test fixtures.
function excerpt(text, max = 240) {
  return text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/(\b(?:https?|wss?|ssh):\/\/)[^/\s`"'?]+/gi, "$1[host]")
    .replace(/(["'`])(?:[a-z\d-]+\.)+(?:com|org|net|local|internal|lan|example|test|invalid)(?=[:,'"`])/gi, "$1[host]")
    .replace(/\blocalhost\b/gi, "[host]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[address]")
    .replace(/\[[\da-f:]+:[\da-f:]+\]/gi, "[address]")
    .replace(/(["'`])(?:[\da-f]{0,4}:){2,}[\da-f:]+\1/gi, "$1[address]$1")
    .replace(/(?:\/home\/|\/Users\/|\/root\/|[A-Za-z]:\\Users\\)[^\s`"']+/g, "[path]")
    .trim().slice(0, max);
}

function retain(list, rank, make, limit) {
  if (list.length === limit && rank >= list.at(-1).rank) return;
  const index = list.findIndex((entry) => rank < entry.rank);
  list.splice(index < 0 ? list.length : index, 0, { rank, ...make() });
  if (list.length > limit) list.pop();
}

function scan(attempt, repo, audit) {
  const db = new DatabaseSync(join(attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  try {
    if (db.prepare("SELECT value FROM graph_meta WHERE key='schema'").get()?.value !== "4") {
      throw Error("A fresh coverage export requires the schema 4 store");
    }
    // D17 clarified: `seen` counts the Level 2 links a toolchain route
    // decided whose selection label is `seen` (checkout upgrades and
    // applied library answers), so the scoreboard gives Level 2 counting
    // only none-seen ones.
    const counts = Object.fromEntries(modules.map((module) => [module, { links: 0, level2: 0, assumed: 0, seen: 0 }]));
    const byOutcome = new Map(outcomes.map((outcome) => [outcome, 0]));
    const inventory = new Map();
    const shortlist = new Map();
    const examples = new Map();
    const sourceFor = db.prepare("SELECT json_extract(body,'$.text') AS text FROM graph_files WHERE path=?");
    const candidatesFor = db.prepare(`SELECT s.file,s.name FROM graph_candidates c
      JOIN graph_symbols s ON s.id=c.symbol WHERE c.link=? ORDER BY s.file,s.name LIMIT 8`);
    const libraryCandidatesFor = db.prepare(`SELECT unit,symbol FROM graph_library_targets
      WHERE link=? AND role='candidate' ORDER BY unit,symbol LIMIT 8`);
    const rows = db.prepare(`SELECT l.file,l.id,l.kind,l.module,l.resolution,l.body,
        t.unit,t.symbol,t.evidence FROM graph_links l LEFT JOIN graph_library_targets t
        ON l.resolution='library' AND t.link=l.id AND t.role='target' ORDER BY l.file`).iterate();
    let currentFile;
    let source;
    let lineStarts;
    const locate = (file, range) => {
      if (file !== currentFile) {
        currentFile = file;
        source = sourceFor.get(file)?.text ?? "";
        lineStarts = [0];
        for (let i = source.indexOf("\n"); i >= 0; i = source.indexOf("\n", i + 1)) lineStarts.push(i + 1);
      }
      const start = range?.start ?? 0;
      let lo = 0, hi = lineStarts.length;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (lineStarts[mid] <= start) lo = mid;
        else hi = mid;
      }
      const code = excerpt(source.slice(Math.max(lineStarts[lo], start - 95),
        Math.min(lineStarts[lo + 1] ?? source.length, start + 145)));
      return { file, line: lo + 1, column: start - lineStarts[lo] + 1, code };
    };
    for (const row of rows) {
      const { file, id, module, kind, resolution: outcome } = row;
      const { data = {}, range, targetName } = JSON.parse(row.body);
      if (!counts[module] || !byOutcome.has(outcome)) throw Error(`Unexpected graph link in ${repo.id}: ${module}/${outcome}`);
      const totals = counts[module];
      totals.links++;
      byOutcome.set(outcome, byOutcome.get(outcome) + 1);
      const library = outcome === "library" ? storedLibraryIdentity({ file, resolution: outcome, library: row }) : null;
      if (outcome === "resolved" || library?.level === 2) {
        totals.level2++;
        if (Array.isArray(data.assumes) && data.assumes.length) totals.assumed++;
        if ((data.toolchain?.from !== "definite" && data.toolchain?.selection === "seen") ||
            (row.evidence === "toolchain-declaring-path" && data.toolchainLibrary?.selection === "seen")) totals.seen++;
        continue;
      }
      const reasons = storedReasons(data);
      const tuple = [module, kind, outcome, reasons];
      const key = JSON.stringify(tuple);
      const group = inventory.get(key) ?? [...tuple, 0];
      group[4]++;
      inventory.set(key, group);

      const bucket = JSON.stringify([module, firstBlocker(reasons, outcome)]);
      const rank = hash("sha256", `${seed}\0${repo.id}\0${repo.commit}\0${id}`);
      const make = () => ({ repo: repo.id, ...locate(file, range), module, kind, outcome, reasons,
        target: excerpt(targetName ?? ""), ...(library ? { unit: excerpt(library.unit) } : {}) });
      const sites = examples.get(bucket) ?? [];
      if (sites.length < 2 || rank < sites.at(-1).rank) {
        const site = make();
        const duplicate = sites.findIndex((entry) => entry.file === site.file && entry.line === site.line);
        if (duplicate < 0 || rank < sites[duplicate].rank) {
          if (duplicate >= 0) sites.splice(duplicate, 1);
          retain(sites, rank, () => site, 2);
        }
      }
      examples.set(bucket, sites);
      if (!audit) continue;
      const candidates = shortlist.get(bucket) ?? [];
      retain(candidates, rank, () => ({ ...make(), ...(outcome === "ambiguous" && {
        candidates: candidatesFor.all(id).map(({ file, name }) => ({ file, name: excerpt(name) })),
        libraryCandidates: libraryCandidatesFor.all(id).map(({ unit, symbol }) => ({ unit: excerpt(unit), symbol: symbol && excerpt(symbol) })),
      }) }), sampleSize);
      shortlist.set(bucket, candidates);
    }
    const warm = JSON.parse(readFileSync(join(attempt, "warm.out"), "utf8")).counts;
    if (!storedTotalsAgree([...byOutcome].map(([outcome, links]) => [, , outcome, , , , , links]), warm)) {
      throw Error(`Stored link totals disagree with the warm CLI for ${repo.id}`);
    }
    return { counts, inventory: [...inventory].sort(([a], [b]) => compare(a, b)).map(([, row]) => row),
      examples: Object.fromEntries(examples), shortlist: Object.fromEntries(shortlist) };
  } finally {
    db.close();
  }
}

function publicRun(repo) {
  const { id, language, commit, outcome, wallSeconds, peakRssKiB, cold, warm, install, toolchain, failure, index } = repo;
  const failedFiles = index?.failedFileCount;
  const failedModules = index && Object.fromEntries(modules.map((module) => [module,
    index.failures.filter(({ language }) => language === module).reduce((sum, { count }) => sum + count, 0)]));
  // Count files marked failed for this reason. A single analysis error can affect the whole module.
  const invalidUtf16Files = index?.failures.filter(({ reason }) => reason === "Invalid UTF-16 range")
    .reduce((sum, { count }) => sum + count, 0);
  const indexErrors = index?.errors && Object.fromEntries(Object.entries(index.errors).map(([kind, value]) => [kind, value.count]));
  const compilerAssertion = index?.errors?.analysisErrors?.examples.some(({ module, message }) =>
    module === "typescript" && message.includes("Debug Failure. False expression."));
  const { reason: toolchainReason, ...publicToolchain } = toolchain ?? {};
  if (toolchainReason) {
    publicToolchain.reason = /^no go\.mod at the project root$|^go\.work workspaces are not supported yet$|^no toolchain report$|^no Cargo\.toml at the project root$|^no Rust files$/.test(toolchainReason)
      ? toolchainReason : toolchain.state === "partial" ? "offline toolchain index partial" : "offline toolchain unavailable";
  }
  const failureDetails = failure && { stage: failure.stage, ...(failure.code != null && { exit: failure.code }),
    ...(failure.signal && { signal: failure.signal }), wallSeconds: failure.wallSeconds,
    ...(failure.peakRssKiB && { peakRssKiB: failure.peakRssKiB }),
    ...(failure.lastProgress && { progress: excerpt(failure.lastProgress) }),
    ...(failure.memoryMessage && { memory: excerpt(failure.memoryMessage) }) };
  const rejectedOption = failure?.stage === "install" && failure.stderrTail?.map((line) =>
    /unexpected argument '(--[a-z-]+)' found/.exec(line)?.[1]).find(Boolean);
  const publicInstall = rejectedOption && !install?.reason ? { ...install, reason: `rejected ${rejectedOption}` } : install;
  return { id, language, commit, outcome, wallSeconds, peakRssKiB, cold, warm, failedFiles, failedModules, indexErrors,
    install: publicInstall, ...(invalidUtf16Files && { invalidUtf16Files }),
    ...(compilerAssertion && { compilerAssertion: "Debug Failure. False expression." }),
    ...(toolchain && { toolchain: publicToolchain }), ...(failureDetails && { failure: failureDetails }) };
}

function save(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data)}\n`);
  renameSync(tmp, path);
}

export function exportRefresh(input, output, selectAttempt) {
  const cache = `${output}.cache`;
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(cache, { recursive: true });
  const exporter = hash("sha256", Buffer.concat([readFileSync(new URL(import.meta.url)),
    readFileSync(new URL("./coverage-refresh-data.mjs", import.meta.url))]));
  const repos = [];
  for (const repo of input.repos) {
    const entry = publicRun(repo);
    if (repo.outcome === "finished") {
      const attempt = selectAttempt(repo);
      const path = join(cache, `${hash("sha256", `${exporter}\0${attempt}\0${input.release.sha256}`)}.json`);
      if (!existsSync(path)) {
        console.error(`Exporting ${repo.id}`);
        save(path, scan(attempt, repo, input.mode.startsWith("source-only")));
      }
      Object.assign(entry, JSON.parse(readFileSync(path, "utf8")));
    }
    repos.push(entry);
  }
  save(output, { mode: input.mode, release: input.release, missColumns, repos });
  console.error(`Exported ${repos.length} attempts, ${repos.filter(({ counts }) => counts).length} finished`);
}
