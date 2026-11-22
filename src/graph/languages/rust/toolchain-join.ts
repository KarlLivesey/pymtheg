// SPDX-License-Identifier: MIT
/**
 * C-43: join rust-analyzer's SCIP index to the snapshot's parsed Rust links
 * with the strict join of C-19 (docs/changes/C-19.md). A link takes the
 * toolchain's answer only from the occurrence at its own name site (the
 * written name's last segment at the end of the link's range, after a
 * trailing `!`, `as alias` or generic arguments), and only when that is the
 * one symbol there and it passes every gate:
 *   kind        the symbol's kind fits the link kind
 *   import      a `use` answered with a module is not credited (SCIP gives
 *               one symbol per occurrence and cannot show that a same-named
 *               function or macro is not imported too)
 *   extern      `extern crate` lines and crate-root answers are not credited
 *   collision   a symbol defined more than once in the index names no single
 *               declaration
 *   proc-macro  a non-macro item of a proc-macro crate, referenced from
 *               another package, is not credited
 *   trait       a trait-method declaration (dispatch) is not a single target
 *   local       a local binding or generic parameter has no graph symbol
 * The gates that need the source-only answer and the cfg conditions run in
 * the analysis (index.ts). SCIP positions are UTF-8 bytes within lines;
 * Pymtheg ranges are UTF-16 offsets, converted per file.
 *
 * Only checkout answers are returned as targets. An answer naming another
 * crate is counted, never applied: Pymtheg names a library target by the
 * path the code writes (D20), the toolchain by the declaring path, and
 * telling that both name one declaration needs an identity rule this change
 * does not invent.
 */
import type { ParseResult } from "../../types.js";
import { parseSymbol, type ParsedSymbol, type ScipDocument } from "./scip.js";

/** One file's text with UTF-16 <-> UTF-8 conversion. */
class FileText {
  /** Byte offset of each line start. */
  readonly lines: number[] = [0];
  /** UTF-16 index -> byte offset, or null when the text is ASCII. */
  private readonly units: Int32Array | null = null;
  private readonly length: number;
  constructor(readonly text: string) {
    let ascii = true;
    for (let i = 0; i < text.length; i++)
      if (text.charCodeAt(i) >= 0x80) {
        ascii = false;
        break;
      }
    if (!ascii) {
      const units = new Int32Array(text.length + 1);
      let b = 0;
      for (let i = 0; i < text.length; i++) {
        units[i] = b;
        const c = text.charCodeAt(i);
        if (c < 0x80) b += 1;
        else if (c < 0x800) b += 2;
        else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
          b += 4;
          units[++i] = b;
        } else b += 3;
      }
      units[text.length] = b;
      this.units = units;
      this.length = b;
    } else this.length = text.length;
    for (let i = 0; i < text.length; i++)
      if (text.charCodeAt(i) === 10) this.lines.push(this.byte(i + 1));
  }
  byte(unit: number): number {
    return this.units
      ? this.units[Math.max(0, Math.min(unit, this.units.length - 1))]!
      : unit;
  }
  /** The UTF-16 index of a byte offset (the first unit at or after it). */
  unit(byte: number): number {
    if (!this.units) return byte;
    let lo = 0;
    let hi = this.units.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.units[mid]! < byte) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  /** Absolute byte offset of a SCIP (line, byte column), or -1 outside the text. */
  offset(line: number, column: number): number {
    if (line < 0 || line >= this.lines.length) return -1;
    const at = this.lines[line]! + column;
    return at > this.length ? -1 : at;
  }
  slice(startByte: number, endByte: number): string {
    return this.text.slice(this.unit(startByte), this.unit(endByte));
  }
  lineAt(unit: number): string {
    const start = this.text.lastIndexOf("\n", unit - 1) + 1;
    const end = this.text.indexOf("\n", unit);
    return this.text.slice(start, end < 0 ? this.text.length : end);
  }
}

interface Occurrence {
  s: number;
  e: number;
  key: string;
  symbol: string;
  def: boolean;
}

export interface JoinFile {
  path: string;
  text: string;
  result: Pick<ParseResult, "symbols" | "links">;
  /** The graph id of each of result.symbols, in order. */
  symbolIds: readonly string[];
}

export interface JoinFacts {
  procMacroPackages: readonly string[];
}

