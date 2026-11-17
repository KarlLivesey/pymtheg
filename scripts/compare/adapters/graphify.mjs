// SPDX-License-Identifier: MIT
// graphify adapter (PyPI `graphifyy`, the knowledge-graph skill for coding
// assistants). Runs only its local tree-sitter extraction:
//
//   graphify extract <repo> --code-only --no-cluster --out <dir>
//
// `--code-only` indexes code with the local AST pass and skips documents,
// papers and images, which are the parts that need a language model.
// `--no-cluster` skips community detection (and its optional model naming).
// The harness also runs it with an empty environment (no API keys) and, where
// the machine allows, with no network. It reads `<dir>/graphify-out/graph.json`.
//
// Certainty wording kept from graphify: its edge `confidence` (EXTRACTED,
// INFERRED, AMBIGUOUS) with `confidence_score` when present, e.g. `INFERRED@0.85`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  coarseKind,
  edgeClass,
  normContainer,
  normName,
  parseLoc,
  sortEdges,
  sortSymbols,
} from "../lib/common.mjs";

export const id = "graphify";

export function commands({ bin, repoDir, outDir }) {
  return [
    {
      args: [
        bin,
        "extract",
        repoDir,
        "--code-only",
        "--no-cluster",
        "--max-workers",
        "4",
        "--out",
        outDir,
      ],
      label: "extract",
    },
  ];
}

export const graphPath = (outDir) => join(outDir, "graphify-out", "graph.json");

/** A graphify file node is labelled with the tail of its own path, e.g. `custom-handler/main.go`. */
export function isFileNode(n) {
  if (!n.source_file || typeof n.label !== "string") return false;
  if (!/\.[A-Za-z0-9]+$/.test(n.label)) return false;
  return n.source_file === n.label || n.source_file.endsWith(`/${n.label}`);
}

export function certaintyOf(e) {
  const c = e.confidence ? String(e.confidence) : "-";
  return e.confidence_score != null ? `${c}@${e.confidence_score}` : c;
}

export function normalise({ graph }) {
  const g =
    typeof graph === "string" ? JSON.parse(readFileSync(graph, "utf8")) : graph;
  const rawEdges = g.edges ?? g.links ?? [];
  const containerOf = new Map();
  for (const e of rawEdges) {
    if (e.relation === "method" && !containerOf.has(e.target))
      containerOf.set(e.target, e.source);
  }
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const nodes = new Map();
  const symbols = [];
  const files = new Set();
  for (const n of g.nodes) {
    if (!n.source_file || n.external) {
      nodes.set(n.id, { external: true, name: n.label ?? n.id });
      continue;
    }
    files.add(n.source_file);
    const fileLevel = isFileNode(n);
    const rec = {
      file: n.source_file,
      line: parseLoc(n.source_location) ?? 1,
      kind: fileLevel
        ? "file"
        : n._callable_class
          ? "type"
          : n._callable
            ? "callable"
            : (n.type ?? "symbol"),
      name: fileLevel ? n.label : normName(n.label),
      fileLevel,
    };
    const owner = containerOf.get(n.id);
    if (owner && byId.has(owner)) {
      const c = normContainer(normName(byId.get(owner).label));
      if (c && c !== rec.name) rec.container = c;
    }
    nodes.set(n.id, rec);
    const s = {
      file: rec.file,
      line: rec.line,
      kind: rec.kind,
      name: rec.name,
    };
    if (rec.container) s.container = rec.container;
    symbols.push(s);
  }
  const endpoint = (n) => {
    if (n.external)
      return { symbol: normName(n.name), written: n.name, external: true };
    const e = {
      file: n.file,
      line: n.line,
      symbol: n.fileLevel ? "" : n.name,
      kind: coarseKind(n.kind),
    };
    if (n.container) e.container = n.container;
    return e;
  };
  const edges = [];
  for (const e of rawEdges) {
    const s = nodes.get(e.source);
    const t = nodes.get(e.target);
    if (!s || !t || s.external) continue;
    const fromBase = endpoint(s);
    const from = {
      ...fromBase,
      line: parseLoc(e.source_location) ?? fromBase.line,
      declLine: fromBase.line,
    };
    if (e.source_file && e.source_file !== from.file)
      from.siteFile = e.source_file;
    const edge = {
      kind: e.relation,
      class: edgeClass(e.relation),
      from,
      to: endpoint(t),
      certainty: certaintyOf(e),
    };
    if (e.context) edge.context = e.context;
    edges.push(edge);
  }
  return {
    tool: id,
    files: [...files].sort(),
    failedFiles: [],
    symbols: sortSymbols(symbols),
    edges: sortEdges(edges),
    notes: {},
  };
}
