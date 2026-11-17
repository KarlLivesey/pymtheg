// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { columns, modules, repositoryScore, reviewBucket, reviewPopulation, rustTaint, scopes } from "./coverage-rules.mjs";

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
  return {
    weighted, median: { raw: median(raw), adjusted: median(adjusted) },
    observed: raw.length,
  };
}

function donorDensity(repos, module) {
  return median(repos.filter((repo) => finished(repo) && repo.language === module).flatMap((repo) => {
    const lines = repo.sourceFiles.find((row) => row.module === module && row.scope === "source")?.readableLines;
    return lines ? [metric(repo, module, ["source"]).eligible / lines] : [];
  })) ?? 0;
}

const mdValue = (value) => value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
const code = (value) => {
  const delimiter = '`'.repeat(1 + Math.max(0, ...[...value.matchAll(/`+/g)].map(([part]) => part.length)));
  return `${delimiter} ${mdValue(value)} ${delimiter}`;
};

export function interval(successes, n) {
  if (!n) return [0, 1];
  const p = Math.max(0, Math.min(1, successes / n)), zSquared = 1.96 ** 2;
  const centre = p + zSquared / (2 * n);
  const radius = 1.96 * Math.sqrt((p * (1 - p) + zSquared / (4 * n)) / n);
  const scale = 1 + zSquared / n;
  return [Math.max(0, (centre - radius) / scale), Math.min(1, (centre + radius) / scale)];
}

export function estimateCoverage(repos, samples, module, allowed = scopes, population = reviewPopulation(repos)) {
  const measured = aggregate(repos, module, allowed).weighted;
  const active = new Map(repos.map((row) => [row.id, row]));
  const grouped = new Map();
  for (const sample of samples) {
    const row = active.get(sample.repo);
    if (!row || !finished(row)) continue;
    const key = reviewBucket(sample.stratum, sample.scope, sample.disposition);
    const entries = grouped.get(key) ?? [];
    const check = row.checks?.[sample.key];
    entries.push({ ...sample, check });
    grouped.set(key, entries);
  }
  const output = { measured, support: new Map(), outside: 0, dynamic: 0, unknown: 0, unknownUnresolved: 0,
    auditedUnresolved: 0, unaudited: 0, sampleCount: 0 };
  let squaredWeights = 0;
  for (const [key, count] of population) {
    const [language, , scope, disposition] = key.split(":");
    if ((module !== "overall" && language !== module) || !allowed.includes(scope)) continue;
    const rows = grouped.get(key) ?? [];
    const ambiguous = disposition === "eligible";
    const remaining = rows.filter(({ check }) => check !== "resolved" && check !== "outside");
    if (!remaining.length) {
      output.unknown += count;
      if (!ambiguous) output.unknownUnresolved += count;
      output.unaudited += count;
      continue;
    }
    const weight = count / remaining.length;
    output.sampleCount += remaining.length;
    if (!ambiguous) {
      output.auditedUnresolved += count;
      squaredWeights += weight * weight * remaining.length;
    }
    for (const { label, item, repo } of remaining) {
      if (label === "outside") output.outside += weight;
      if (label === "dynamic") output.dynamic += weight;
      if (label === "unknown") {
        output.unknown += weight;
        if (!ambiguous) output.unknownUnresolved += weight;
      }
      if (!item) continue;
      const entry = output.support.get(item) ?? { inside: 0, outside: 0, repos: new Set() };
      entry[label === "outside" ? "outside" : "inside"] += weight;
      entry.repos.add(repo);
      output.support.set(item, entry);
    }
  }
  const effectiveN = squaredWeights ? output.auditedUnresolved ** 2 / squaredWeights : 0;
  const [lo, hi] = interval(effectiveN * (ratio(output.outside, output.auditedUnresolved) ?? 0), effectiveN);
  const score = (outside) => ratio(measured.resolved, measured.eligible - outside);
  output.estimated = score(output.outside);
  output.range = [score(lo * output.auditedUnresolved), score(hi * output.auditedUnresolved)];
  output.ceiling = score(output.outside) === null ? null : 1 - output.dynamic / (measured.eligible - output.outside);
  output.unexplained = ratio(output.unknownUnresolved, measured.inside + measured.unclassified - output.outside);
  return output;
}

function completion(repos, baseline) {
  const before = new Map(baseline.map((repo) => [repo.id, repo]));
  const lines = ["## A. All 60 finish", "",
    `**${repos.filter(finished).length} of ${repos.length} finished.**`, ""];
  for (const repo of repos.filter((row) => !finished(row) || !finished(before.get(row.id) ?? row))) {
    const attempt = finished(repo) ? before.get(repo.id) : repo;
    const progress = attempt.failure?.lastProgress ?? "";
    const cause = attempt.outcome === "killed-for-memory" ? "Node heap exhausted"
      : progress.startsWith("graph analyze rust") ? "Rust analysis stalled at the wall limit"
        : progress.startsWith("graph resolve rust") ? "Rust resolution stalled at the wall limit" : attempt.outcome;
    lines.push(`- [${finished(repo) ? "x" : " "}] ${repo.id} · ${cause} · ${finished(repo) ? "finished" : "open"}`);
  }
  return lines;
}

function validateCatalog(items, samples) {
  const catalog = new Map();
  for (const item of items) {
    if (catalog.has(item.id) || !modules.includes(item.module) || item.examples.length !== 2 ||
        item.exact && (item.module !== "rust" || item.exact !== "rust-taint" || item.family)) {
      throw Error(`Invalid support item ${item.id}`);
    }
    catalog.set(item.id, item);
  }
  const keys = new Set();
  for (const sample of samples) {
    const { item, stratum, scope, label, key, disposition, basis } = sample;
    const action = item && catalog.get(item);
    const identity = `${key}:${reviewBucket(stratum, scope, disposition)}`;
    const module = stratum.split(":")[0];
    if (keys.has(identity) || !basis || !modules.includes(module) || !scopes.includes(scope) ||
        !["eligible", "inside", "unclassified"].includes(disposition) || !["support", "outside", "dynamic", "unknown"].includes(label) ||
        (["support", "outside"].includes(label) ? action?.module !== module || action.family : item) ||
        label === "outside" && disposition === "eligible" ||
        (stratum === "rust:failed-file-taint" && action && !action.exact)) throw Error(`Invalid sample label at ${sample.repo} ${sample.file}:${sample.line}`);
    keys.add(identity);
  }
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

function renderScore(repos, input, base, baseline, samples) {
  const lines = ["# SW-3 coverage scoreboard", "",
    `Result package ${code(input.release.package)}. ${base ? `Candidate records replace ${input.repos.length} matching baseline pins.` : `The baseline covers ${repos.length} pinned repositories.`}`,
    "", ...completion(repos, baseline), "", "## B. Coverage of finished graphs", "",
    "Raw counts every link. Strict removes proved outside unresolved links. Estimated-true also removes sampled outside links and keeps cannot-tell links in the denominator.",
    "Language rates use each module's links across the finished checkouts. The interval reflects sampling uncertainty. Candidate rates reuse the reference sample and can be less representative as the graphs change.", "",
    "| Files counted | Module | Graphs with links | Raw weighted | Strict weighted | Strict median | Estimated-true weighted (95% interval) |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |"];
  const pair = (row) => `${percent(row.raw)} / ${percent(row.adjusted)}`;
  const population = reviewPopulation(repos);
  for (const [label, allowed] of variants) for (const module of [...modules, "overall"]) {
    const a = aggregate(repos, module, allowed);
    const estimate = estimateCoverage(repos, samples, module, allowed, population);
    lines.push(`| ${label} | ${names[module]} | ${a.observed} | ${percent(a.weighted.raw)} | ${percent(a.weighted.adjusted)} | ${percent(a.median.adjusted)} | ${percent(estimate.estimated)} (${estimate.range.map(percent).join("–")}) |`);
  }
  if (base) {
    lines.push("", "### Candidate sampling", "", "| Module | Remaining reference sites used | Eligible gaps in buckets with no remaining sample |",
      "| --- | ---: | ---: |");
    for (const module of modules) {
      const { sampleCount, unaudited } = estimateCoverage(repos, samples, module, scopes, population);
      lines.push(`| ${names[module]} | ${number(sampleCount)} | ${number(unaudited)} |`);
    }
  }
  lines.push("", "## Source scopes", "", "Counts include every observed link. Broken and template files that produced no links appear in the failed-source column.", "",
    "| Module | Scope | Resolved | Ambiguous | Inside | Outside | Unclassified | Failed source files |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const module of modules) for (const scope of scopes) {
    const score = aggregate(repos, module, [scope]).weighted;
    const failed = repos.flatMap((repo) => repo.failedSources ?? []).filter((row) => row.module === module && row.scope === scope).reduce((sum, row) => sum + row.files, 0);
    lines.push(`| ${names[module]} | ${scope} | ${[score.resolved, score.ambiguous, score.inside, score.outside, score.unclassified, failed].map(number).join(" | ")} |`);
  }
  lines.push("", "## Repository results", "", "Rows include every module in a finished checkout. For each attempt, the archive holds the full link breakdown and the explicit inside, outside and unclassified counts for every file scope.", "",
    "| Repository | Selected language | Outcome | Links | Outside | Unclassified | All raw / adjusted | Source only raw / adjusted |",
    "| --- | --- | --- | ---: | ---: | ---: | --- | --- |");
  for (const repo of repos.filter(finished)) {
    const a = metric(repo, "overall", scopes), b = metric(repo, "overall", ["source"]);
    lines.push(`| ${repo.id} | ${names[repo.language]} | ${repo.outcome} | ${number(a.total)} | ${number(a.outside)} | ${number(a.unclassified)} | ${pair(a)} | ${pair(b)} |`);
  }
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
  const lines = [...completion(repos, baseline), "", "## B. Coverage of finished graphs"];
  const active = new Map(repos.filter(finished).map((repo) => [repo.id, repo]));
  const currentFailures = [...active.values()].flatMap((repo) => repo.failedSources.map((row) => ({ ...row, repo: repo.id })));
  const previousFailures = baseline.filter((repo) => finished(repo) && active.has(repo.id)).flatMap((repo) => repo.failedSources);
  const tainted = repos.map((repo) => failedRustInfluence(repo)).filter((row) => row.eligible);
  const example = ({ repo, file, line, code: source }) => `${repo} ${code(`${file}:${line}`)} ${code(source)}`;
  for (const module of modules) {
    const forecast = estimateCoverage(repos, samples, module);
    const { measured, support } = forecast;
    const density = donorDensity(baseline, module);
    const rows = items.filter((item) => item.module === module).map((item) => {
      const remaining = support.get(item.id) ?? { inside: 0, outside: 0, repos: new Set() };
      const reviewed = samples.filter((row) => row.item === item.id);
      const verified = reviewed.filter((sample) => {
        const check = active.get(sample.repo)?.checks?.[sample.key];
        return sample.label === "outside" ? check === "outside" : check === "resolved";
      }).length;
      const row = { ...item, inside: remaining.inside, outside: remaining.outside,
        links: number(remaining.inside + remaining.outside), repos: `≥${remaining.repos.size}`, status: "open" };
      if (verified) {
        row.status = verified === reviewed.length ? `all ${verified} reference sites settled`
          : `open · ${verified}/${reviewed.length} reference sites settled`;
      }
      if (item.exact) {
        row.links = `${number(tainted.reduce((sum, entry) => sum + entry.eligible, 0))} exact footprint`;
        row.repos = String(tainted.length);
        const before = baseline.filter((repo) => active.has(repo.id)).reduce((sum, repo) => sum + failedRustInfluence(repo).eligible, 0);
        const after = tainted.reduce((sum, entry) => sum + entry.eligible, 0);
        if (isProgress && after < before) row.status = `open · ${number(before - after)} fewer flagged links`;
      }
      if (item.family) {
        const matches = (failure) => failure.module === module && failure.family === item.family;
        const failed = currentFailures.filter(matches);
        const files = failed.reduce((sum, entry) => sum + entry.files, 0);
        const before = previousFailures.filter(matches).reduce((sum, entry) => sum + entry.files, 0);
        row.links = `~${number(failed.reduce((sum, entry) => sum + entry.lines * density, 0))} missing`;
        row.repos = String(new Set(failed.map((entry) => entry.repo)).size);
        if (isProgress && files < before) row.status = files ? `open · ${before - files} fewer failed files` : "zero failed files in current graphs";
      }
      return row;
    });
    lines.push("", `### ${names[module]}`, "",
      `Strict baseline **${percent(measured.adjusted)}**. Estimated-true **${percent(forecast.estimated)}** (${forecast.range.map(percent).join("–")}). Raw **${percent(measured.raw)}**.`, "",
      "| Support item | Links | Repositories | Points | Running total | Examples | Status |",
      "| --- | ---: | ---: | ---: | ---: | --- | --- |");
    let resolved = measured.resolved, denominator = measured.eligible;
    const score = () => ratio(resolved, denominator) ?? 0;
    const benefit = (row) => (ratio(measured.resolved + row.inside, measured.eligible - row.outside) ?? 0) -
      (measured.adjusted ?? 0);
    rows.sort((a, b) => benefit(b) - benefit(a) || compare(a.id, b.id));
    for (const row of rows) {
      resolved += row.inside;
      denominator -= row.outside;
      lines.push(`| ${mdValue(row.title)} | ${row.links} | ${row.repos} | ${points(benefit(row))} | ${percent(score())} | ${row.examples.map(example).join("<br>")} | ${row.status} |`);
    }
    lines.push("", `**${percent(measured.adjusted)} baseline → ${percent(score())} after the listed items (+${points(score() - (measured.adjusted ?? 0))}) → ${percent(forecast.ceiling)} estimated ceiling.** ${number(forecast.dynamic)} estimated links remain legitimately non-definite. ${number(forecast.unknownUnresolved)} unresolved links are unexplained (${percent(forecast.unexplained)} of estimated inside-unresolved).`);
  }
  return lines.join("\n");
}

function renderSampling(repos, samples) {
  const grouped = Map.groupBy(samples, (sample) => reviewBucket(sample.stratum, sample.scope, sample.disposition));
  const population = [...reviewPopulation(repos)].sort(([a], [b]) => compare(a, b));
  const lines = [
    "# Source sample review", "",
    `The fixed seed selected **${number(samples.length)}** source sites. Each has a label and a review basis in [the sample archive](samples.json.gz).`, "",
    "Sampling allocates about 420 sites per module in proportion to the observed eligible gap, with a minimum of six in buckets of at least 100 links and one in smaller buckets. Buckets combine the recorded reason family, source scope and strict disposition. The lowest fixed-seed hashes are selected within each bucket.", "",
    "Inside below means a source-supported shape or a site with legitimate runtime ambiguity that stays in the denominator. Cannot-tell sites stay eligible. The outside share for each unresolved bucket has a 95% Wilson interval. The language interval pools using the population weights and their effective sample size. These intervals describe sampling error. Source-trace judgment and unknown sites can introduce additional uncertainty.", "",
    "| Module, reason, scope and strict disposition | Links | Sampled | Support shape | Outside after all | Correctly ambiguous | Cannot tell | Estimated inside share | Estimated outside share (95% interval) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [key, count] of population) {
    const rows = grouped.get(key) ?? [];
    const n = rows.length;
    const label = (value) => rows.filter((row) => row.label === value).length;
    const shape = label("support"), outside = label("outside"), dynamic = label("dynamic"), unknown = label("unknown");
    const bounds = interval(outside, n).map(percent).join("–");
    const origin = key.endsWith(":eligible") || !n ? "— | —"
      : `${percent((shape + dynamic) / n)} (${interval(shape + dynamic, n).map(percent).join("–")}) | ${percent(outside / n)} (${bounds})`;
    lines.push(`| ${code(key)} | ${number(count)} | ${n} | ${shape} | ${outside} | ${dynamic} | ${unknown} | ${origin} |`);
  }
  lines.push("", "### Support labels within each sampled bucket", "",
    "| Bucket | Label and sampled count |", "| --- | --- |");
  for (const [key, rows] of [...grouped].sort(([a], [b]) => compare(a, b))) {
    const items = Map.groupBy(rows.filter((sample) => sample.item), (sample) => sample.item);
    if (items.size) {
      lines.push(`| ${code(key)} | ${[...items].sort(([a], [b]) => compare(a, b))
        .map(([item, matches]) => `${code(item)} ${matches.length}`).join(", ")} |`);
    }
  }
  const reasons = Map.groupBy(samples.filter((sample) => sample.label === "unknown"), (sample) => sample.basis);
  lines.push("", "## Cannot-tell labels", "");
  for (const [basis, rows] of [...reasons].sort(([a], [b]) => compare(a, b))) {
    const first = rows[0];
    lines.push(`- ${rows.length} sites. ${basis} Example ${first.repo} ${code(`${first.file}:${first.line}`)}.`);
  }
  lines.push("", "## Cross-checks from the tool-comparison candidates", "",
    "All counts here come from this sweep. The comparison supplied shapes to look for. Sample counts below are observations. The support tables estimate each shape's eligible links using the full bucket sizes. The direct scans count only their stated syntax and matching rules. [Comparison report](../sw-2/summary.md)", "",
    "| Stored graph shape | Labelled sites | Example |", "| --- | ---: | --- |");
  const shapes = [
    ["TypeScript sibling workspace package", ["ts-workspace"]],
    ["TypeScript nested function", ["ts-nested-function"]],
    ["TypeScript missing package config preset", ["ts-config-preset"]],
    ["TypeScript member of an object type", ["ts-object-member"]],
    ["Rust typed local or builder-chain receiver", ["rust-let", "rust-chain"]],
    ["Rust name brought into scope by a checkout glob", ["rust-glob"]],
    ["Rust Self or self dispatch through a trait impl", ["rust-self-trait"]],
    ["Rust call through an explicit use binding", ["rust-imported-function"]],
    ["Go member through an indexed or ranged value", ["go-container", "go-range"]],
  ];
  const examples = (rows) => [...new Set(rows.map(({ repo, file, line }) => `${repo} ${code(`${file}:${line}`)}`))]
    .slice(0, 2).join("<br>") || "—";
  for (const [shape, items] of shapes) {
    const matches = samples.filter((sample) => items.includes(sample.item));
    lines.push(`| ${shape} | ${matches.length} | ${examples(matches)} |`);
  }
  const goDynamic = samples.filter((sample) => sample.stratum.startsWith("go:") && sample.kind === "calls" &&
    sample.label === "dynamic" && /interface/i.test(sample.basis));
  lines.push(`| Go interface dispatch retained as runtime ambiguity | ${goDynamic.length} | ${examples(goDynamic)} |`);
  const workspace = repos.flatMap((repo) => (repo.workspaceMisses ?? []).map((row) => ({ repo: repo.id, ...row })));
  const workspaceCount = workspace.reduce((sum, row) => sum + row.links, 0);
  lines.push("", `Tracked npm and pnpm manifests identified **${number(workspaceCount)}** stored ` +
    `external-package links from ${new Set(workspace.map((entry) => entry.repo)).size} repositories naming a sibling workspace package. ` +
    "The strict denominator retains them. A package-name match establishes that the package is checked in. The source review also checks member and subpath context.");
  if (workspace.length) {
    lines.push("", "| Repository | Sibling packages | Links | Example |", "| --- | ---: | ---: | --- |");
    for (const [repo, rows] of Map.groupBy(workspace, (row) => row.repo)) {
      lines.push(`| ${repo} | ${rows.length} | ${number(rows.reduce((sum, row) => sum + row.links, 0))} | ${examples(rows.flatMap((row) =>
        row.examples.map((example) => ({ repo, ...example }))))} |`);
    }
  }
  const t3 = repos.find((repo) => repo.id === "pingdotgg/t3code" && repo.commit.startsWith("ea20e80") && finished(repo));
  if (t3 && !t3.workspaceMisses?.length) {
    lines.push("", "The sweep pins T3 Code at `ea20e80`, which declares a Bun workspace in package.json. The comparison used a different pnpm pin. The T3 Code sweep graph had no external-package edges with confirmed sibling package names.");
  }
  lines.push("", "### Candidate sites that have no stored link", "",
    "These source checks report visible omissions outside the graph denominator. TypeScript checks unique in-file callable declarations used as shorthand and explicitly typed object members. Go checks bare receiver names with package variable declarations and standalone identifier keys in explicit map literals with package declarations. A same-name declaration is a lead for review where source scope could shadow it. The totals describe these detectable patterns.", "",
    "| Source shape | Candidate sites | Repositories | Example |", "| --- | ---: | ---: | --- |");
  const omitted = repos.flatMap((repo) => (repo.sourceOmissions ?? []).map((row) => ({ repo: repo.id, ...row })));
  for (const [family, title] of [
    ["ts-object-member", "TypeScript member on an explicitly typed object"],
    ["ts-shorthand-function", "TypeScript shorthand passing a function"],
    ["go-package-receiver", "Go package variable used as a receiver"],
    ["go-map-key", "Go package name used as a map-literal key"],
  ]) {
    const rows = omitted.filter((row) => row.family === family);
    lines.push(`| ${title} | ${number(rows.reduce((sum, row) => sum + row.sites, 0))} | ${rows.length} | ${examples(rows.flatMap((row) =>
      row.examples.map((example) => ({ repo: row.repo, ...example }))))} |`);
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const { values } = parseArgs({ options: {
    results: { type: "string" }, base: { type: "string" }, scoreboard: { type: "string" }, plan: { type: "string" },
    "sampling-report": { type: "string" },
    items: { type: "string", default: "sweep/support-items.json" },
    samples: { type: "string", default: "evidence/sw-3/samples.json.gz" },
  } });
  if (!values.results) throw Error("Use --results FILE with an optional --base FILE, --scoreboard FILE or --plan FILE");
  const input = checkResult(read(values.results));
  const base = values.base ? checkResult(read(values.base)) : input;
  const repos = values.base ? merge(base, input).repos : input.repos;
  const { items } = read(values.items);
  const { samples } = read(values.samples);
  validateCatalog(items, samples);
  const scoreboard = renderScore(repos, input, values.base, base.repos, samples);
  if (values.scoreboard) writeFileSync(values.scoreboard, scoreboard);
  if (values.plan) {
    updatePlan(values.plan, renderPlan(repos, base.repos, items, samples, Boolean(values.base)));
  }
  if (values["sampling-report"]) writeFileSync(values["sampling-report"], renderSampling(base.repos, samples));
  if (!values.scoreboard && !values.plan && !values["sampling-report"]) process.stdout.write(scoreboard);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
