// SPDX-License-Identifier: MIT
// Deterministic cross-tool edge matching for the SW-2 comparison.
//
// MATCHING RULE (stated in evidence/sw-2/summary.md and scripts/compare/README.md)
//
// 1. Only in-project symbol-to-symbol edges are compared: class `call`,
//    `reference` or `heritage` (see lib/common.mjs), both ends in a
//    TypeScript/JavaScript, Go or Rust source file, target known. Unresolved,
//    external, import and structure edges are counted per tool but not matched.
// 2. Each tool's edges are reduced to symbol pairs: (source file, source symbol,
//    target file, target symbol), where a symbol is its normalised short name
//    (`.Get()` = `Get`, generics dropped) and a file-level source is "".
//    Several call sites between the same pair are one pair; their site lines
//    are kept.
// 3. Pass 1: two pairs from different tools are the same edge when file and
//    name match at both ends and each end's declaration line differs by at
//    most TOLERANCE lines (declaration line versus name line, decorators and
//    doc comments). When several qualify, the one with equal containers, then
//    the smallest total line difference, then the first in sorted order wins.
//    The container (receiver, class, impl type) never rejects a match; it
//    only breaks ties.
// 4. Pass 2: an edge still missing from some tool is merged with that tool's
//    unmatched edge to the same target (same target rule as pass 1) when both
//    are written in the same file and a call-site line agrees within 1 line.
//    This absorbs differences in which enclosing symbol a call is attributed
//    to (closures, initialisers, object-literal methods).
// 5. Edge kinds are not part of the key: a CodeGraph `instantiates` and a
//    Pymtheg `references` between the same two symbols are one edge with both
//    kinds recorded.
// Inputs are sorted first, so the same inputs always give the same output.

import { createHash } from "node:crypto";
import { COMPARED_CLASSES, cmp, isSourceFile } from "./common.mjs";

export const TOLERANCE = 3;
export const SITE_TOLERANCE = 1;

const coarseKey = (r) =>
  `${r.from.file}\u0000${r.from.symbol}\u0000${r.to.file}\u0000${r.to.symbol}`;

/** Reduce one tool's edges to comparable symbol pairs. */
export function pairsOf(result) {
  const map = new Map();
  for (const e of result.edges) {
    if (!COMPARED_CLASSES.has(e.class)) continue;
    if (!e.to || e.to.unresolved || e.to.external || !e.to.file) continue;
    if (!isSourceFile(e.from.file) || !isSourceFile(e.to.file)) continue;
    const from = {
      file: e.from.file,
      symbol: e.from.symbol ?? "",
      container: e.from.container,
      declLine: e.from.declLine ?? e.from.line,
    };
    const to = {
      file: e.to.file,
      symbol: e.to.symbol ?? "",
      container: e.to.container,
      line: e.to.line,
      kind: e.to.kind ?? "other",
    };
    const k = `${coarseKey({ from, to })}\u0000${from.declLine ?? ""}\u0000${to.line ?? ""}\u0000${from.container ?? ""}\u0000${to.container ?? ""}`;
    let r = map.get(k);
    if (!r) {
      r = {
        key: k,
        coarse: coarseKey({ from, to }),
        from,
        to,
        kinds: new Set(),
        classes: new Set(),
        certainties: new Set(),
        sites: new Set(),
        sets: [],
        targetKinds: new Set(),
      };
      map.set(k, r);
    }
    r.kinds.add(e.kind);
    r.targetKinds.add(to.kind);
    r.classes.add(e.class);
    r.certainties.add(e.certainty ?? "-");
    if (e.from.line != null && !e.from.noSite) r.sites.add(e.from.line);
    if (e.set) r.sets.push(e.set);
  }
  return [...map.values()].sort((a, b) => cmp(a.key, b.key));
}

const lineDiff = (a, b) => (a == null || b == null ? 0 : Math.abs(a - b));

function compatible(a, b) {
  const df = lineDiff(a.from.declLine, b.from.declLine);
  const dt = lineDiff(a.to.line, b.to.line);
  if (df > TOLERANCE || dt > TOLERANCE) return undefined;
  const sameContainers =
    (a.from.container ?? "") === (b.from.container ?? "") &&
    (a.to.container ?? "") === (b.to.container ?? "");
  return { score: (sameContainers ? 0 : 1000) + df + dt };
}

function targetCompatible(a, b) {
  return (
    a.to.file === b.to.file &&
    a.to.symbol === b.to.symbol &&
    lineDiff(a.to.line, b.to.line) <= TOLERANCE
  );
}

function sitesAgree(a, b) {
  if (a.from.file !== b.from.file) return false;
  for (const x of a.sites)
    for (const y of b.sites) if (Math.abs(x - y) <= SITE_TOLERANCE) return true;
  return false;
}

/**
 * Cluster edges from all tools. `results` is `[[tool, normalised], ...]` in a
 * fixed tool order. Returns clusters with `members[tool] = pair record`.
 */
