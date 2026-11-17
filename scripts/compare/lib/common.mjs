// SPDX-License-Identifier: MIT
// Shared helpers for the tool-comparison adapters (SW-2).

import { closeSync, openSync, readSync, renameSync, writeSync } from "node:fs";
//
// The normalised shape every adapter writes:
//
//   symbol: { file, line, kind, name, container? }
//   edge:   { kind, class, from: { file, line, symbol, container?, declLine? },
//             to: { file?, line?, symbol, container?, external? },
//             certainty?, set? }
//
// `from.line` is the line the link is written on (the call site); `from.declLine`
// is the declaration line of the symbol that contains it. `to.line` is the
// declaration line of the target. A file-level source has `symbol: ""`.
// `certainty` keeps each tool's own wording; nothing is upgraded or flattened.
// Lines are 1-based. Paths are POSIX and relative to the repository root.

/** Source files the comparison covers (the three languages Pymtheg supports). */
export const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|go|rs)$/;

export const isSourceFile = (file) =>
  typeof file === "string" && SOURCE_EXT.test(file);

export function languageOf(file) {
  if (/\.go$/.test(file)) return "go";
  if (/\.rs$/.test(file)) return "rust";
  if (SOURCE_EXT.test(file)) return "typescript";
  return "other";
}

/**
 * Edge class used for comparison. Each tool's own kind is kept in `kind`;
 * the class only groups kinds that mean the same thing across tools.
 * `structure` (contains, method-of, receiver) and `import` are counted but
 * not compared symbol-to-symbol (the tools model imports at different
 * granularity: file to file, file to package, file to import statement).
 */
const CLASS = {
  calls: "call",
  macros: "call",
  function_ref: "reference",
  types: "reference",
  values: "reference",
  patterns: "reference",
  modules: "import",
  re_exports: "import",
  dynamic_import: "import",
  case_of: "structure",
  declares: "structure",
  call: "call",
  instantiates: "call",
  new: "call",
  indirect_call: "call",
  dispatches_to: "heritage",
  references: "reference",
  reference: "reference",
  "type-reference": "reference",
  uses: "reference",
  implements: "heritage",
  extends: "heritage",
  embeds: "heritage",
  inherits: "heritage",
  imports: "import",
  imports_from: "import",
  import: "import",
  exports: "import",
  "re-exports": "import",
  depends_on: "import",
  contains: "structure",
  method: "structure",
  receiver: "structure",
  member: "structure",
  defines: "structure",
};

export const edgeClass = (kind) =>
  Object.hasOwn(CLASS, kind) ? CLASS[kind] : "other";

/** Classes compared between tools. */
export const COMPARED_CLASSES = new Set(["call", "reference", "heritage"]);

/**
 * Normalise a symbol name so harmless spelling differences between tools
 * do not count as different symbols: graphify writes `.Get()` and `NewMux()`,
 * other tools write `Get` and `NewMux`; generic parameters are dropped;
 * a qualified name keeps only its last segment (the container is separate).
 */
