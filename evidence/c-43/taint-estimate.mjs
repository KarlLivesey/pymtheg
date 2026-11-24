// SPDX-License-Identifier: MIT
// C-43, sixth review B: an estimate, from one route-on store, of what a
// deny-by-default cfg rule would keep of the links the route decided. It
// splits the decided links into path-resolved (the written name is a path:
// a `use`, a path expression, a type path, a call by path) and
// receiver-typed (a method call or field through an inferred type), then
// applies an approximation of the proposed taint rule:
//
//   selected names: the last segment of every item, `use` binding or
//   impl member written under any cfg attribute (`test` included); every
//   name declared in a module a cfg-gated glob `use` brings in; and links
//   whose own source-only reason shows a macro may define the name
//   (`opaque-item-may-shadow-name`).
//   path-resolved: kept when no segment of the written path is selected.
//   receiver-typed: kept when no name in the receiver expression is
//   selected and the enclosing function has no link or item under a cfg
//   of its own; "traceable" also requires the receiver to be a plain name
//   or `self` (a call or field chain cannot be traced from the parse facts,
//   so the proposed rule would leave it confirm-only).
//
// This reads only stored parse facts. It is an estimate of the rule's cost,
// not the rule: `let` initialisers and signatures are not traced.
import { DatabaseSync } from "node:sqlite";

const words = (text) => (text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
const last = (path) => path.replace(/<.*$/, "").split("::").at(-1) ?? path;

export function taintEstimate(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const symbols = [];
    for (const row of db
      .prepare("SELECT file, kind, body FROM graph_symbols WHERE file LIKE '%.rs'")
      .iterate()) {
      const body = JSON.parse(row.body);
      symbols.push({
        file: row.file,
        kind: row.kind,
        identity: body.identity ?? "",
        range: body.range,
        conditions: body.data?.conditions ?? [],
      });
    }
    const links = [];
    for (const row of db
      .prepare("SELECT file, kind, body FROM graph_links WHERE module='rust'")
      .iterate()) {
      const body = JSON.parse(row.body);
      links.push({
        file: row.file,
        kind: row.kind,
        name: body.targetName ?? "",
        range: body.range,
        data: body.data ?? {},
      });
    }
    const selected = new Set();
    const globbed = new Set();
    for (const s of symbols)
      if (s.conditions.length) selected.add(last(s.identity));
    for (const l of links) {
      if (l.kind !== "imports" || !(l.data.conditions ?? []).length) continue;
      if (l.data.glob || l.name.endsWith("*")) {
        const module = l.name.split("::").at(-2);
        if (module) globbed.add(module);
      } else selected.add(l.data.alias || last(l.name));
    }
    // Names declared in a file that is the module a cfg-gated glob brings in.
    for (const s of symbols) {
      const parts = s.file.split("/");
      const stem = parts.at(-1) === "mod.rs" ? parts.at(-2) : parts.at(-1)?.replace(/\.rs$/, "");
      if (stem && globbed.has(stem)) selected.add(last(s.identity));
    }
    // Functions (and methods) with a cfg inside them: any item or link in
    // their range under a condition the function itself does not carry.
    const functions = symbols.filter((s) => s.kind === "function" || s.kind === "method");
    const gatedInside = (fn) => {
      const own = new Set(fn.conditions);
      const inside = (x) =>
        x.file === fn.file && x.range.start > fn.range.start && x.range.end <= fn.range.end;
      return (
        links.some((l) => inside(l) && (l.data.conditions ?? []).some((c) => !own.has(c))) ||
        symbols.some((s) => s !== fn && inside(s) && s.conditions.some((c) => !own.has(c)))
      );
    };
    const enclosing = (l) => {
      let best = null;
      for (const fn of functions)
        if (fn.file === l.file && fn.range.start <= l.range.start && fn.range.end >= l.range.end)
          if (!best || fn.range.end - fn.range.start < best.range.end - best.range.start) best = fn;
      return best;
    };
    const gatedCache = new Map();
    const gated = (fn) => {
      if (!fn) return false;
      if (!gatedCache.has(fn)) gatedCache.set(fn, gatedInside(fn));
      return gatedCache.get(fn);
    };
    const out = {
      decided: 0,
      path: { decided: 0, kept: 0 },
      receiver: { decided: 0, keptNames: 0, keptTraceable: 0 },
    };
    for (const l of links) {
      const record = l.data.toolchain;
      if (!record || record.origin !== "toolchain" || record.from === "definite") continue;
      out.decided++;
      const opaque = String(l.data.uncertainty ?? "").includes("opaque-item-may-shadow-name");
      const dot = l.name.lastIndexOf(".");
      if (dot < 0) {
        out.path.decided++;
        if (!opaque && !words(l.name).some((w) => selected.has(w))) out.path.kept++;
        continue;
      }
      out.receiver.decided++;
      const receiver = l.name.slice(0, dot);
      const clean =
        !opaque && !words(receiver).some((w) => selected.has(w)) && !gated(enclosing(l));
      if (clean) out.receiver.keptNames++;
      if (clean && /^(self|[a-z_][A-Za-z0-9_]*)$/.test(receiver)) out.receiver.keptTraceable++;
    }
    return out;
  } finally {
    db.close();
  }
}
