// SPDX-License-Identifier: MIT
// Collects per-repository results into OUT/summary.json and OUT/summary.md.
// Timings and memory are observations, never pass or fail.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoDir } from "./common.mjs";

const readJson = (f) =>
  existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined;

const CLASSES = ["call", "reference", "heritage", "import", "structure"];

function classCounts(counts) {
  const out = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  const unresolved = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  for (const [k, n] of Object.entries(counts?.edgesByCertainty ?? {})) {
    const [cls, cert] = [
      k.slice(0, k.indexOf(":")),
      k.slice(k.indexOf(":") + 1),
    ];
    if (!(cls in out)) continue;
    if (/^(unresolved|failed)/.test(cert)) unresolved[cls] += n;
    else out[cls] += n;
  }
  return { out, unresolved };
}

export function collect(outDir, repos, tools) {
  const rows = [];
  for (const repo of repos) {
    const base = join(outDir, "repos", repoDir(repo.id));
    const meta = readJson(join(base, "meta.json")) ?? {
      ...repo,
      fetched: false,
    };
    const d = readJson(join(base, "diff.json"));
    const perTool = {};
    for (const t of tools) {
      const oc = readJson(join(base, t, "outcome.json"));
      if (!oc) {
        perTool[t] = { outcome: "not-run" };
        continue;
      }
      const cc = classCounts(oc.counts);
      perTool[t] = {
        outcome: oc.outcome,
        wallSeconds:
          oc.wallMs != null ? Math.round(oc.wallMs / 100) / 10 : null,
        peakMb: oc.peakMb ?? null,
        files: oc.counts?.files ?? null,
        symbols: oc.counts?.symbols ?? null,
        symbolsByKind: oc.counts?.symbolsByKind ?? {},
        edgesByKind: oc.counts?.edgesByKind ?? {},
        edgesByClass: cc.out,
        unresolvedByClass: cc.unresolved,
        comparablePairs: d?.comparablePairs?.[t] ?? null,
        ...(oc.pymtheg ? { pymtheg: oc.pymtheg } : {}),
        ...(oc.error ? { error: oc.error } : {}),
      };
    }
    const buckets = d?.buckets
      ? Object.fromEntries(
          Object.entries(d.buckets).map(([k, v]) => [
            k,
            {
              total: v.total,
              byClass: v.byClass,
              byTargetKind: v.byTargetKind,
              ...(v.byAbsentState ? { byAbsentState: v.byAbsentState } : {}),
            },
          ]),
        )
      : {};
    rows.push({
      id: repo.id,
      language: repo.language,
      url: repo.url,
      commit: repo.commit,
      fetched: meta.fetched,
      fetchError: meta.error,
      sourceFiles: meta.sourceFiles,
      tools: perTool,
      diff: d
        ? {
            tools: d.tools,
            clusters: d.clusters,
            signatures: d.signatures,
            buckets,
            error: d.error,
          }
        : null,
    });
  }
  return rows;
}

const fmt = (v) =>
  v == null
    ? "–"
    : typeof v === "number"
      ? String(v)
      : String(v).replace(/\|/g, "\\|");

