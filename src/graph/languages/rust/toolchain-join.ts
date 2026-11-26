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

/**
 * C-43 design B: one binding on an answered link's trace, as rust-analyzer
 * resolved it in its one configuration: a checkout item (its graph id), an
 * item of the checkout's crates with no declaration the graph has (macro
 * output), a named field (the graph id of the type declaring it, and its
 * name), a local binding (and whether its definition is in the index), or
 * an item of another crate.
 */
export type TraceEntry =
  | { k: "item"; id: string }
  | { k: "generated" }
  | { k: "field"; owner: string; name: string }
  | { k: "local"; defined: boolean }
  | { k: "library"; crate: string };
export interface LinkTrace {
  /** A method call or field through an inferred type (`x.m`, `a.b().c`). */
  receiver: boolean;
  /** Receiver-typed: the graph id of the enclosing function, when known. */
  enclosing?: string;
  /** A path's trace. */
  entries?: TraceEntry[];
  /** Receiver-typed: how many of the enclosing function's trace come first. */
  upTo?: number;
}

export interface JoinOutcome {
  /** Per file, per parsed link index: the checkout symbol the toolchain names. */
  answers: Map<string, Map<number, string>>;
  /**
   * Per file, per answered link index: the bindings its site passes through
   * (design B). A path's trace is every occurrence inside the written path;
   * a receiver-typed link's is every occurrence in the enclosing function
   * from its start to the site (signature, parameters, `let` initialisers
   * and everything they name): an over-approximation of the receiver trace.
   */
  traces: Map<string, Map<number, LinkTrace>>;
  /**
   * Per enclosing function (graph id): every binding named in it, in order
   * of first occurrence, with that position (a receiver link's trace is the
   * prefix before its site).
   */
  functionTraces: Map<string, { entries: TraceEntry[]; at: number[] }>;
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
/**
 * C-43 review: the graph symbol kinds a SCIP descriptor category can name.
 * The declaration's name is not enough: `pub mod e_width { accessor!(e_width); }`
 * declares a module and, inside it, a function of the same name at one
 * position, and `e_width::e_width()` names the function.
 */
const GRAPH_KINDS: Record<string, ReadonlySet<string>> = {
  module: new Set(["module"]),
  type: new Set(["struct", "enum", "variant", "trait", "type", "union"]),
  fn: new Set(["function", "method"]),
  value: new Set(["const", "static", "variant", "struct", "function", "field"]),
  macro: new Set(["macro", "function"]),
  "attr-macro": new Set(["macro", "function"]),
};

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
    { id: string; name: string; kind: string; start: number; end: number }[]
  >();
  for (const f of files) {
    const t = texts.get(f.path)!;
    symbolsByFile.set(
      f.path,
      f.result.symbols.map((symbol, i) => ({
        id: f.symbolIds[i]!,
        name: symbol.name,
        kind: symbol.kind,
        start: t.byte(symbol.range.start),
        end: t.byte(symbol.range.end),
      })),
    );
  }
  const symbolAt = (
    path: string,
    at: number,
    name: string,
    kinds: ReadonlySet<string> | undefined,
  ) => {
    let best: { id: string; kind: string; start: number; end: number } | null =
      null;
    for (const sym of symbolsByFile.get(path) ?? [])
      if (
        sym.start <= at &&
        at < sym.end &&
        sym.name === name &&
        (!kinds || kinds.has(sym.kind)) &&
        (!best || sym.end - sym.start < best.end - best.start)
      )
        best = sym;
    return best ?? undefined;
  };
  // ---- design B: what one occurrence binds
  const entryOf = (o: Occurrence): TraceEntry | null => {
    if (o.symbol.startsWith("local "))
      return { k: "local", defined: defs.has(o.key) };
    const p = parseSymbol(o.symbol);
    // A crate root (`crate::`, `self::` at the root) always exists.
    if (category(p) === "crate-root") return null;
    if (!checkoutCrates.has(`${p.crate} ${p.version}`))
      return { k: "library", crate: p.crate };
    const def = defs.get(o.key);
    if (!def) return { k: "generated" };
    const name = texts.get(def.path)!.slice(def.s, def.e).replace(/^r#/, "");
    const found = symbolAt(def.path, def.s, name, undefined);
    if (found) return { k: "item", id: found.id };
    // A named field (a term of a type) is no graph symbol: its entry is the
    // type that declares it and the field's name, so the label reads the
    // type's own selection and whether the field itself is under a cfg
    // (manager's review of 90c66e77, items 2 and 6).
    const n = p.kinds.length;
    if (n >= 2 && p.kinds[n - 1] === "term" && p.kinds[n - 2] === "type") {
      let owner: { id: string; start: number; end: number } | undefined;
      for (const sym of symbolsByFile.get(def.path) ?? [])
        if (
          sym.start <= def.s &&
          def.s < sym.end &&
          sym.name === p.path[n - 2] &&
          (!owner || sym.end - sym.start < owner.end - owner.start)
        )
          owner = sym;
      if (owner) return { k: "field", owner: owner.id, name };
    }
    return { k: "generated" };
  };
  const traceOf = (path: string, from: number, to: number): TraceEntry[] => {
    const list = occurrences.get(path) ?? [];
    const seenKeys = new Set<string>();
    const out: TraceEntry[] = [];
    for (const o of list) {
      if (o.s < from) continue;
      if (o.s >= to) break;
      if (o.e > to || seenKeys.has(o.key)) continue;
      seenKeys.add(o.key);
      const entry = entryOf(o);
      if (entry) out.push(entry);
    }
    return out;
  };
  const traces = new Map<string, Map<number, LinkTrace>>();
  const functionTraces = new Map<
    string,
    { entries: TraceEntry[]; at: number[] }
  >();
  const functionTrace = (
    path: string,
    fn: { id: string; start: number; end: number },
  ) => {
    let found = functionTraces.get(fn.id);
    if (found) return found;
    const list = occurrences.get(path) ?? [];
    const seenKeys = new Set<string>();
    found = { entries: [], at: [] };
    for (const o of list) {
      if (o.s < fn.start) continue;
      if (o.s >= fn.end) break;
      if (seenKeys.has(o.key)) continue;
      seenKeys.add(o.key);
      const entry = entryOf(o);
      if (!entry) continue;
      found.entries.push(entry);
      found.at.push(o.s);
    }
    functionTraces.set(fn.id, found);
    return found;
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
        const found = symbolAt(def.path, def.s, name, GRAPH_KINDS[cat]);
        if (!found) return "none:no-graph-symbol";
        let group = answers.get(f.path);
        if (!group) answers.set(f.path, (group = new Map()));
        group.set(index, found.id);
        // Design B: the trace of this site.
        const start = t.byte(link.range.start);
        const receiver = /\./.test(
          f.text.slice(link.range.start, site.s).replace(/\.\.|"[^"]*"/g, ""),
        );
        let enclosing: { id: string; start: number; end: number } | undefined;
        if (receiver)
          for (const sym of symbolsByFile.get(f.path) ?? [])
            if (
              (sym.kind === "function" || sym.kind === "method") &&
              sym.start <= start &&
              e <= sym.end &&
              (!enclosing || sym.start > enclosing.start)
            )
              enclosing = sym;
        let traceGroup = traces.get(f.path);
        if (!traceGroup) traces.set(f.path, (traceGroup = new Map()));
        if (enclosing) {
          const fn = functionTrace(f.path, enclosing);
          let upTo = 0;
          while (upTo < fn.at.length && fn.at[upTo]! < e) upTo++;
          traceGroup.set(index, { receiver, enclosing: enclosing.id, upTo });
        } else
          traceGroup.set(index, {
            receiver,
            entries: traceOf(f.path, start, e),
          });
        // C-43 review: an associated type or const named through a trait
        // (`S::Error`, `Self::SIDES` in generic code) is answered with the
        // trait's declaration, which is what the code names; counted apart.
        if (
          p.kinds[n - 2] === "type" &&
          p.path[n - 2] !== "impl" &&
          (found.kind === "type" || found.kind === "const")
        )
          return "answer:trait-associated";
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
  return {
    answers,
    traces,
    functionTraces,
    counts,
    documents: seen.size,
    ...(reasons ? { reasons } : {}),
  };
}
