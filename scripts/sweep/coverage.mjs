// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { columns, externalEvidenceKinds, externalGapKinds, libraryScore, modules, repositoryScore, reviewBucket, reviewPopulation, rustTaint, scopes } from "./coverage-rules.mjs";

const schema = "pymtheg.sweep.coverage/v2";
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
    // A replacement without reference observations still has measured
    // counts. Its earlier source labels cannot establish a current bucket.
    repos.set(row.id, finished(row) ? { ...row, checks: row.checks ?? {} } : row);
  }
  return { ...candidate, repos: [...repos.values()].sort((a, b) => compare(a.id, b.id)) };
}

function checkResult(input) {
  if (input.schema !== schema || JSON.stringify(input.columns) !== JSON.stringify(columns)) throw Error("Expected a coverage-export results file with v2 columns");
  const ids = new Set();
  for (const repo of input.repos) {
    if (ids.has(repo.id) || !modules.includes(repo.language) || !/^[a-f0-9]{40}$/.test(repo.commit)) throw Error(`Invalid repository row for ${repo.id}`);
    if (finished(repo) && (!Array.isArray(repo.breakdown) || !repo.sourceFiles || !repo.reviewSites || !repo.failedSources)) throw Error(`Missing full breakdown for ${repo.id}`);
    for (const [module, , outcome, , , scope, disposition, count, blocked, level, encoding, gap] of repo.breakdown ?? []) {
      if (!modules.includes(module) || !scopes.includes(scope) || !Number.isSafeInteger(count) || count <= 0 ||
          !Number.isSafeInteger(blocked) || blocked < 0 || blocked > count ||
          (level === null ? disposition === "outside" || encoding !== null || gap !== null :
            outcome !== "unresolved" || ![0, 1, 2].includes(level) ||
            (level === 0 ? encoding !== null : !externalEvidenceKinds.includes(encoding)) ||
            (level === 2 ? gap !== null : !externalGapKinds.includes(gap))) ||
          (outcome === "unresolved" ? !["inside", "outside", "unclassified"].includes(disposition)
            : !["resolved", "ambiguous"].includes(outcome) || disposition !== "eligible")) throw Error(`Invalid breakdown for ${repo.id}`);
    }
    ids.add(repo.id);
  }
  return input;
}

const metric = (repo, module, allowed) => libraryScore(repo.breakdown ?? [], (language, scope) =>
  (module === "overall" || module === language) && allowed.includes(scope));

export function failedRustInfluence(repo, allowed = scopes) {
  const result = { total: 0, eligible: 0, missing: 0, blocked: 0, receivers: 0, allBlocked: 0 };
  for (const [module, , outcome, reason, uncertainty, scope, disposition, count, blocked, level] of repo.breakdown ?? []) {
    if (module !== "rust" || outcome !== "unresolved" || !allowed.includes(scope)) continue;
    result.allBlocked += blocked;
    if (!rustTaint(reason, uncertainty)) continue;
    result.total += count;
    if (level !== 2) result.missing += count;
    result.blocked += blocked;
    if (disposition !== "outside") result.eligible += count;
    if ([reason, uncertainty].some((value) => value?.includes("receiver-type-unverified"))) result.receivers += count;
  }
  return result;
}

export function aggregate(repos, module, allowed = scopes) {
  const observed = repos.filter(finished).map((repo) => metric(repo, module, allowed));
  const weighted = libraryScore(repos.filter(finished).flatMap((repo) => repo.breakdown), (language, scope) =>
    (module === "overall" || module === language) && allowed.includes(scope));
  const raw = observed.map((score) => score.raw).filter((n) => n !== null);
  const adjusted = observed.map((score) => score.adjusted).filter((n) => n !== null);
  const level2 = observed.map((score) => score.level2).filter((n) => n !== null);
  return {
    weighted, median: { raw: median(raw), adjusted: median(adjusted), level2: median(level2) },
    observed: raw.length,
  };
}

function donorDensity(repos, module) {
  return median(repos.filter((repo) => finished(repo) && repo.language === module).flatMap((repo) => {
    const lines = repo.sourceFiles.find((row) => row.module === module && row.scope === "source")?.readableLines;
    return lines ? [metric(repo, module, ["source"]).total / lines] : [];
  })) ?? 0;
}

