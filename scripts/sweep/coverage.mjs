// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { columns, modules, repositoryScore, rustTaint, scopes } from "./coverage-rules.mjs";

const schema = "pymtheg.sweep.coverage/v1";
const names = { go: "Go", rust: "Rust", typescript: "TypeScript / JS", overall: "Overall" };
const variants = [
  ["All files", scopes],
  ["Without bundles", scopes.filter((scope) => scope !== "bundle")],
  ["Without broken fixtures", scopes.filter((scope) => scope !== "broken-fixture")],
  ["Without templates", scopes.filter((scope) => scope !== "template")],
  ["Source only", ["source"]],
];
const number = (n) => Math.round(n).toLocaleString("en-US");
const percent = (n) => n === null ? "—" : `${(n * 100).toFixed(2)}%`;
const points = (n) => `${(n * 100).toFixed(2)} pp`;
const statusLine = (name, score) => `${name} ${percent(score.raw)} raw / ${percent(score.adjusted)} adjusted`;
const ratio = (n, d) => d ? n / d : null;
const finished = (repo) => repo.outcome === "finished";
const read = (path) => JSON.parse(path.endsWith(".gz") ? gunzipSync(readFileSync(path)) : readFileSync(path, "utf8"));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function merge(base, candidate) {
  const repos = new Map(base.repos.map((row) => [row.id, row]));
  for (const row of candidate.repos) {
    const previous = repos.get(row.id);
    if (!previous || row.commit !== previous.commit || row.language !== previous.language) {
      throw Error(`Candidate did not match the pinned corpus for ${row.id}`);
    }
    repos.set(row.id, row);
  }
  return { ...candidate, repos: [...repos.values()].sort((a, b) => compare(a.id, b.id)) };
}

function checkResult(input) {
  if (input.schema !== schema || JSON.stringify(input.columns) !== JSON.stringify(columns)) throw Error("Expected a coverage-export results file with v1 columns");
  const ids = new Set();
  for (const repo of input.repos) {
    if (ids.has(repo.id) || !modules.includes(repo.language) || !/^[a-f0-9]{40}$/.test(repo.commit)) throw Error(`Invalid repository row for ${repo.id}`);
    if (finished(repo) && (!Array.isArray(repo.breakdown) || !repo.sourceFiles || !repo.strata || !repo.failedSources)) throw Error(`Missing full breakdown for ${repo.id}`);
    for (const [module, , outcome, , , scope, disposition, count, blocked] of repo.breakdown ?? []) {
      if (!modules.includes(module) || !scopes.includes(scope) || !Number.isSafeInteger(count) || count <= 0 ||
          !Number.isSafeInteger(blocked) || blocked < 0 || blocked > count ||
          (outcome === "unresolved" ? !["inside", "outside", "unclassified"].includes(disposition)
            : !["resolved", "ambiguous"].includes(outcome) || disposition !== "eligible")) throw Error(`Invalid breakdown for ${repo.id}`);
    }
    ids.add(repo.id);
  }
  return input;
}

const metric = (repo, module, allowed) => repositoryScore(repo.breakdown ?? [], (language, scope) =>
  (module === "overall" || module === language) && allowed.includes(scope));

export function failedRustInfluence(repo, allowed = scopes) {
  const result = { total: 0, eligible: 0, blocked: 0, receivers: 0, allBlocked: 0 };
  for (const [module, , outcome, reason, uncertainty, scope, disposition, count, blocked] of repo.breakdown ?? []) {
    if (module !== "rust" || outcome !== "unresolved" || !allowed.includes(scope)) continue;
    result.allBlocked += blocked;
    if (!rustTaint(reason, uncertainty)) continue;
    result.total += count;
    result.blocked += blocked;
    if (disposition !== "outside") result.eligible += count;
    if ([reason, uncertainty].some((value) => value?.includes("receiver-type-unverified"))) result.receivers += count;
  }
  return result;
}

