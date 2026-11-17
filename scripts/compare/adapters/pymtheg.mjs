// SPDX-License-Identifier: MIT
// Pymtheg adapter: runs the released package (`pymtheg init`, then
// `pymtheg graph index --json`) and reads `.pymtheg/rebuildable/graph.sqlite`
// (schema 3) read-only.
//
// Certainty wording kept from Pymtheg:
//   definite                  a resolved link (one target)
//   definite+unverified       resolved, computed without a failed file (`assumes`)
//   candidate                 one member of a candidate set; `set` says which set,
//                             its size and whether it is open or closed. A set is
//                             never turned into a definite link.
//   unresolved / failed       no target; the written name is kept in `to.symbol`
// Source ranges in the store are UTF-16 offsets, converted to lines here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  coarseKind,
  edgeClass,
  lineIndex,
  normContainer,
  normName,
  sortEdges,
  sortSymbols,
} from "../lib/common.mjs";

export const id = "pymtheg";

export function commands({ bin, repoDir }) {
  return [
    { args: [bin, "init", repoDir, "--name", "compare"], label: "init" },
    {
      args: [bin, "graph", "index", "--root", repoDir, "--json"],
      label: "index",
      stdoutFile: "index.json",
    },
  ];
}

/** Exit 2 is Pymtheg's "incomplete": indexing finished with partial or failed files. */
export const exitMeaning = { 0: "ok", 2: "incomplete" };

export const dbPath = (repoDir) =>
  join(repoDir, ".pymtheg", "rebuildable", "graph.sqlite");

/** Container of a Pymtheg symbol from its recorded data or identity. */
export function containerOf(body) {
  const data = body.data ?? {};
  if (typeof data.receiver === "string") return normContainer(data.receiver);
  for (const key of ["container", "owner", "parent", "impl", "self", "class"]) {
    if (typeof data[key] === "string") return normContainer(data[key]);
  }
  const identity = typeof body.identity === "string" ? body.identity : "";
  const m = /^(.*?)(?:\.|::|#)([^.:#]+)$/.exec(identity);
  return m ? normContainer(m[1]) : undefined;
}

function certaintyOf(row, data) {
  const extra = [];
  if (Array.isArray(data.assumes) && data.assumes.length)
    extra.push("unverified");
  if (data.decidedBy) extra.push(String(data.decidedBy));
  if (row.resolution === "resolved") return ["definite", ...extra].join("+");
  if (row.resolution === "ambiguous") return ["candidate", ...extra].join("+");
  return data.reason === "invalid-code" ? "failed" : "unresolved";
}

/**
 * Read a Pymtheg graph store and return the normalised shape.
 * `readText(file)` returns a source file's text (the repository checkout).
 */
export function normalise({ db: path, readText }) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const lines = new Map();
    const lineOf = (file, offset) => {
      if (offset == null) return undefined;
      let f = lines.get(file);
      if (!f) {
        let text = "";
        try {
          text = readText(file);
        } catch {
          text = "";
        }
        f = lineIndex(text);
        lines.set(file, f);
      }
      return f(offset);
    };

    const files = db
      .prepare("SELECT path, status FROM graph_files ORDER BY path")
      .all();
    const failed = db
      .prepare("SELECT path FROM graph_parse_failures ORDER BY path")
      .all()
      .map((r) => r.path);
    const symRows = db
      .prepare("SELECT id, file, name, kind, body FROM graph_symbols")
      .all();
    const sym = new Map();
    const symbols = [];
    for (const r of symRows) {
      const body = JSON.parse(r.body);
      const fileLevel =
        r.kind === "file" ||
        r.kind === "package" ||
        r.kind === "module" ||
        r.kind === "crate";
      const s = {
        file: r.file,
        line: lineOf(r.file, body.range?.start) ?? 1,
        kind: r.kind,
        name: fileLevel ? r.name : normName(r.name),
      };
      const container = fileLevel ? undefined : containerOf(body);
      if (container && container !== s.name) s.container = container;
      sym.set(r.id, { ...s, fileLevel });
      symbols.push(s);
    }

    const candidates = new Map();
    for (const c of db
      .prepare(
        "SELECT link, symbol FROM graph_candidates ORDER BY link, symbol",
      )
      .all()) {
      if (!candidates.has(c.link)) candidates.set(c.link, []);
      candidates.get(c.link).push(c.symbol);
    }

    const endpoint = (s) => {
      if (!s) return undefined;
      const e = {
        file: s.file,
        line: s.line,
        symbol: s.fileLevel ? "" : s.name,
        kind: coarseKind(s.kind),
      };
      if (s.container) e.container = s.container;
      return e;
    };

    const edges = [];
    const unresolvedReasons = {};
    for (const r of db
      .prepare(
        "SELECT id, file, source, target, kind, body, resolution FROM graph_links",
      )
      .all()) {
      const body = JSON.parse(r.body);
      const data = body.data ?? {};
      const src = sym.get(r.source);
      const fromBase = endpoint(src) ?? { file: r.file, line: 1, symbol: "" };
      const from = {
        ...fromBase,
        line: lineOf(r.file, body.range?.start) ?? fromBase.line,
        declLine: fromBase.line,
      };
      if (from.file !== r.file) from.file = r.file;
      const kind = r.kind;
      const cls = edgeClass(kind);
      const certainty = certaintyOf(r, data);
      if (r.resolution === "resolved" && r.target && sym.has(r.target)) {
        edges.push({
          kind,
          class: cls,
          from,
          to: endpoint(sym.get(r.target)),
          certainty,
        });
      } else if (r.resolution === "ambiguous" && candidates.has(r.id)) {
        const members = candidates.get(r.id).filter((m) => sym.has(m));
        const set = {
          id: r.id.slice(5, 17),
          size: members.length,
          open: Boolean(data.open),
        };
        if (data.open?.reason) set.reason = String(data.open.reason);
        for (const m of members)
          edges.push({
            kind,
            class: cls,
            from,
            to: endpoint(sym.get(m)),
            certainty,
            set,
          });
      } else {
        const reason = String(
          data.reason ??
            data.uncertainty?.reason ??
            data.uncertainty ??
            data.open?.reason ??
            "-",
        );
        unresolvedReasons[reason] = (unresolvedReasons[reason] ?? 0) + 1;
        edges.push({
          kind,
          class: cls,
          from,
          to: {
            symbol: normName(body.targetName ?? ""),
            written: body.targetName ?? "",
            unresolved: true,
          },
          certainty,
          reason,
        });
      }
    }
    return {
      tool: id,
      files: files.map((f) => f.path),
      fileStatus: Object.fromEntries(files.map((f) => [f.path, f.status])),
      failedFiles: failed,
      symbols: sortSymbols(symbols),
      edges: sortEdges(edges),
      notes: { unresolvedReasons },
    };
  } finally {
    db.close();
  }
}

export const readFrom = (repoDir) => (file) =>
  readFileSync(join(repoDir, file), "utf8");
