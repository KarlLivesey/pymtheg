// SPDX-License-Identifier: MIT
// CodeGraph adapter (npm `@colbymchenry/codegraph`): runs `codegraph init -y`
// in the checkout, which builds `.codegraph/codegraph.db`, and reads that
// SQLite file read-only.
//
// Certainty wording kept from CodeGraph: each edge's `resolvedBy`
// (exact-match, qualified-name, instance-method, framework, ...), its
// `confidence` number and its `provenance` (`heuristic` when CodeGraph marks
// the edge as a heuristic), joined as `resolvedBy@confidence[+heuristic]`.
// Edges without metadata are `direct`. References CodeGraph could not resolve
// (`unresolved_refs`) are kept as unresolved edges.

import "../../isolated-home.mjs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  coarseKind,
  edgeClass,
  normContainer,
  normName,
  sortEdges,
  sortSymbols,
} from "../lib/common.mjs";

export const id = "codegraph";

export function commands({ bin, repoDir }) {
  return [{ args: [bin, "init", "-y", repoDir], label: "init" }];
}

export const dbPath = (repoDir) => join(repoDir, ".codegraph", "codegraph.db");

const FILE_KINDS = new Set(["file", "module", "package"]);

/** Container from a CodeGraph qualified name such as `Mux::Head` or `src/a.ts::Foo::bar`. */
export function containerOf(row) {
  const q = String(row.qualified_name ?? "");
  const parts = q.split(/::/).filter(Boolean);
  if (parts.length < 2) {
    const dot = q.split(".");
    if (
      dot.length >= 2 &&
      !/[/\\]/.test(q) &&
      !/\.(?:ts|tsx|js|jsx|mjs|cjs|go|rs)$/.test(q)
    )
      return normContainer(dot[dot.length - 2]);
    return undefined;
  }
  const parent = parts[parts.length - 2];
  if (
    /[/\\]/.test(parent) ||
    /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|go|rs)$/.test(parent)
  )
    return undefined;
  return normContainer(parent);
}

export function certaintyOf(row) {
  let meta = {};
  try {
    meta = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    meta = {};
  }
  const parts = [];
  parts.push(
    meta.resolvedBy
      ? String(meta.resolvedBy)
      : meta.valueRef
        ? "value-ref"
        : "direct",
  );
  if (meta.confidence != null) parts[0] += `@${meta.confidence}`;
  if (row.provenance) parts.push(String(row.provenance));
  return parts.join("+");
}

export function normalise({ db: path }) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const files = db
      .prepare("SELECT path, errors FROM files ORDER BY path")
      .all();
    const nodes = new Map();
    const symbols = [];
    for (const r of db
      .prepare(
        "SELECT id, kind, name, qualified_name, file_path, start_line FROM nodes",
      )
      .all()) {
      const fileLevel = FILE_KINDS.has(r.kind);
      const n = {
        file: r.file_path,
        line: r.start_line,
        kind: r.kind,
        name: fileLevel ? r.name : normName(r.name),
        fileLevel,
      };
      const container = fileLevel ? undefined : containerOf(r);
      if (container && container !== n.name) n.container = container;
      nodes.set(r.id, n);
      if (r.kind !== "import") {
        const s = { file: n.file, line: n.line, kind: n.kind, name: n.name };
        if (n.container) s.container = n.container;
        symbols.push(s);
      }
    }
    const endpoint = (n) => {
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
    for (const r of db
      .prepare(
        "SELECT source, target, kind, metadata, line, provenance FROM edges",
      )
      .all()) {
      const s = nodes.get(r.source);
      const t = nodes.get(r.target);
      if (!s || !t) continue;
      const fromBase = endpoint(s);
      const from = {
        ...fromBase,
        line: r.line ?? fromBase.line,
        declLine: fromBase.line,
      };
      if (r.line == null) from.noSite = true;
      const to = endpoint(t);
      if (t.kind === "import") {
        to.external = true;
        delete to.line;
        to.symbol = t.name;
      }
      edges.push({
        kind: r.kind,
        class: edgeClass(r.kind),
        from,
        to,
        certainty: certaintyOf(r),
      });
    }
    let unresolved = [];
    try {
      unresolved = db
        .prepare(
          "SELECT from_node_id, reference_name, reference_kind, line, status FROM unresolved_refs",
        )
        .all();
    } catch {
      unresolved = [];
    }
    for (const u of unresolved) {
      const s = nodes.get(u.from_node_id);
      if (!s) continue;
      const fromBase = endpoint(s);
      edges.push({
        kind: u.reference_kind,
        class: edgeClass(
          u.reference_kind === "function_ref" ? "references" : u.reference_kind,
        ),
        from: {
          ...fromBase,
          line: u.line ?? fromBase.line,
          declLine: fromBase.line,
        },
        to: {
          symbol: normName(u.reference_name),
          written: u.reference_name,
          unresolved: true,
        },
        certainty: `unresolved(${u.status})`,
      });
    }
    return {
      tool: id,
      files: files.map((f) => f.path),
      failedFiles: files
        .filter((f) => f.errors && f.errors !== "[]")
        .map((f) => f.path),
      symbols: sortSymbols(symbols),
      edges: sortEdges(edges),
      notes: {},
    };
  } finally {
    db.close();
  }
}