export function aggregate(repos, module, allowed = scopes) {
  const observed = repos.filter(finished).map((repo) => metric(repo, module, allowed));
  const weighted = repositoryScore(repos.filter(finished).flatMap((repo) => repo.breakdown), (language, scope) =>
    (module === "overall" || module === language) && allowed.includes(scope));
  const raw = observed.map((score) => score.raw).filter((n) => n !== null);
  const adjusted = observed.map((score) => score.adjusted).filter((n) => n !== null);
  const selected = repos.filter((repo) => module === "overall" || repo.language === module);
  const pinnedScores = selected.map((repo) => finished(repo) ? metric(repo, module, allowed) : { raw: 0, adjusted: 0 });
  const mean = (key) => ratio(pinnedScores.reduce((sum, row) => sum + (row[key] ?? 0), 0), selected.length);
  return {
    weighted, median: { raw: median(raw), adjusted: median(adjusted) },
    all: { raw: mean("raw"), adjusted: mean("adjusted") },
    observed: raw.length, selected: selected.length, finished: selected.filter(finished).length,
  };
}

function donorDensity(repos, module) {
  return median(repos.filter((repo) => finished(repo) && repo.language === module).flatMap((repo) => {
    const lines = repo.sourceFiles.find((row) => row.module === module && row.scope === "source")?.readableLines;
    return lines ? [metric(repo, module, ["source"]).eligible / lines] : [];
  })) ?? 0;
}

const trackedLines = (repo, module) => (repo.trackedSource?.lines?.[module] ?? 0) +
  (module === "typescript" ? repo.trackedSource?.lines?.javascript ?? 0 : 0);