export interface JoinOutcome {
  /** Per file, per parsed link index: the checkout symbol the toolchain names. */
  answers: Map<string, Map<number, string>>;
  /** With `explain`: every parsed link's join outcome, by file, in link order. */
  reasons?: Map<string, string[]>;
  /** Why links took no answer, and answers not applied (library, generated). */
  counts: Record<string, number>;
  documents: number;
}

/** A SCIP symbol's category. Locals cover bindings and generic parameters. */
function category(p: ParsedSymbol): string {
  if (p.local) return "local";
  if (p.path.length === 1 && p.path[0] === "crate") return "crate-root";
  return (
    (
      {
        namespace: "module",
        type: "type",
        term: "value",
        method: "fn",
        macro: "macro",
        meta: "attr-macro",
        typeparam: "type",
        param: "local",
      } as Record<string, string>
    )[p.kinds[p.kinds.length - 1] ?? ""] ?? "other"
  );
}
/** What each link kind may name (C-19). Other kinds take no answer. */
const KINDS: Record<string, ReadonlySet<string>> = {
  calls: new Set(["fn", "type"]),
  macros: new Set(["macro", "attr-macro"]),
  types: new Set(["type"]),
  values: new Set(["value", "type", "fn"]),
  patterns: new Set(["type", "value"]),
  implements: new Set(["type"]),
  imports: new Set(["type", "value", "fn", "macro", "attr-macro"]),
};