export function markdown(rows, tools) {
  const lines = [
    "# Comparison results",
    "",
    "Timings and peak memory are observations on a shared machine, never pass or fail.",
    "",
  ];
  for (const r of rows) {
    lines.push(
      `## ${r.id} (${r.language})`,
      "",
      `${r.url} at \`${r.commit.slice(0, 12)}\``,
      "",
    );
    if (!r.fetched) {
      lines.push(`Fetch failed: ${fmt(r.fetchError)}`, "");
      continue;
    }
    if (r.sourceFiles)
      lines.push(
        `Source files: Go ${r.sourceFiles.go}, Rust ${r.sourceFiles.rust}, TS/JS ${r.sourceFiles.typescript}.`,
        "",
      );
    lines.push(
      "| Tool | Outcome | Wall s | Peak MB | Files | Symbols | Calls | References | Heritage | Imports | Unresolved (all) | Compared pairs |",
    );
    lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const t of tools) {
      const x = r.tools[t];
      const ec = x.edgesByClass ?? {};
      const un = Object.values(x.unresolvedByClass ?? {}).reduce(
        (a, b) => a + b,
        0,
      );
      lines.push(
        `| ${t} | ${fmt(x.outcome)} | ${fmt(x.wallSeconds)} | ${fmt(x.peakMb)} | ${fmt(x.files)} | ${fmt(x.symbols)} | ${fmt(ec.call)} | ${fmt(ec.reference)} | ${fmt(ec.heritage)} | ${fmt(ec.import)} | ${fmt(un)} | ${fmt(x.comparablePairs)} |`,
      );
    }
    lines.push("");
    if (r.diff?.buckets) {
      lines.push(
        "| Bucket | Edges | By class | By target kind |",
        "|---|---:|---|---|",
      );
      const list = (o) =>
        Object.entries(o ?? {})
          .map(([c, n]) => `${c} ${n}`)
          .join(", ");
      for (const [k, v] of Object.entries(r.diff.buckets))
        lines.push(
          `| ${k} | ${v.total} | ${list(v.byClass)} | ${list(v.byTargetKind)} |`,
        );
      lines.push("");
      const miss = r.diff.buckets["others-not-pymtheg"];
      if (miss?.byAbsentState)
        lines.push(
          `Pymtheg at the sites the others link and it does not: ${Object.entries(
            miss.byAbsentState,
          )
            .slice(0, 8)
            .map(([s, n]) => `${s} ${n}`)
            .join("; ")}.`,
          "",
        );
    } else if (r.diff?.error)
      lines.push(`Diff failed: ${fmt(r.diff.error.split("\n")[0])}`, "");
  }
  return lines.join("\n") + "\n";
}

/** One short table per repository: each tool's run, then the main diff buckets. */
export function overview(rows, tools) {
  const lines = [];
  const n = (b, k) => b?.[k]?.total ?? 0;
  for (const r of rows) {
    const src = r.sourceFiles
      ? `Go ${r.sourceFiles.go}, Rust ${r.sourceFiles.rust}, TS/JS ${r.sourceFiles.typescript} source files`
      : "not fetched";
    lines.push(
      `**${r.id}** (${r.language}, \`${r.commit.slice(0, 12)}\`, ${src})`,
      "",
    );
    lines.push(
      "| Tool | Outcome | Wall s | Peak MB | Symbols | Calls | References | Unresolved | Compared |",
      "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    );
    for (const t of tools) {
      const x = r.tools[t];
      const un = Object.values(x.unresolvedByClass ?? {}).reduce(
        (a, b) => a + b,
        0,
      );
      lines.push(
        `| ${t} | ${fmt(x.outcome)} | ${fmt(x.wallSeconds)} | ${fmt(x.peakMb)} | ${fmt(x.symbols)} | ${fmt(x.edgesByClass?.call)} | ${fmt(x.edgesByClass?.reference)} | ${fmt(un)} | ${fmt(x.comparablePairs)} |`,
      );
    }
    const b = r.diff?.buckets;
    if (b && r.diff.tools?.includes("pymtheg")) {
      lines.push(
        "",
        `Links: all three ${n(b, "all")}; only Pymtheg ${n(b, "only:pymtheg")} (definite ${n(b, "only:pymtheg:definite")}, candidate ${n(b, "only:pymtheg:candidate")}); only others ${n(b, "others-not-pymtheg")} (only CodeGraph ${n(b, "only:codegraph")}, only graphify ${n(b, "only:graphify")}); Pymtheg candidate where others claim one target ${n(b, "pymtheg-candidate-others-have")}.`,
      );
    } else if (b) {
      lines.push(
        "",
        `Pymtheg left out of the diff (${fmt(r.tools.pymtheg?.outcome)}). Links: CodeGraph and graphify both ${n(b, "all")}; only CodeGraph ${n(b, "only:codegraph")}; only graphify ${n(b, "only:graphify")}.`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function writeReport(outDir, repos, tools) {
  const rows = collect(outDir, repos, tools);
  writeFileSync(
    join(outDir, "summary.json"),
    JSON.stringify({ tools, repos: rows }, null, 1) + "\n",
  );
  writeFileSync(join(outDir, "summary.md"), markdown(rows, tools));
  writeFileSync(join(outDir, "overview.md"), overview(rows, tools));
  return rows;
}