export function normName(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  s = s.replace(/^[.:#]+/, "");
  s = s.replace(/\(\)$/, "");
  s = s.replace(/\(.*$/, "");
  s = s.replace(/<.*$/, "");
  s = s.replace(/\[.*$/, "");
  const parts = s.split(/::|\.|#/).filter(Boolean);
  s = parts.length ? parts[parts.length - 1] : s;
  return s.replace(/^["'`]|["'`]$/g, "");
}

/** Normalise a container name: `(*Mux)` and `*Mux[T]` become `Mux`. */
export function normContainer(raw) {
  if (raw == null || raw === "") return undefined;
  let s = String(raw).trim();
  s = s.replace(/^\(+|\)+$/g, "").replace(/^[*&]+/, "");
  s = s.replace(/^(?:mut\s+|dyn\s+)/, "");
  s = s.replace(/<.*$/, "").replace(/\[.*$/, "");
  const parts = s.split(/::|\./).filter(Boolean);
  s = parts.length ? parts[parts.length - 1] : s;
  return s || undefined;
}

/** Coarse target kind, so buckets can say what kind of symbol a link points at. */
const KIND = {
  function: "callable",
  method: "callable",
  constructor: "callable",
  getter: "callable",
  setter: "callable",
  macro: "callable",
  callable: "callable",
  route: "callable",
  struct: "type",
  interface: "type",
  type: "type",
  type_alias: "type",
  class: "type",
  enum: "type",
  trait: "type",
  impl: "type",
  union: "type",
  namespace: "module",
  module: "module",
  package: "module",
  file: "module",
  field: "member",
  property: "member",
  variant: "member",
  enum_member: "member",
  var: "value",
  variable: "value",
  const: "value",
  constant: "value",
  static: "value",
};

export const coarseKind = (kind) =>
  Object.hasOwn(KIND, kind) ? KIND[kind] : "other";

/** Map half-open UTF-16 offsets (JavaScript string indexes) to 1-based lines. */
export function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++)
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** `L12` or `L12-L20` or `12` to 12. */
export function parseLoc(loc) {
  if (loc == null) return undefined;
  const m = /(\d+)/.exec(String(loc));
  return m ? Number(m[1]) : undefined;
}

export function countBy(items, key) {
  const out = Object.create(null);
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return sortKeys(out);
}

export function sortKeys(obj) {
  return Object.fromEntries(
    Object.entries({ ...obj }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Stable order for normalised output so reruns write identical files. */
export function sortSymbols(symbols) {
  return symbols.sort(
    (a, b) =>
      cmp(a.file, b.file) ||
      a.line - b.line ||
      cmp(a.name, b.name) ||
      cmp(a.kind, b.kind) ||
      cmp(a.container ?? "", b.container ?? ""),
  );
}

export function edgeSortKey(e) {
  return [
    e.from.file,
    String(e.from.line ?? 0).padStart(7, "0"),
    e.from.symbol,
    e.kind,
    e.to.file ?? "",
    String(e.to.line ?? 0).padStart(7, "0"),
    e.to.symbol,
    e.certainty ?? "",
  ].join("\u0000");
}

export function sortEdges(edges) {
  const keyed = edges.map((e) => [edgeSortKey(e), e]);
  keyed.sort((a, b) => cmp(a[0], b[0]));
  return keyed.map(([, e]) => e);
}

/** Summary counts for one tool's normalised output. */
export function summarise(result) {
  return {
    files: result.files?.length ?? 0,
    symbols: result.symbols.length,
    symbolsByKind: countBy(result.symbols, (s) => s.kind),
    edges: result.edges.length,
    edgesByKind: countBy(result.edges, (e) => e.kind),
    edgesByCertainty: countBy(
      result.edges,
      (e) => `${e.class}:${e.certainty ?? "-"}`,
    ),
  };
}

/**
 * Normalised results are written as JSON Lines (one header, then one line per
 * symbol and per edge), because a large repository's output does not fit in
 * one JavaScript string.
 */
export function writeNormalised(file, result) {
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    const { symbols, edges, ...meta } = result;
    let buf = `${JSON.stringify({ meta })}\n`;
    const flush = (force) => {
      if (buf.length > (force ? 0 : 1 << 20)) {
        writeSync(fd, buf);
        buf = "";
      }
    };
    for (const s of symbols) {
      buf += `${JSON.stringify({ s })}\n`;
      flush(false);
    }
    for (const e of edges) {
      buf += `${JSON.stringify({ e })}\n`;
      flush(false);
    }
    flush(true);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}

export function readNormalised(file) {
  const fd = openSync(file, "r");
  const out = { symbols: [], edges: [] };
  try {
    const chunk = Buffer.alloc(1 << 22);
    let rest = "";
    const take = (line) => {
      if (!line) return;
      const row = JSON.parse(line);
      if (row.s) out.symbols.push(row.s);
      else if (row.e) out.edges.push(row.e);
      else if (row.meta) Object.assign(out, row.meta);
    };
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      const text = rest + chunk.toString("utf8", 0, n);
      const lines = text.split("\n");
      rest = lines.pop();
      for (const line of lines) take(line);
    }
    take(rest);
  } finally {
    closeSync(fd);
  }
  return out;
}