export const lastSegment = (name: string): string => {
  let n = name.replace(/!$/, "");
  n = n.replace(/<[^<>]*>/g, "").replace(/<[^<>]*>/g, "");
  const parts = n.split(/::|\./);
  return (parts[parts.length - 1] ?? "").replace(/^r#/, "").trim();
};

/** The UTF-16 range of the written name's last segment at the end of a link. */
export function nameSite(
  text: string,
  range: { start: number; end: number },
  targetName: string,
): { s: number; e: number } | null {
  let s = text.slice(range.start, range.end);
  for (;;) {
    const before = s;
    s = s
      .replace(/\s+$/, "")
      .replace(/!$/, "")
      .replace(/\s+as\s+(r#)?\w+$/, "");
    if (s.endsWith(">")) {
      let d = 0;
      let k = s.length - 1;
      for (; k >= 0; k--) {
        if (s[k] === ">") d++;
        else if (s[k] === "<") d--;
        if (d === 0) break;
      }
      if (k > 0) s = s.slice(0, k).replace(/::$/, "");
    }
    if (s === before) break;
  }
  const want = lastSegment(targetName);
  const m = /(r#)?([A-Za-z_][A-Za-z0-9_]*)$/.exec(s);
  if (!m || m[2] !== want) return null;
  const end = range.start + s.length;
  return { s: end - m[0].length, e: end };
}

export function joinScip(
  documents: readonly ScipDocument[],
  files: readonly JoinFile[],
  facts: JoinFacts,
  /** Also return each link's outcome (for measurement). */
  explain = false,
): JoinOutcome {
  const counts: Record<string, number> = {};
  const count = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);
  const texts = new Map(files.map((f) => [f.path, new FileText(f.text)]));
  const procMacro = new Set(facts.procMacroPackages);
  // ---- SCIP occurrences, by file, as byte ranges
  const defs = new Map<string, { path: string; s: number; e: number }>();
  const defCount = new Map<string, number>();
  const occurrences = new Map<string, Occurrence[]>();
  const checkoutCrates = new Set<string>();
  const fileCrate = new Map<string, string>();
  const seen = new Set<string>();
  for (const doc of documents) {
    const t = texts.get(doc.path);
    if (!t || seen.has(doc.path)) continue;
    seen.add(doc.path);
    const list: Occurrence[] = [];
    for (const o of doc.occurrences) {
      const s = t.offset(o.range[0], o.range[1]);
      const e = t.offset(o.range[2], o.range[3]);
      if (s < 0 || e < s) continue;
      const local = o.symbol.startsWith("local ");
      const key = local ? `${doc.path}\u0000${o.symbol}` : o.symbol;
      const def = (o.roles & 1) !== 0;
      if (def) {
        defCount.set(key, (defCount.get(key) ?? 0) + 1);
        if (!defs.has(key)) defs.set(key, { path: doc.path, s, e });
        if (!local) {
          const q = parseSymbol(o.symbol);
          checkoutCrates.add(`${q.crate} ${q.version}`);
          if (!fileCrate.has(doc.path)) fileCrate.set(doc.path, q.crate);
        }
      }
      list.push({ s, e, key, symbol: o.symbol, def });
    }
    list.sort((x, y) => x.s - y.s || x.e - y.e);
    occurrences.set(doc.path, list);
  }
  // ---- Pymtheg symbols, by file, as byte ranges
  const symbolsByFile = new Map<
    string,
    { id: string; name: string; start: number; end: number }[]
  >();
  for (const f of files) {
    const t = texts.get(f.path)!;
    symbolsByFile.set(
      f.path,
      f.result.symbols.map((symbol, i) => ({
        id: f.symbolIds[i]!,
        name: symbol.name,
        start: t.byte(symbol.range.start),
        end: t.byte(symbol.range.end),
      })),
    );
  }
  const symbolAt = (path: string, at: number, name: string) => {
    let best: { id: string; start: number; end: number } | null = null;
    for (const sym of symbolsByFile.get(path) ?? [])
      if (
        sym.start <= at &&
        at < sym.end &&
        sym.name === name &&
        (!best || sym.end - sym.start < best.end - best.start)
      )
        best = sym;
    return best?.id;
  };
  // ---- every parsed link
  const answers = new Map<string, Map<number, string>>();
  const reasons = explain ? new Map<string, string[]>() : undefined;
  for (const f of files) {
    const t = texts.get(f.path)!;
    const list = occurrences.get(f.path);
    f.result.links.forEach((link, index) => {
      const why = ((): string => {
        const allowed = KINDS[link.kind];
        if (!allowed) return "none:kind-not-joined";
        if (!list) return "none:file-not-indexed";
        const site = nameSite(f.text, link.range, link.targetName);
        if (!site) return "none:no-name-site";
        const s = t.byte(site.s);
        const e = t.byte(site.e);
        let lo = 0;
        let hi = list.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (list[mid]!.s < s) lo = mid + 1;
          else hi = mid;
        }
        const at: Occurrence[] = [];
        for (let i = lo; i < list.length && list[i]!.s === s; i++)
          if (list[i]!.e === e) at.push(list[i]!);
        if (!at.length) return "none:no-occurrence-at-site";
        if (new Set(at.map((o) => o.symbol)).size > 1)
          return "none:several-symbols-at-site";
        const best = at.find((o) => !o.def) ?? at[0]!;
        const p = parseSymbol(best.symbol);
        const cat = category(p);
        if (p.local) return "none:local";
        if (
          /^\s*(pub(\([^)]*\))?\s+)?extern\s+crate\b/.test(
            t.lineAt(link.range.start),
          ) ||
          cat === "crate-root"
        )
          return "filter:extern-crate";
        const def = defs.get(best.key);
        if ((defCount.get(best.key) ?? 0) > 1) return "filter:collision";
        if (link.kind === "imports" && cat === "module")
          return "filter:import-names-module";
        if (!allowed.has(cat)) return "filter:kind-incompatible";
        if (
          cat !== "macro" &&
          cat !== "attr-macro" &&
          procMacro.has(p.crate) &&
          fileCrate.get(f.path) !== p.crate
        )
          return "filter:proc-macro-crate-item";
        const n = p.kinds.length;
        // A method named under its trait (`Trait#m().`, not
        // `impl#[T][Trait]m().`): dispatch, or a default body.
        if (
          p.kinds[n - 1] === "method" &&
          p.kinds[n - 2] === "type" &&
          p.path[n - 2] !== "impl"
        )
          return "none:trait-declaration";
        if (!def)
          return checkoutCrates.has(`${p.crate} ${p.version}`)
            ? "unapplied:generated"
            : "unapplied:library";
        const name = texts
          .get(def.path)!
          .slice(def.s, def.e)
          .replace(/^r#/, "");
        const target = symbolAt(def.path, def.s, name);
        if (!target) return "none:no-graph-symbol";
        let group = answers.get(f.path);
        if (!group) answers.set(f.path, (group = new Map()));
        group.set(index, target);
        return "answer";
      })();
      count(why);
      if (reasons) {
        let list = reasons.get(f.path);
        if (!list) reasons.set(f.path, (list = []));
        list[index] = why;
      }
    });
  }
  return { answers, counts, documents: seen.size, ...(reasons ? { reasons } : {}) };
}
