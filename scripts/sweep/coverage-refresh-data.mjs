// SPDX-License-Identifier: MIT
import { libraryScore, modules } from "./coverage-rules.mjs";

export const schema = "pymtheg.sweep.refresh/v1";
export const sampleSize = 150;
export const seed = "pymtheg-0.2.0-coverage-2026-11-19";
export const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const missColumns = ["module", "kind", "outcome", "reasons", "links"];
export const modeNames = ["bare", "installed", "go-toolchain"];
/** C-43: modes an archive may hold; sweeps before C-43 have none of them. */
export const optionalModeNames = ["rust-toolchain"];
const modeLanguage = { installed: "typescript", "go-toolchain": "go", "rust-toolchain": "rust" };

export function storedReasons(data) {
  const fields = [data.reason, data.open?.reason, ...(data.open?.reasons ?? []),
    data.uncertainty, data.reasonWithoutConfig];
  return [...new Set(fields.filter((value) => typeof value === "string")
    .flatMap((value) => value.split(/;\s*/)).map((value) => value.trim()).filter(Boolean))];
}

export function firstBlocker(reasons, outcome) {
  return reasons[0] ?? ({ library: "(unit only)", ambiguous: "(candidate set)" }[outcome] ?? "(no reason)");
}

export function score(repos, module, own = false) {
  const total = { links: 0, level2: 0, assumed: 0 };
  // D17 clarified: route-decided Level 2 links labelled seen, from exports
  // that count them (`labelled` says whether any did).
  let seen = 0, labelled = false;
  for (const repo of repos) {
    if (!repo.counts || own && repo.language !== module) continue;
    for (const field of Object.keys(total)) total[field] += repo.counts[module][field];
    if (repo.counts[module].seen !== undefined) {
      labelled = true;
      seen += repo.counts[module].seen;
    }
  }
  return labelled ? { ...total, seen } : total;
}

/** D23: merged environment globals of one language, already in its Level 2. */
export function mergedGlobalCount(repos, module, own = false) {
  let merged = 0;
  for (const repo of repos) {
    if (!repo.counts || own && repo.language !== module) continue;
    merged += repo.counts[module]?.merged ?? 0;
  }
  return merged;
}

export function baselineScore(repos, module, own = false) {
  const rows = repos.filter((repo) => !own || repo.language === module).flatMap((repo) => repo.breakdown ?? []);
  const { total, resolved, symbol, assumedLevel2 } = libraryScore(rows, (language) => language === module);
  return { links: total, level2: resolved + symbol, assumed: assumedLevel2 };
}

export function pairedRepos(bare, alternate, mode) {
  const byId = new Map(alternate.map((repo) => [repo.id, repo]));
  return bare.map((repo) => {
    const candidate = byId.get(repo.id);
    const usable = candidate?.counts && (mode === "installed" ? candidate.install?.status === "installed" : candidate.toolchain?.state === "used");
    return usable ? candidate : repo;
  });
}