const mdValue = (value) => value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
const code = (value) => {
  const delimiter = '`'.repeat(1 + Math.max(0, ...[...value.matchAll(/`+/g)].map(([part]) => part.length)));
  return `${delimiter} ${mdValue(value)} ${delimiter}`;
};

function dimensions(repos, catalog, labels, density, allowed) {
  const active = new Map(repos.map((row) => [row.id, row]));
  const population = new Map();
  for (const { strata } of repos) for (const [key, count] of Object.entries(strata ?? {})) {
    population.set(key, (population.get(key) ?? 0) + count);
  }
  const samples = new Map();
  for (const sample of labels) {
    const key = `${sample.stratum}:${sample.scope}`;
    const list = samples.get(key) ?? [];
    list.push({ ...sample, resolved: active.get(sample.repo)?.checks?.[sample.key] === "resolved" });
    samples.set(key, list);
  }
  const pending = new Map();
  const omitted = new Map();
  for (const repo of repos) {
    if (!finished(repo)) {
      for (const module of modules) {
        const estimate = trackedLines(repo, module) * density[module];
        if (estimate) omitted.set(`${repo.id}\0${module}`, { repo: repo.id, module, outcome: repo.outcome, estimate });
      }
    } else {
      for (const row of repo.failedSources) if (allowed.includes(row.scope)) {
        const key = `${row.module}\0${row.family}`;
        const rows = pending.get(key) ?? [];
        rows.push({ repo: repo.id, estimate: row.lines * density[row.module], files: row.files, lines: row.lines });
        pending.set(key, rows);
      }
    }
  }
  const output = new Map();
  const estimateFor = (rows) => rows.reduce((sum, row) => sum + row.estimate, 0);
  for (const item of catalog) {
    const { id, module, family, missing, exact } = item;
    if (exact === "rust-taint") {
      const rows = repos.map((repo) => failedRustInfluence(repo, allowed)).filter((row) => row.eligible);
      output.set(id, { estimate: rows.reduce((sum, row) => sum + row.eligible, 0), repos: rows.length });
    } else if (family) {
      const rows = pending.get(`${module}\0${family}`) ?? [];
      output.set(id, { estimate: estimateFor(rows), repos: new Set(rows.map((r) => r.repo)).size, files: rows.reduce((n, row) => n + row.files, 0) });
    } else if (missing) {
      const rows = [...omitted.values()].filter((row) => row.module === module && missing.includes(row.repo));
      output.set(id, { estimate: estimateFor(rows), repos: rows.length });
    } else {
      let estimate = 0, reviewed = 0, fixed = 0;
      const affected = new Set();
      for (const [key, rows] of samples) {
        if (!allowed.includes(key.split(":").at(-1))) continue;
        const tagged = rows.filter((row) => row.item === id);
        if (!tagged.length) continue;
        const open = tagged.filter((row) => !row.resolved);
        const intact = rows.filter((row) => !row.resolved).length;
        estimate += (population.get(key) ?? 0) * (ratio(open.length, intact) ?? 0);
        reviewed += tagged.length;
        fixed += tagged.length - open.length;
        for (const row of open) affected.add(row.repo);
      }
      output.set(id, { estimate, repos: affected.size, reviewed, fixed });
    }
  }
  const gaps = Object.fromEntries(modules.map((module) => [module,
    [...omitted.values()].filter((row) => row.module === module).reduce((sum, row) => sum + row.estimate, 0) +
    [...pending].filter(([key]) => key.startsWith(`${module}\0`)).flatMap(([, rows]) => rows).reduce((sum, row) => sum + row.estimate, 0),
  ]));
  const totals = {};
  for (const module of [...modules, "overall"]) {
    const count = aggregate(repos, module, allowed).weighted;
    const deferred = module === "overall" ? Object.values(gaps).reduce((sum, value) => sum + value, 0) : gaps[module];
    const denominator = count.eligible + deferred;
    const gain = catalog.filter((item) => module === "overall" || item.module === module)
      .reduce((sum, item) => sum + output.get(item.id).estimate, 0);
    if (gain > denominator - count.resolved + 0.01) throw Error(`Support estimates overlap for ${module}`);
    totals[module] = { observed: count.adjusted, deferred, denominator, baseline: ratio(count.resolved, denominator),
      gain: ratio(gain, denominator), end: ratio(count.resolved + gain, denominator), unexplained: Math.max(0, denominator - count.resolved - gain),
      needed: Math.max(0, Math.ceil(0.9 * denominator - count.resolved - gain)) };
  }
  return { items: output, totals };
}

function itemStatus(item, now, before, isProgress) {
  if (!isProgress) return "open";
  if (now.reviewed > 0 && now.fixed > 0) return `open · ${now.fixed}/${now.reviewed} sample sites resolved`;
  if (item.family && now.files < before.files) return now.files ? `open · ${before.files - now.files} fewer failed files` : "zero failed files in current graphs";
  if (item.missing && now.repos < before.repos) return now.repos ? `open · ${before.repos - now.repos} more graphs returned` : "all listed graphs returned";
  if (item.exact && now.estimate < before.estimate) return `open · ${number(before.estimate - now.estimate)} fewer flagged links`;
  return "open";
}

function validateCatalog(items, samples) {
  const ids = new Set();
  const slices = new Set();
  for (const item of items) {
    const { id, module, missing, family, exact, examples } = item;
    if (ids.has(id) || !modules.includes(module) || examples.length !== 2) throw Error(`Invalid support item ${id}`);
    if ([missing, family, exact].filter(Boolean).length > 1 || exact && (module !== "rust" || exact !== "rust-taint")) throw Error(`Overlapping or invalid support item ${id}`);
    const itemSlices = exact ? [exact] : family ? [`${module}:file:${family}`] : (missing ?? []).map((repo) => `${module}:repo:${repo}`);
    for (const slice of itemSlices) {
      if (slices.has(slice)) throw Error(`Overlapping support item ${id}`);
      slices.add(slice);
    }
    ids.add(id);
  }
  for (const { item, stratum } of samples) if (item && (!ids.has(item) || stratum === "rust:failed-file-taint")) throw Error(`Unknown or reserved sample label ${item}`);
}

const start = "<!-- sweep:coverage:start -->";
const end = "<!-- sweep:coverage:end -->";
function updatePlan(path, block) {
  const document = readFileSync(path, "utf8");
  const a = document.indexOf(start), b = document.indexOf(end);
  if (a < 0 || b <= a || document.indexOf(start, a + start.length) !== -1 || document.indexOf(end, b + end.length) !== -1) {
    throw Error("Coverage plan must have one ordered pair of generated-section markers");
  }
  writeFileSync(path, `${document.slice(0, a + start.length)}\n\n${block.trim()}\n\n${document.slice(b)}`);
}

function renderScore(repos, input, base) {
  const lines = ["# SW-3 coverage scoreboard", "",
    `Result package ${code(input.release.package)}. ${base ? `Candidate records replace ${input.repos.length} matching baseline pins.` : `The baseline covers ${repos.length} pinned repositories.`}`,
    "", "Raw is resolved links divided by all links. Adjusted removes only unresolved links classified outside. Each cell with two percentages shows raw / adjusted.",
    "For language rates, median and weighted use that module’s links across the full corpus, including mixed-language checkouts. The pinned mean assigns zero to failed attempts and scores each finished repository in its selected language. The overall pinned mean uses each checkout’s whole graph.", "",
    "| Files counted | Module | Graphs with links | Median raw / adjusted | Link-weighted raw / adjusted | Pinned mean raw / adjusted |",
    "| --- | --- | ---: | --- | --- | --- |"];
  const pair = (row) => `${percent(row.raw)} / ${percent(row.adjusted)}`;
  for (const [label, allowed] of variants) for (const module of [...modules, "overall"]) {
    const a = aggregate(repos, module, allowed);
    lines.push(`| ${label} | ${names[module]} | ${a.observed} | ${pair(a.median)} | ${pair(a.weighted)} | ${pair(a.all)} |`);
  }
  lines.push("", "## Source scopes", "", "Counts include every observed link. Broken and template files that produced no links appear in the failed-source column.", "",
    "| Module | Scope | Resolved | Ambiguous | Inside | Outside | Unclassified | Failed source files |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const module of modules) for (const scope of scopes) {
    const score = aggregate(repos, module, [scope]).weighted;
    const failed = repos.flatMap((repo) => repo.failedSources ?? []).filter((row) => row.module === module && row.scope === scope).reduce((sum, row) => sum + row.files, 0);
    lines.push(`| ${names[module]} | ${scope} | ${[score.resolved, score.ambiguous, score.inside, score.outside, score.unclassified, failed].map(number).join(" | ")} |`);
  }
  lines.push("", "## Repository results", "", "Rows include every module in the checkout. For each attempt, the archive holds the full link breakdown and the explicit inside, outside and unclassified counts for every file scope.", "",
    "| Repository | Selected language | Outcome | Links | Outside | Unclassified | All raw / adjusted | Source only raw / adjusted |",
    "| --- | --- | --- | ---: | ---: | ---: | --- | --- |");
  for (const repo of repos) {
    const a = metric(repo, "overall", scopes), b = metric(repo, "overall", ["source"]);
    lines.push(`| ${repo.id} | ${names[repo.language]} | ${repo.outcome} | ${finished(repo) ? `${number(a.total)} | ${number(a.outside)} | ${number(a.unclassified)} | ${pair(a)} | ${pair(b)}` : "— | — | — | 0% / 0% | 0% / 0%"} |`);
  }
  lines.push("", "## Attempts with no completed graph", "");
  for (const repo of repos.filter((row) => !finished(row))) lines.push(`- ${code(repo.id)} ${repo.outcome}${repo.failure?.lastProgress ? ` at ${code(repo.failure.lastProgress)}` : ""}.`);
  lines.push("", "## Rust failed-file influence", "", "These are exact stored unresolved counts. The eligible column excludes proved outside targets. The blocked and receiver columns count the stored flags. The receiver count covers tainted links. A row with both failure and receiver reasons belongs to the taint support item only.", "",
    "| Repository | Unresolved with failed-file reason | Eligible | Tainted and blocked | Also receiver-unverified | All unresolved marked blocked |",
    "| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const repo of repos) {
    const a = failedRustInfluence(repo);
    if (a.total || repo.failedSources?.some(({ module }) => module === "rust")) {
      lines.push(`| ${repo.id} | ${[a.total, a.eligible, a.blocked, a.receivers, a.allBlocked].map(number).join(" | ")} |`);
    }
  }
  const checks = ["gin-gonic/gin", "yargs/yargs", "alacritty/alacritty"].flatMap((id) => {
    const repo = repos.find((row) => row.id === id && finished(row));
    if (!repo) return [];
    const a = metric(repo, repo.language, scopes);
    const imports = repositoryScore(repo.breakdown, (module, _, kind) => module === repo.language && kind === "imports");
    return [[id, a.outside, a.inside + a.outside + a.unclassified, imports.outside, imports.inside + imports.outside + imports.unclassified]];
  });
  if (checks.length) {
    lines.push("", "## Outside-link review checks", "", "These counts use source evidence from the full primary-module breakdown for the SW-1 review cases. For example, yargs imports its own build output, so `missing-module` on those relative paths remains inside. Unproven package links and return types stay unclassified.", "",
      "| Repository | Outside / unresolved | Outside / unresolved imports |", "| --- | ---: | ---: |");
    for (const [id, outside, unresolved, outsideImports, unresolvedImports] of checks) {
      lines.push(`| ${id} | ${number(outside)} / ${number(unresolved)} (${percent(ratio(outside, unresolved))}) | ${number(outsideImports)} / ${number(unresolvedImports)} |`);
    }
  }
  return lines.join("\n") + "\n";
}

function renderPlan(repos, baseline, items, samples, isProgress) {
  const density = Object.fromEntries(modules.map((module) => [module, donorDensity(baseline, module)]));
  const forecast = dimensions(repos, items, samples, density, scopes);
  const prior = isProgress ? dimensions(baseline, items, samples, density, scopes) : forecast;
  const source = dimensions(repos, items, samples, density, ["source"]);
  const estimate = (item) => forecast.items.get(item.id).estimate;
  const gain = (item) => ratio(estimate(item), forecast.totals[item.module].denominator) ?? 0;
  const ordered = [...items].sort((a, b) => gain(b) - gain(a) || compare(a.id, b.id));
  const lines = ["| Support item | Language | Estimated eligible links | Repositories affected | Potential gain | Two source examples | Status |",
    "| --- | --- | ---: | ---: | ---: | --- | --- |"];
  for (const item of ordered) {
    const a = forecast.items.get(item.id);
    const example = ({ repo, file, line, code: source }) => `${repo} ${code(`${file}:${line}`)} ${code(source)}`;
    const count = a.reviewed === undefined ? `${a.repos}` : `≥${a.repos} (${a.reviewed} sampled)`;
    lines.push(`| ${mdValue(item.title)} | ${names[item.module]} | ${number(a.estimate)}${item.exact ? " measured" : ""} | ${count} | ${points(gain(item))} | ${item.examples.map(example).join("<br>")} | ${itemStatus(item, a, prior.items.get(item.id), isProgress)} |`);
  }
  lines.push("", "### Running total", "");
  for (const module of [...modules, "overall"]) {
    const a = forecast.totals[module], b = source.totals[module];
    const gap = a.needed ? `The 90% target still needs ${number(a.needed)} more links.` : a.denominator ? "The projection reaches 90%." : "There is no eligible denominator.";
    lines.push(`- **${names[module]}** has measured adjusted coverage of ${percent(a.observed)}. With estimated missing links included, the planning baseline is ${percent(a.baseline)}. The listed items add ${points(a.gain ?? 0)} to reach ${percent(a.end)}, with ${number(a.unexplained)} eligible links left unexplained. ${gap} The source-only planning forecast is ${percent(b.baseline)} → ${percent(b.end)}.`);
  }
  lines.push("", "The median eligible links per readable source line used for missing inputs were " + modules.map((m) => `${names[m]} ${density[m].toFixed(3)}`).join(", ") + ".");
  return lines.join("\n");
}

async function main() {
  const { values } = parseArgs({ options: {
    results: { type: "string" }, base: { type: "string" }, scoreboard: { type: "string" }, plan: { type: "string" },
    items: { type: "string", default: "sweep/support-items.json" },
    samples: { type: "string", default: "evidence/sw-3/samples.json.gz" },
  } });
  if (!values.results) throw Error("Use --results FILE with an optional --base FILE, --scoreboard FILE or --plan FILE");
  const input = checkResult(read(values.results));
  const base = values.base ? checkResult(read(values.base)) : input;
  const repos = values.base ? merge(base, input).repos : input.repos;
  const scoreboard = renderScore(repos, input, values.base);
  if (values.scoreboard) writeFileSync(values.scoreboard, scoreboard);
  if (values.plan) {
    const { items } = read(values.items);
    const { samples } = read(values.samples);
    validateCatalog(items, samples);
    updatePlan(values.plan, renderPlan(repos, base.repos, items, samples, Boolean(values.base)));
  }
  if (!values.scoreboard && !values.plan) process.stdout.write(scoreboard);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