export function cluster(results) {
  const clusters = [];
  const byCoarse = new Map();
  for (const [tool, result] of results) {
    for (const r of pairsOf(result)) {
      const group = byCoarse.get(r.coarse) ?? [];
      let best;
      for (const c of group) {
        if (c.members[tool]) continue;
        const rep = c.rep;
        const m = compatible(rep, r);
        if (m && (!best || m.score < best.score)) best = { c, score: m.score };
      }
      if (best) {
        best.c.members[tool] = r;
        best.c.via[tool] = "pair";
      } else {
        const c = {
          id: clusters.length,
          rep: r,
          members: { [tool]: r },
          via: { [tool]: "pair" },
        };
        clusters.push(c);
        group.push(c);
        byCoarse.set(r.coarse, group);
      }
    }
  }
  // Pass 2: merge clusters with disjoint tools, same target and agreeing call sites.
  const byTarget = new Map();
  for (const c of clusters) {
    const k = `${c.rep.from.file}\u0000${c.rep.to.file}\u0000${c.rep.to.symbol}`;
    if (!byTarget.has(k)) byTarget.set(k, []);
    byTarget.get(k).push(c);
  }
  const merged = new Set();
  for (const group of byTarget.values()) {
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      if (merged.has(a.id)) continue;
      for (let j = i + 1; j < group.length; j++) {
        const b = group[j];
        if (merged.has(b.id)) continue;
        const toolsA = Object.keys(a.members);
        const toolsB = Object.keys(b.members);
        if (toolsA.some((t) => toolsB.includes(t))) continue;
        const ok = toolsA.some((ta) =>
          toolsB.some(
            (tb) =>
              targetCompatible(a.members[ta], b.members[tb]) &&
              sitesAgree(a.members[ta], b.members[tb]),
          ),
        );
        if (!ok) continue;
        for (const t of toolsB) {
          a.members[t] = b.members[t];
          a.via[t] = "site";
        }
        merged.add(b.id);
      }
    }
  }
  return clusters.filter((c) => !merged.has(c.id));
}

/** How a tool that lacks an edge treats that call site, for classifying misses. */
export function siteIndex(result) {
  const idx = new Map();
  for (const e of result.edges) {
    if (e.class === "structure" || e.class === "import") continue;
    const k = e.from.file;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(e);
  }
  return {
    files: new Set(result.files ?? []),
    failed: new Set(result.failedFiles ?? []),
    partial: new Set(
      Object.entries(result.fileStatus ?? {})
        .filter(([, s]) => s === "partial")
        .map(([f]) => f),
    ),
    idx,
  };
}

export function stateAt(site, rec) {
  if (!site.files.has(rec.from.file)) return "file-not-indexed";
  if (site.failed.has(rec.from.file)) return "file-failed";
  const inFile = site.idx.get(rec.from.file) ?? [];
  // Without a known call site, look at everything the same source symbol links.
  const near = rec.sites.size
    ? inFile.filter((e) =>
        [...rec.sites].some(
          (l) => Math.abs((e.from.line ?? -99) - l) <= SITE_TOLERANCE,
        ),
      )
    : inFile.filter(
        (e) =>
          e.from.symbol === rec.from.symbol &&
          lineDiff(e.from.declLine, rec.from.declLine) <= TOLERANCE,
      );
  const same = near.filter((e) => e.to.symbol === rec.to.symbol);
  if (same.some((e) => e.to.unresolved)) {
    const u = same.find((e) => e.to.unresolved);
    return `unresolved(${u.reason ?? u.certainty ?? "-"})`;
  }
  if (same.some((e) => e.to.external)) return "external-target";
  if (
    same.some(
      (e) =>
        e.to.file === rec.to.file &&
        lineDiff(e.to.line, rec.to.line) <= TOLERANCE,
    )
  )
    return "same-target-other-source";
  if (same.length) return "other-target";
  if (site.partial.has(rec.from.file)) return "no-link-at-site(partial-file)";
  return "no-link-at-site";
}

const hash = (seed, s) =>
  createHash("sha256").update(`${seed}|${s}`).digest("hex");

function presenceOf(tool, r) {
  if (!r) return null;
  const c = [...r.certainties].sort();
  if (tool === "pymtheg") {
    if (c.some((x) => x.startsWith("definite")))
      return c.find((x) => x.startsWith("definite"));
    const set = r.sets[0];
    return set
      ? `candidate(${set.open ? "open" : "closed"} set of ${set.size})`
      : c[0];
  }
  return c.join("|");
}