export function missGroups(repos, module) {
  const groups = new Map();
  for (const repo of repos) {
    for (const [language, kind, outcome, reasons, count] of repo.inventory ?? []) {
      if (language !== module) continue;
      const reason = firstBlocker(reasons, outcome);
      const key = JSON.stringify([module, reason]);
      if (!groups.has(reason)) groups.set(reason, { reason, count: 0, kinds: new Map(), pins: new Set(), examples: [], candidates: [] });
      const group = groups.get(reason);
      group.count += count;
      group.kinds.set(kind, (group.kinds.get(kind) ?? 0) + count);
      // Attach each pin's shortlists once, even if it has several link kinds.
      if (!group.pins.has(repo.id)) {
        group.pins.add(repo.id);
        group.examples.push(...repo.examples?.[key] ?? []);
        group.candidates.push(...repo.shortlist?.[key] ?? []);
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || compare(a.reason, b.reason));
}

export function proportionalQuotas(groups, limit) {
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const size = Math.min(total, limit);
  const allocation = groups.map(({ reason, count }) => ({ reason, quota: Math.floor(count * size / total), remainder: count * size % total }));
  const remaining = size - allocation.reduce((sum, row) => sum + row.quota, 0);
  allocation.sort((a, b) => b.remainder - a.remainder || compare(a.reason, b.reason));
  return new Map(allocation.map(({ reason, quota }, index) => [reason, quota + Number(index < remaining)]));
}

export function draw(repos, limit = sampleSize) {
  return modules.flatMap((module) => {
    const groups = missGroups(repos, module);
    const quotas = proportionalQuotas(groups, limit);
    return groups.flatMap(({ reason, candidates }) => {
      const quota = quotas.get(reason);
      if (quota > candidates.length) throw Error(`Missing candidates for ${module}/${reason}`);
      return candidates.sort((a, b) => compare(a.rank, b.rank)).slice(0, quota);
    });
  });
}

export function verifyModes(modes, pins) {
  const digests = new Set();
  for (const mode of [...modeNames, ...optionalModeNames.filter((name) => modes[name])]) {
    const input = modes[mode];
    if (!input || input.mode !== (mode === "bare" ? "source-only (default)" : mode) ||
        JSON.stringify(input.missColumns) !== JSON.stringify(missColumns)) throw Error(`Missing ${mode} export`);
    if (!/^[a-f0-9]{64}$/.test(input.release?.sha256)) throw Error(`Missing build digest for ${mode}`);
    digests.add(input.release.sha256);
    const expected = pins.filter((pin) => mode === "bare" || pin.language === modeLanguage[mode]);
    const byId = new Map(input.repos.map((repo) => [repo.id, repo]));
    if (byId.size !== expected.length || input.repos.length !== expected.length) throw Error(`Expected ${expected.length} unique ${mode} attempts`);
    for (const pin of expected) {
      const repo = byId.get(pin.id);
      if (!repo || repo.commit !== pin.commit || repo.language !== pin.language) throw Error(`Missing ${mode} attempt for ${pin.id}`);
      if ((repo.measuredCommit !== undefined || repo.build !== undefined) &&
          (mode !== "installed" || !/^[a-f0-9]{40}$/.test(repo.measuredCommit) ||
            !/^[a-f0-9]{64}$/.test(repo.build?.sha256) || !repo.build.node)) {
        throw Error(`Invalid replay provenance for ${pin.id}`);
      }
      if (repo.outcome === "finished") {
        for (const [module, kind, outcome, reasons, count] of repo.inventory) {
          if (!modules.includes(module) || !kind || !["ambiguous", "library", "unresolved"].includes(outcome) ||
              !Array.isArray(reasons) || reasons.some((reason) => typeof reason !== "string" || !reason) ||
              !Number.isSafeInteger(count) || count <= 0) throw Error(`Invalid miss inventory for ${repo.id}`);
        }
        for (const module of modules) {
          const { links, level2, assumed } = repo.counts[module];
          const misses = repo.inventory.reduce((sum, row) => sum + (row[0] === module ? row[4] : 0), 0);
          if (![links, level2, assumed, misses].every(Number.isSafeInteger) ||
              assumed < 0 || level2 < assumed || misses < 0 || links !== level2 + misses) {
            throw Error(`Unreconciled ${mode} totals for ${pin.id}/${module}`);
          }
        }
      } else if (repo.counts || repo.inventory) throw Error(`Unfinished ${mode} attempt has scored links for ${pin.id}`);
    }
  }
  if (digests.size !== 1) throw Error("All modes must use the same build");
}

export function overlayInstalled(modes, replay, measuredCommit) {
  if (replay.mode !== "installed" || JSON.stringify(replay.missColumns) !== JSON.stringify(missColumns) ||
      !/^[a-f0-9]{40}$/.test(measuredCommit) || !/^[a-f0-9]{64}$/.test(replay.release?.sha256) || !replay.release.node) {
    throw Error("Expected an installed export with measured build provenance");
  }
  const previous = new Map(modes.installed.repos.map((repo) => [repo.id, repo]));
  const seen = new Set();
  for (const repo of replay.repos) {
    const pin = previous.get(repo.id);
    if (!pin || pin.commit !== repo.commit || pin.language !== repo.language || seen.has(repo.id)) {
      throw Error(`Unexpected installed replay attempt for ${repo.id}`);
    }
    seen.add(repo.id);
    previous.set(repo.id, { ...repo, measuredCommit, build: replay.release });
  }
  return { ...modes, installed: { ...modes.installed, repos: [...previous.values()] } };
}

const itemAnswers = new Set(["yes", "no", "unknown"]);
const staticAnswers = new Set(["bare", "outside", "none", "unknown"]);
export function readLabels(contents) {
  const labels = new Map();
  for (const line of contents.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [rank, staticAnswer, itemAnswer, note, origin = "", ...extra] = line.split("\t");
    if (!/^[a-f0-9]{64}$/.test(rank) || labels.has(rank) || !staticAnswers.has(staticAnswer) ||
        !itemAnswers.has(itemAnswer) || !note?.trim() || extra.length || staticAnswer === "none" && itemAnswer === "yes" ||
        origin !== "" && (origin !== "standard-library" || staticAnswer !== "bare")) {
      throw Error("Invalid or duplicate source review label");
    }
    labels.set(rank, { staticAnswer, itemAnswer, note, ...(origin && { standardLibrary: true }) });
  }
  return labels;
}

export function combineLabels(samples, labels) {
  const ranks = new Set(samples.map(({ rank }) => rank));
  if (samples.length !== ranks.size || labels.size !== ranks.size || [...ranks].some((rank) => !labels.has(rank))) {
    throw Error("Source review must label every drawn link exactly once");
  }
  return samples.map((row) => ({ ...row, ...labels.get(row.rank) }));
}

export function verifyReview(repos, samples) {
  const ranks = new Set();
  for (const row of samples) {
    if (!/^[a-f0-9]{64}$/.test(row.rank) || ranks.has(row.rank) || !modules.includes(row.module) ||
        !staticAnswers.has(row.staticAnswer) || !itemAnswers.has(row.itemAnswer) || !row.note?.trim() ||
        row.staticAnswer === "none" && row.itemAnswer === "yes" ||
        row.standardLibrary !== undefined && (row.standardLibrary !== true || row.staticAnswer !== "bare")) throw Error("Invalid or duplicate reviewed link");
    ranks.add(row.rank);
  }
  for (const module of modules) {
    const groups = missGroups(repos, module);
    const quotas = proportionalQuotas(groups, sampleSize);
    const reviewed = samples.filter((row) => row.module === module);
    if (reviewed.length !== sampleSize) throw Error(`Expected ${sampleSize} source labels for ${module}`);
    for (const group of groups) {
      const rows = reviewed.filter((row) => firstBlocker(row.reasons, row.outcome) === group.reason);
      if (rows.length !== quotas.get(group.reason) || rows.some((row) => !group.pins.has(row.repo))) {
        throw Error(`Unexpected review population for ${module}/${group.reason}`);
      }
    }
  }
}

function wilson(success, size) {
  const z = 1.959963984540054;
  const p = success / size;
  const denom = 1 + z ** 2 / size;
  const center = (p + z ** 2 / (2 * size)) / denom;
  const radius = z * Math.sqrt(p * (1 - p) / size + z ** 2 / (4 * size ** 2)) / denom;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

export function itemRange(count, samples) {
  if (!samples.length) return [0, count];
  const yes = samples.filter(({ itemAnswer }) => itemAnswer === "yes").length;
  const unknown = samples.filter(({ itemAnswer }) => itemAnswer === "unknown").length;
  if (samples.length === count) return [yes, yes + unknown];
  return [count * wilson(yes, samples.length)[0], count * wilson(yes + unknown, samples.length)[1]];
}

// Weighted Hoeffding bound. Sampling without replacement is at least as
// concentrated as independent draws with replacement for binary labels.
// A fully sampled stratum has no sampling error. Unknown or unsampled
// cases can fall anywhere in the interval. Three comparisons share alpha.
export function auditRange(groups, samples, categories) {
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  if (!total) return { observed: [0, 0], interval: [0, 0] };
  let lower = 0, upper = 0, weights = 0;
  for (const { reason, count } of groups) {
    const populationShare = count / total;
    const rows = samples.filter((row) => firstBlocker(row.reasons, row.outcome) === reason);
    if (!rows.length) { upper += populationShare; continue; }
    const yes = rows.filter(({ staticAnswer }) => categories.includes(staticAnswer)).length;
    const unknown = rows.filter(({ staticAnswer }) => staticAnswer === "unknown").length;
    lower += populationShare * yes / rows.length;
    upper += populationShare * (yes + unknown) / rows.length;
    if (rows.length < count) weights += populationShare ** 2 / rows.length;
  }
  const margin = Math.sqrt(Math.log(6 / 0.05) * weights / 2);
  return { observed: [lower, upper], interval: [Math.max(0, lower - margin), Math.min(1, upper + margin)] };
}