const mdValue = (value) => value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
const code = (value) => {
  const delimiter = '`'.repeat(1 + Math.max(0, ...[...value.matchAll(/`+/g)].map(([part]) => part.length)));
  return `${delimiter} ${mdValue(value)} ${delimiter}`;
};

// Ratio estimate for a simple random sample of source sites within one
// stratum. A site can carry several stored links. Linearise on link totals
// per site and apply the finite-population correction to the site sample.
export function stratumShare(sites, populationSites, category) {
  const n = sites.length;
  if (!n) return { share: 0, variance: null };
  const links = sites.reduce((sum, site) => sum + site.links, 0);
  const value = (site) => site[category] ?? 0;
  const share = sites.reduce((sum, site) => sum + value(site), 0) / links;
  if (n === populationSites) return { share, variance: 0 };
  if (n < 2 || n > populationSites) return { share, variance: null };
  const residuals = sites.reduce((sum, site) => sum + (value(site) - share * site.links) ** 2, 0);
  return { share, variance: (1 - n / populationSites) * residuals / (n - 1) / n / (links / n) ** 2 };
}

// A noncensus sample containing only one outcome has zero observed
// variance. Bound the unsampled site share using the probability of zero
// hits, and allow all unsampled link multiplicity to fall in that tail.
function boundaryMargin(share, sites, populationSites, populationLinks) {
  const margin = { lower: 0, upper: 0 };
  if (!sites.length || sites.length >= populationSites || share > 0 && share < 1) return margin;
  const sampledLinks = sites.reduce((sum, site) => sum + site.links, 0);
  const extra = Math.max(0, populationLinks - populationSites - (sampledLinks - sites.length));
  const siteTail = Math.min(populationSites - sites.length, populationSites * -Math.expm1(Math.log(0.025) / sites.length));
  margin[share === 0 ? "upper" : "lower"] = Math.min(populationLinks, siteTail + extra);
  return margin;
}

const reviewable = (fact) => fact.state === "unresolved" || fact.state === "ambiguous";

// The draw was stratified before the candidate ran. Pair multiplicities at
// each source site, preferring unchanged observations, then reason-only
// moves. A changed outcome stops contributing its original miss weight.
function referencePairs(draw, current) {
  const pairs = draw.filter(({ fact }) => reviewable(fact)).map((row) => ({ ...row, left: row.fact.links, remaining: [] }));
  const available = current.map((fact) => ({ fact, left: fact.links }));
  for (const matches of [
    (a, b) => a.bucket === b.bucket && a.state === b.state,
    (a, b) => a.state === b.state,
  ]) for (const pair of pairs) for (const next of available) {
    if (!pair.left || !next.left || !matches(pair.fact, next.fact)) continue;
    const count = Math.min(pair.left, next.left);
    pair.left -= count;
    next.left -= count;
    pair.remaining.push({ ...next.fact, links: count });
  }
  return pairs;
}

function reviewedBuckets(repos, samples) {
  const active = new Map(repos.filter(finished).map((row) => [row.id, row]));
  const grouped = new Map();
  for (const rows of Map.groupBy(samples, (row) => row.key).values()) {
    const repo = active.get(rows[0].repo);
    const draw = rows.flatMap((sample) => sample.observations.map((fact) => ({ sample, fact })));
    const pairs = repo?.checks ? referencePairs(draw, repo.checks[rows[0].key] ?? []) : draw
      .filter(({ fact }) => reviewable(fact)).map((row) => ({ ...row, remaining: repo ? [row.fact] : [] }));
    for (const { sample, fact, remaining } of pairs) {
      const sites = grouped.get(fact.bucket) ?? new Map();
      grouped.set(fact.bucket, sites);
      const site = sites.get(sample.key) ?? { ...sample, links: 0, remaining: 0, outside: 0, dependency: 0, dynamic: 0, closed: 0, unknown: 0 };
      site.links += fact.links;
      for (const next of remaining.filter(reviewable)) {
        site.remaining += next.links;
        if (sample.label === "outside") site.outside += next.links;
        if (sample.horizon === "dependency") site.dependency += next.links;
        if (sample.horizon === "intrinsic") site.intrinsic = (site.intrinsic ?? 0) + next.links;
        if (sample.label === "dynamic") site.dynamic += next.links;
        if (sample.label === "unknown") site.unknown += next.links;
        const candidateKey = next.candidateKey ?? (!repo?.checks ? sample.candidateKey : null);
        if (next.state === "ambiguous" && sample.closed && candidateKey === sample.candidateKey) site.closed += next.links;
      }
      sites.set(sample.key, site);
    }
  }
  return grouped;
}

function designDomain(bucket) {
  const [module, , scope, disposition] = bucket.split(":");
  return `${module}:${scope}:${disposition === "eligible" ? "ambiguous" : "unresolved"}`;
}

export function auditDesign(repos, samples, baseline = repos) {
  const population = reviewPopulation(baseline);
  const grouped = reviewedBuckets(repos, samples);
  const sitePopulation = new Map();
  for (const repo of baseline.filter(finished)) for (const [bucket, count] of Object.entries(repo.reviewSites)) {
    sitePopulation.set(bucket, (sitePopulation.get(bucket) ?? 0) + count);
  }
  const remaining = new Map();
  const actual = new Map();
  for (const [key, count] of reviewPopulation(repos)) {
    const domain = designDomain(key);
    actual.set(domain, (actual.get(domain) ?? 0) + count);
  }
  for (const [key, count] of population) {
    const domain = designDomain(key);
    const sites = [...grouped.get(key)?.values() ?? []];
    const weight = stratumShare(sites, sitePopulation.get(key) ?? 0, "remaining").share;
    remaining.set(domain, (remaining.get(domain) ?? 0) + count * weight);
  }
  const factors = new Map([...remaining].map(([key, count]) => [key, count ? Math.min(1, (actual.get(key) ?? 0) / count) : 1]));
  return { population, grouped, sitePopulation, factors, actual, remaining, baseline };
}

export function estimateCoverage(repos, samples, module, allowed = scopes, design = auditDesign(repos, samples)) {
  const { population, grouped, sitePopulation, factors, actual, remaining, baseline } = design;
  const measured = aggregate(repos, module, allowed).weighted;
  const output = { measured, support: new Map(), outside: 0, dynamic: 0, closed: 0, dependency: 0, intrinsic: 0,
    unknownUnresolved: 0, insideOrUnknownUnresolved: 0, unaudited: 0, sampleCount: 0 };
  const variance = { outside: 0, dependency: 0, closed: 0 };
  const stratumVariances = new Map();
  const tails = Object.fromEntries(Object.keys(variance).map((category) => [category, { lower: 0, upper: 0 }]));
  const proven = (gap) => measured.gaps.get(gap) ?? 0;
  for (const [key, total] of actual) {
    const [language, scope, disposition] = key.split(":");
    if ((module !== "overall" && module !== language) || !allowed.includes(scope)) continue;
    const remainder = Math.max(0, total - (remaining.get(key) ?? 0));
    output.unaudited += remainder;
    if (disposition === "unresolved") {
      output.insideOrUnknownUnresolved += total;
      output.unknownUnresolved += remainder;
    }
  }
  for (const [key, count] of population) {
    const [language, , scope, disposition] = key.split(":");
    if ((module !== "overall" && language !== module) || !allowed.includes(scope)) continue;
    const sites = [...grouped.get(key)?.values() ?? []];
    const ambiguous = disposition === "eligible";
    const scale = factors.get(designDomain(key)) ?? 1;
    output.sampleCount += sites.filter((site) => site.remaining > 0).length;
    for (const category of ["outside", "dynamic", "closed", "dependency", "intrinsic", "unknown"]) {
      if (category === "closed" && !ambiguous) continue;
      const populationSites = sitePopulation.get(key) ?? 0;
      const { share, variance: within } = stratumShare(sites, populationSites, category);
      if (!ambiguous && (category === "outside" || category === "dynamic")) output.insideOrUnknownUnresolved -= scale * count * share;
      if (category === "unknown") {
        if (!ambiguous) output.unknownUnresolved += scale * count * share;
        continue;
      }
      output[category] += scale * count * share;
      if (Object.hasOwn(variance, category)) {
        if (within === null) {
          tails[category].lower += scale * count * share;
          tails[category].upper += scale * count * (1 - share);
        } else {
          const { lower, upper } = boundaryMargin(share, sites, populationSites, count);
          tails[category].lower += scale * lower;
          tails[category].upper += scale * upper;
          const value = (scale * count) ** 2 * within;
          variance[category] += value;
          if (!stratumVariances.has(key)) stratumVariances.set(key, {});
          stratumVariances.get(key)[category] = value;
        }
      }
    }
    const reviewedLinks = sites.reduce((sum, site) => sum + site.links, 0);
    for (const { label, item, repo, remaining, horizon } of sites) {
      if (!remaining || !item || horizon || !["support", "outside"].includes(label)) continue;
      const entry = output.support.get(item) ?? { inside: 0, outside: 0, repos: new Set() };
      entry[label === "outside" ? "outside" : "inside"] += scale * count * remaining / reviewedLinks;
      entry.repos.add(repo);
      output.support.set(item, entry);
    }
  }
  const overlapping = new Set(baseline.filter(finished).flatMap((row) =>
    (row.reviewOverlap ?? []).map((pair) => JSON.stringify(pair))));
  for (const pair of overlapping) {
    const [a, b] = JSON.parse(pair).map((key) => stratumVariances.get(key));
    if (!a || !b) continue;
    for (const category of Object.keys(variance)) {
      // Shared source-site ranks can correlate the two strata. Bound their
      // covariance instead of treating those strata as independent.
      variance[category] += 2 * Math.sqrt((a[category] ?? 0) * (b[category] ?? 0));
    }
  }
  const covered = measured.resolved + measured.symbol;
  output.closedCoverage = ratio(covered + output.closed, measured.total);
  output.closedUpper = ratio(covered + measured.ambiguous, measured.total);
  const fixedLoss = output.dynamic + output.intrinsic + proven("whole-unit") + proven("intrinsic");
  output.dependency += proven("dependency");
  output.ceiling = ratio(measured.total - fixedLoss - output.dependency, measured.total);
  output.ceilingWithMetadata = ratio(measured.total - fixedLoss, measured.total);
  output.unexplained = ratio(output.unknownUnresolved, output.insideOrUnknownUnresolved);
  output.intervals = Object.fromEntries(Object.entries(variance).map(([category, value]) => {
    const count = output[category], radius = 1.96 * Math.sqrt(value);
    return [category, [Math.max(0, count - radius - tails[category].lower),
      Math.min(measured.total - covered, count + radius + tails[category].upper)]];
  }));
  return output;
}

function completion(repos, baseline) {
  const before = new Map(baseline.map((repo) => [repo.id, repo]));
  const lines = ["## A. All 60 finish", "",
    `**${repos.filter(finished).length} of ${repos.length} finished.**`, ""];
  for (const repo of repos.filter((row) => !finished(row) || !finished(before.get(row.id) ?? row))) {
    const attempt = finished(repo) ? before.get(repo.id) : repo;
    const progress = attempt.failure?.lastProgress ?? "";
    const profiledSerde = attempt.id === "serde-rs/serde" && attempt === before.get(repo.id) && attempt.outcome === "wall-limit";
    const cause = attempt.outcome === "killed-for-memory" ? "Node heap exhausted"
      : profiledSerde ? "Rust resolution stalled in recursive scope and use lookups"
        : /^graph analyze rust: (\d+)\/\1$/.test(progress) ? "Wall limit after Rust analysis completed"
        : progress.startsWith("graph analyze rust") ? "Rust analysis stalled at the wall limit"
        : progress.startsWith("graph resolve rust") ? "Rust resolution stalled at the wall limit" : attempt.outcome;
    lines.push(`- [${finished(repo) ? "x" : " "}] ${repo.id} · ${cause} · ${finished(repo) ? "finished" : "open"}`);
  }
  return lines;
}

function validateCatalog(items, samples) {
  const catalog = new Map();
  for (const item of items) {
    if (catalog.has(item.id) || !modules.includes(item.module) || !["inside", "library", "both"].includes(item.kind) ||
        item.examples.length !== 2 ||
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
        (["support", "outside"].includes(label) ? action?.module !== module || action.family || action.representation ||
          action.kind === (label === "support" ? "library" : "inside") : item) ||
        !Array.isArray(sample.observations) || !sample.observations.length ||
        sample.closed && (label !== "dynamic" || !sample.candidateKey) ||
        sample.horizon && (label !== "outside" || !["dependency", "intrinsic"].includes(sample.horizon)) ||
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
    "Level 2 counts resolved checkout links and named library symbols over all stored links. Level 1 also credits named library units. Strict-inside excludes the proven outside partition. Raw credits only the stored resolved outcome.",
    "The closed-set alternative adds the sample estimate for verified complete candidate sets. Candidate evaluations reuse the reference sample.", "",
    "| Files counted | Module | Graphs | Level 2 | Level 1 | L2 + verified closed sets (95% interval) | L2 median | Strict-inside weighted / median | Raw |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"];
  const design = auditDesign(repos, samples, baseline);
  for (const [label, allowed] of variants) for (const module of [...modules, "overall"]) {
    const a = aggregate(repos, module, allowed);
    const { closedCoverage, intervals } = estimateCoverage(repos, samples, module, allowed, design);
    const closedRange = intervals.closed.map((n) => percent(ratio(a.weighted.resolved + a.weighted.symbol + Math.min(n, a.weighted.ambiguous), a.weighted.total))).join("–");
    lines.push(`| ${label} | ${names[module]} | ${a.observed} | ${percent(a.weighted.level2)} | ${percent(a.weighted.level1)} | ${percent(closedCoverage)} (${closedRange}) | ${percent(a.median.level2)} | ${percent(a.weighted.adjusted)} / ${percent(a.median.adjusted)} | ${percent(a.weighted.raw)} |`);
  }
  if (base) {
    lines.push("", "### Candidate sampling", "", "| Module | Remaining reference sites used | Missed links outside the remaining projection |",
      "| --- | ---: | ---: |");
    for (const module of modules) {
      const { sampleCount, unaudited } = estimateCoverage(repos, samples, module, scopes, design);
      lines.push(`| ${names[module]} | ${number(sampleCount)} | ${number(unaudited)} |`);
    }
  }
  lines.push("", "## What the released store says about outside links", "",
    "Unit and symbol counts are exact on stored links with proof of outside origin. The final column estimates additional outside sites whose current facts name neither.",
    "The audit recovers these identities from paths, import bindings, named declaring traits or directives. The target-ID slot points to a symbol in a captured file. The released graph has no first-class external target nodes.", "",
    "| Module | Proven outside | Named unit, including L2 | Unit only | Unit and symbol | Neither, proven outside | Additional outside with neither (95% interval) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const module of [...modules, "overall"]) {
    const a = estimateCoverage(repos, samples, module, scopes, design);
    const m = a.measured;
    lines.push(`| ${names[module]} | ${[m.provenOutside, m.identifiedUnit, m.unitOnly, m.symbol, m.neither].map(number).join(" | ")} | ${number(a.outside)} (${a.intervals.outside.map(number).join("–")}) |`);
  }
  lines.push("", "### Recorded library identities by encoding", "",
    "| Module | Encoding | Level 1 only | Level 2 | Example |",
    "| --- | --- | ---: | ---: | --- |");
  const libraryExamples = repos.flatMap((repo) => (repo.libraryExamples ?? []).map((site) => ({ repo: repo.id, ...site })));
  for (const module of modules) for (const encoding of externalEvidenceKinds) {
    const counts = [0, 0, 0];
    for (const repo of repos.filter(finished)) for (const row of repo.breakdown) {
      if (row[0] === module && row[10] === encoding) counts[row[9]] += row[7];
    }
    if (!counts[1] && !counts[2]) continue;
    const example = libraryExamples.find((site) => site.module === module && site.evidence === encoding && site.level === (counts[2] ? 2 : 1));
    const location = example ? `${example.repo} ${code(`${example.file}:${example.line}`)} ${code([example.unit, example.symbol].filter(Boolean).join(" → "))}` : "—";
    lines.push(`| ${names[module]} | ${encoding} | ${number(counts[1])} | ${number(counts[2])} | ${location} |`);
  }
  lines.push("", "## Source scopes", "", "Counts include every observed link. Broken and template files that produced no links appear in the failed-source column.", "",
    "| Module | Scope | Resolved | Ambiguous | Inside | Outside | Unclassified | Failed source files |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const module of modules) for (const scope of scopes) {
    const score = aggregate(repos, module, [scope]).weighted;
    const failed = repos.flatMap((repo) => repo.failedSources ?? []).filter((row) => row.module === module && row.scope === scope).reduce((sum, row) => sum + row.files, 0);
    lines.push(`| ${names[module]} | ${scope} | ${[score.resolved, score.ambiguous, score.inside, score.outside, score.unclassified, failed].map(number).join(" | ")} |`);
  }
  lines.push("", "## Repository results", "", "Totals include every module in a finished checkout. For each attempt, the archive holds the full link breakdown and the explicit inside, outside and unclassified counts for every file scope.", "",
    "| Repository | Selected language | Outcome | Links | Proven outside | Level 2 | Level 1 | Strict-inside | Raw | Source-only L2 |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const repo of repos.filter(finished)) {
    const a = metric(repo, "overall", scopes), b = metric(repo, "overall", ["source"]);
    lines.push(`| ${repo.id} | ${names[repo.language]} | ${repo.outcome} | ${number(a.total)} | ${number(a.provenOutside)} | ${percent(a.level2)} | ${percent(a.level1)} | ${percent(a.adjusted)} | ${percent(a.raw)} | ${percent(b.level2)} |`);
  }
  lines.push("", "## Rust failed-file influence", "", "These are exact stored unresolved counts. The eligible column uses the earlier audit disposition. The L2 misses column retains tainted library sites whose symbol is unproved. One site with both failure and receiver reasons belongs to the taint item.", "",
    "| Repository | Unresolved with failed-file reason | Earlier eligible | L2 misses | Tainted and blocked | Also receiver-unverified | All unresolved marked blocked |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const repo of repos) {
    const a = failedRustInfluence(repo);
    if (a.total || repo.failedSources?.some(({ module }) => module === "rust")) {
      lines.push(`| ${repo.id} | ${[a.total, a.eligible, a.missing, a.blocked, a.receivers, a.allBlocked].map(number).join(" | ")} |`);
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
  const tainted = repos.map((repo) => failedRustInfluence(repo)).filter((row) => row.missing);
  const design = auditDesign(repos, samples, baseline);
  const example = ({ repo, file, line, code: source }) => `${repo} ${code(`${file}:${line}`)} ${code(source)}`;
  for (const module of modules) {
    const forecast = estimateCoverage(repos, samples, module, scopes, design);
    const { measured, support } = forecast;
    const gain = (row) => ratio(row.inside + row.outside, measured.total) ?? 0;
    const density = donorDensity(baseline, module);
    const rows = items.filter((item) => item.module === module).map((item) => {
      const remaining = support.get(item.id) ?? { inside: 0, outside: 0, repos: new Set() };
      const reviewed = samples.filter((row) => row.item === item.id);
      const verified = reviewed.filter((sample) => {
        const facts = active.get(sample.repo)?.checks?.[sample.key] ?? [];
        const settled = (fact) => sample.label === "outside" ? fact.library?.level === 2 : fact.state === "resolved";
        return facts.length && facts.every(settled) && sample.observations.some((fact) => !settled(fact));
      }).length;
      const exactOutside = measured.gaps.get(item.id) ?? 0;
      const affected = new Set(remaining.repos);
      if (exactOutside) for (const repo of active.values()) {
        if (repo.breakdown.some((link) => link[0] === module && link[11] === item.id)) affected.add(repo.id);
      }
      const row = { ...item, inside: remaining.inside, outside: remaining.outside + exactOutside,
        links: number(remaining.inside + remaining.outside + exactOutside), repos: `≥${affected.size}`, status: "open" };
      if (item.representation) {
        row.links = `${number(measured.identifiedUnit)} named links`;
        row.repos = String([...active.values()].filter((repo) => metric(repo, module, scopes).identifiedUnit).length);
      }
      if (verified) {
        row.status = verified === reviewed.length ? `all ${verified} reference sites settled`
          : `open · ${verified}/${reviewed.length} reference sites settled`;
      }
      if (item.exact) {
        row.links = `${number(tainted.reduce((sum, entry) => sum + entry.missing, 0))} exact L2 misses`;
        row.repos = String(tainted.length);
        const before = baseline.filter((repo) => active.has(repo.id)).reduce((sum, repo) => sum + failedRustInfluence(repo).missing, 0);
        const after = tainted.reduce((sum, entry) => sum + entry.missing, 0);
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
    const noBundles = aggregate(repos, module, scopes.filter((scope) => scope !== "bundle")).weighted;
    lines.push("", `### ${names[module]}`, "",
      `**Level 2 ${percent(measured.level2)}** · Level 1 ${percent(measured.level1)} · Strict-inside ${percent(measured.adjusted)} · Raw ${percent(measured.raw)}.`,
      `**If verified closed sets count** ${percent(forecast.closedCoverage)}. Crediting every ambiguous link would give an arithmetic upper bound of ${percent(forecast.closedUpper)}.`, "");
    if (module === "typescript") lines.push(`**Bundle scope** ${percent(measured.level2)} including bundles and ${percent(noBundles.level2)} without them. Should checked-in minified bundles count toward the release target?`, "");
    lines.push("| Support item | Kind | Links | Repositories | Points | Running total | Examples | Status |",
      "| --- | --- | ---: | ---: | ---: | ---: | --- | --- |");
    const kind = { inside: "Inside target", library: "Library target", both: "Both" };
    let covered = measured.resolved + measured.symbol;
    const score = () => ratio(covered, measured.total);
    rows.sort((a, b) => gain(b) - gain(a) || compare(a.id, b.id));
    for (const row of rows) {
      covered += row.inside + row.outside;
      lines.push(`| ${mdValue(row.title)} | ${kind[row.kind]} | ${row.links} | ${row.repos} | ${points(gain(row))} | ${percent(score())} | ${row.examples.map(example).join("<br>")} | ${row.status} |`);
    }
    const wholeUnit = measured.gaps.get("whole-unit") ?? 0;
    const intrinsics = forecast.intrinsic + (measured.gaps.get("intrinsic") ?? 0);
    const unattributedOutside = measured.gaps.get("unknown") ?? 0;
    lines.push("", `**${percent(measured.level2)} baseline → ${percent(score())} after the listed items (+${points((score() ?? 0) - (measured.level2 ?? 0))}) → ${percent(forecast.ceiling)} source-only ceiling.** ${number(forecast.unknownUnresolved)} unresolved links remain unexplained (${percent(forecast.unexplained)} of links estimated inside or still unclassified). ${number(forecast.dynamic)} estimated links have valid alternatives, ${number(wholeUnit)} name a unit only by design, and ${number(intrinsics)} are language intrinsics without a library symbol.`,
      `About ${number(forecast.dependency)} links need dependency information (${forecast.intervals.dependency.map(number).join("–")} from the sample and exact gaps). The ${percent(forecast.ceilingWithMetadata)} ceiling assumes all of those misses are recovered.`);
    if (module === "go" && forecast.ceiling !== null && forecast.ceiling < 0.9) {
      lines.push(`Go stays below 90% on the source-only Level 2 estimate (${percent(forecast.ceiling)}).`);
    }
    if (module === "go" && forecast.ceiling !== null) {
      const recordedBuiltins = measured.gaps.get("intrinsic") ?? 0;
      const withBuiltins = ratio(measured.resolved + measured.symbol + recordedBuiltins, measured.total);
      lines.push(`**Should identified Go builtins count?** The current Level 2 measure gives ${percent(measured.level2)} and a source-only ceiling of ${percent(forecast.ceiling)}. Crediting the ${number(recordedBuiltins)} recorded builtin links would give ${percent(withBuiltins)} and a ceiling of ${percent(forecast.ceiling + recordedBuiltins / measured.total)}.`);
      if (forecast.intrinsic) {
        lines.push(`If the estimated ${number(forecast.intrinsic)} additional intrinsic calls were also identified, the ceiling would be ${percent(forecast.ceiling + intrinsics / measured.total)}.`);
      }
    }
    if (unattributedOutside) lines.push(`${number(unattributedOutside)} proved outside links also lack an identified support shape.`);
    if (module === "rust") {
      const modelled = rows.filter((row) => ["rust-value", "rust-let"].includes(row.id)).reduce((sum, row) => sum + gain(row), 0);
      lines.push(`The previous strict-inside plan assigned about 22 pp to local binding anchors and source-only local receiver inference. Those choices account for ${points(modelled)} on this denominator. The library receiver item requires the declaring owner. A checkout trait declaring the same method or a local type shadowing the imported name must be ruled out before taking library credit from a receiver.`);
    }
  }
  return lines.join("\n");
}

function renderSampling(repos, samples) {
  const grouped = Map.groupBy(samples, (sample) => reviewBucket(sample.stratum, sample.scope, sample.disposition));
  const population = [...reviewPopulation(repos)].sort(([a], [b]) => compare(a, b));
  const reviewed = reviewedBuckets(repos, samples);
  const siteCounts = new Map();
  for (const repo of repos.filter(finished)) for (const [key, n] of Object.entries(repo.reviewSites)) {
    siteCounts.set(key, (siteCounts.get(key) ?? 0) + n);
  }
  const lines = [
    "# Source sample review", "",
    `The fixed seed selected **${number(samples.length)}** distinct sites within their strata. Each has a review label, source basis and the current observed link multiplicity in [the sample archive](samples.json.gz).`, "",
    "Strata use the recorded reason family, source scope and audit disposition. Equal-probability site samples use the smallest hashes within each stratum. All links at each selected site contribute. The estimates multiply the link-weighted sample share by the exact link population in the stratum.",
    "Intervals use per-stratum ratio-estimator variance with a finite-population correction on site counts. The normal interval sums those variances and bounds covariance when strata share a source-site hash. A noncensus stratum with fewer than two sites contributes its full possible range. For a noncensus sample with all or no matches, a conservative zero-hit bound allows for an unseen category and its unsampled link multiplicity. Source judgment and missed origins can add error.", "",
    "| Bucket | Sites sampled | Stored links at those sites | Inside misses | Outside L2 | Outside L1 only | Outside neither | Valid alternatives | Cannot tell |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [key, rows] of [...grouped].sort(([a], [b]) => compare(a, b))) {
    const counts = [0, 0, 0, 0, 0, 0];
    for (const sample of rows) for (const fact of sample.observations) {
      if (fact.library?.level === 2) counts[1] += fact.links;
      else if (fact.library?.level === 1) counts[2] += fact.links;
      else if (fact.library?.level === 0 || sample.label === "outside") counts[3] += fact.links;
      else if (sample.label === "support") counts[0] += fact.links;
      else if (sample.label === "dynamic") counts[4] += fact.links;
      else counts[5] += fact.links;
    }
    lines.push(`| ${code(key)} | ${rows.length} | ${counts.reduce((n, v) => n + v, 0)} | ${counts.join(" | ")} |`);
  }
  lines.push("", "### Remaining strata after exact outside identification", "",
    "| Bucket | Population sites | Population links | Reviewed sites | Reviewed links | Outside share (95% interval) |",
    "| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const [key, count] of population) {
    const sites = [...reviewed.get(key)?.values() ?? []];
    const n = siteCounts.get(key) ?? 0;
    const { share, variance } = stratumShare(sites, n, "outside");
    const radius = variance === null ? 1 : 1.96 * Math.sqrt(variance);
    const { lower, upper } = boundaryMargin(share, sites, n, count);
    const interval = [Math.max(0, share - radius - lower / count), Math.min(1, share + radius + upper / count)].map(percent).join("–");
    const links = sites.reduce((sum, site) => sum + site.links, 0);
    lines.push(`| ${code(key)} | ${number(n)} | ${number(count)} | ${sites.length} | ${links} | ${sites.length ? `${percent(share)} (${interval})` : "—"} |`);
  }
  const closed = samples.filter((sample) => sample.closed);
  lines.push("", "### Reviewed closed candidate sets", "");
  if (!closed.length) lines.push("The reviewed sites established no complete candidate set.");
  for (const sample of closed) lines.push(`- ${sample.repo} ${code(`${sample.file}:${sample.line}`)}. ${sample.closed}`);
  lines.push("", "### Library misses that need dependency information", "");
  for (const module of modules) {
    const examples = samples.filter((sample) => sample.horizon === "dependency" && sample.stratum.startsWith(`${module}:`)).slice(0, 2);
    for (const sample of examples) lines.push(`- **${names[module]}** ${sample.repo} ${code(`${sample.file}:${sample.line}`)}. ${sample.basis}`);
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