function example(c, tools, sites, absentTools) {
  const rep = c.rep;
  const presence = Object.fromEntries(
    tools.map((t) => [t, presenceOf(t, c.members[t])]),
  );
  const kinds = Object.fromEntries(
    tools
      .filter((t) => c.members[t])
      .map((t) => [t, [...c.members[t].kinds].sort().join("|")]),
  );
  const siteLines = [
    ...new Set(
      tools.flatMap((t) => (c.members[t] ? [...c.members[t].sites] : [])),
    ),
  ].sort((a, b) => a - b);
  const out = {
    from: {
      file: rep.from.file,
      line: siteLines[0] ?? rep.from.declLine,
      symbol: rep.from.symbol,
      container: rep.from.container,
    },
    to: {
      file: rep.to.file,
      line: rep.to.line,
      symbol: rep.to.symbol,
      container: rep.to.container,
    },
    kinds,
    presence,
  };
  if (absentTools.length)
    out.absentState = Object.fromEntries(
      absentTools.map((t) => [
        t,
        stateAt(
          sites[t],
          rep.sites.size ? rep : { ...rep, sites: new Set(siteLines) },
        ),
      ]),
    );
  return out;
}

/**
 * Diff the tools that ran on one repository.
 * `results` is `[[tool, normalised], ...]`, Pymtheg first when present.
 */
export function diff(results, { seed = 1, sample = 25 } = {}) {
  const tools = results.map(([t]) => t);
  const clusters = cluster(results);
  const sites = Object.fromEntries(results.map(([t, r]) => [t, siteIndex(r)]));
  const comparable = Object.fromEntries(
    results.map(([t, r]) => [t, pairsOf(r).length]),
  );
  const buckets = new Map();
  const add = (name, c, absent) => {
    if (!buckets.has(name)) buckets.set(name, []);
    buckets.get(name).push({ c, absent });
  };
  const signatures = Object.create(null);
  const hasP = tools.includes("pymtheg");
  for (const c of clusters) {
    const present = tools.filter((t) => c.members[t]);
    const absent = tools.filter((t) => !c.members[t]);
    const sig = tools.map((t) => (c.members[t] ? t : `-${t}`)).join(" ");
    signatures[sig] = (signatures[sig] ?? 0) + 1;
    if (absent.length === 0) add("all", c, absent);
    if (present.length === 1) add(`only:${present[0]}`, c, absent);
    if (hasP) {
      const p = c.members.pymtheg;
      const others = present.filter((t) => t !== "pymtheg");
      if (!p && others.length) {
        add("others-not-pymtheg", c, absent);
        for (const t of others) add(`pymtheg-missing-vs:${t}`, c, absent);
      }
      if (p && others.length === 0) {
        const definite = [...p.certainties].some((x) =>
          x.startsWith("definite"),
        );
        add(
          definite ? "only:pymtheg:definite" : "only:pymtheg:candidate",
          c,
          absent,
        );
      }
      if (
        p &&
        others.length &&
        ![...p.certainties].some((x) => x.startsWith("definite"))
      )
        add("pymtheg-candidate-others-have", c, absent);
      for (const t of tools.filter((x) => x !== "pymtheg"))
        if (p && !c.members[t]) add(`others-missing:${t}`, c, absent);
    }
  }
  const out = {
    tolerance: { declarationLines: TOLERANCE, siteLines: SITE_TOLERANCE },
    seed,
    tools,
    comparablePairs: comparable,
    clusters: clusters.length,
    signatures: sortObj(signatures),
    buckets: {},
  };
  for (const [name, items] of [...buckets.entries()].sort(([a], [b]) =>
    cmp(a, b),
  )) {
    const byClass = Object.create(null);
    const byTargetKind = Object.create(null);
    const byAbsentState = Object.create(null);
    for (const { c, absent } of items) {
      const cls = [
        ...new Set(Object.values(c.members).flatMap((m) => [...m.classes])),
      ]
        .sort()
        .join("+");
      byClass[cls] = (byClass[cls] ?? 0) + 1;
      const tk =
        [
          ...new Set(
            Object.values(c.members).flatMap((m) => [...m.targetKinds]),
          ),
        ]
          .filter((k) => k !== "other")
          .sort()
          .join("+") || "other";
      byTargetKind[tk] = (byTargetKind[tk] ?? 0) + 1;
      if (
        name === "others-not-pymtheg" ||
        name.startsWith("pymtheg-missing-vs:")
      ) {
        const s = stateAt(sites.pymtheg, c.rep);
        byAbsentState[s] = (byAbsentState[s] ?? 0) + 1;
      } else if (name.startsWith("others-missing:")) {
        const t = name.slice("others-missing:".length);
        const s = stateAt(sites[t], c.rep);
        byAbsentState[s] = (byAbsentState[s] ?? 0) + 1;
      }
    }
    const picked = items
      .map((x) => [hash(seed, `${name}|${x.c.rep.key}`), x])
      .sort((a, b) => cmp(a[0], b[0]))
      .slice(0, sample)
      .map(([, x]) => example(x.c, tools, sites, x.absent));
    out.buckets[name] = {
      total: items.length,
      byClass: sortObj(byClass),
      byTargetKind: sortObj(byTargetKind),
      ...(Object.keys(byAbsentState).length
        ? { byAbsentState: sortObj(byAbsentState) }
        : {}),
      sample: picked,
    };
  }
  return out;
}

function sortObj(o) {
  return Object.fromEntries(
    Object.entries({ ...o }).sort(([a, x], [b, y]) => y - x || cmp(a, b)),
  );
}
