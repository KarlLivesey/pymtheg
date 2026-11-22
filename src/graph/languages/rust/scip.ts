// SPDX-License-Identifier: MIT
/**
 * C-43: a minimal reader for SCIP index files (protobuf, scip.proto): the
 * documents, their occurrences (range, symbol, roles) and the symbol strings
 * of rust-analyzer. No dependency. Ported from evidence/c-19/scip.mjs.
 */

export interface ScipOccurrence {
  /** [startLine, startByte, endLine, endByte], UTF-8 bytes within lines. */
  range: [number, number, number, number];
  symbol: string;
  /** Bit 1: a definition. */
  roles: number;
}
export interface ScipDocument {
  path: string;
  occurrences: ScipOccurrence[];
}

class Reader {
  pos: number;
  constructor(
    readonly buf: Uint8Array,
    pos: number,
    readonly end: number,
  ) {
    this.pos = pos;
  }
  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.end) throw Error("truncated SCIP varint");
      const b = this.buf[this.pos++]!;
      result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return result;
      shift += 7;
      if (shift > 63) throw Error("malformed SCIP varint");
    }
  }
  /** Each field as [number, wire type, value or [start, end)]. */
  *fields(): Generator<[number, number, number | [number, number]]> {
    while (this.pos < this.end) {
      const key = this.varint();
      const field = Math.floor(key / 8);
      const wire = key & 7;
      if (wire === 0) yield [field, wire, this.varint()];
      else if (wire === 2) {
        const len = this.varint();
        const start = this.pos;
        this.pos += len;
        if (this.pos > this.end) throw Error("truncated SCIP field");
        yield [field, wire, [start, start + len]];
      } else if (wire === 1) this.pos += 8;
      else if (wire === 5) this.pos += 4;
      else throw Error(`unsupported SCIP wire type ${wire}`);
    }
  }
}

const decoder = new TextDecoder("utf-8");
const text = (buf: Uint8Array, [s, e]: [number, number]) =>
  decoder.decode(buf.subarray(s, e));

function occurrence(
  buf: Uint8Array,
  [s, e]: [number, number],
): ScipOccurrence | undefined {
  const r = new Reader(buf, s, e);
  const range: number[] = [];
  let symbol = "";
  let roles = 0;
  for (const [f, w, v] of r.fields()) {
    if (f === 1) {
      if (w === 2) {
        const [a, b] = v as [number, number];
        const p = new Reader(buf, a, b);
        while (p.pos < p.end) range.push(p.varint());
      } else range.push(v as number);
    } else if (f === 2 && w === 2) symbol = text(buf, v as [number, number]);
    else if (f === 3 && w === 0) roles = v as number;
  }
  // Three numbers: one line. Anything else is not an occurrence range.
  if (range.length === 3)
    return { range: [range[0]!, range[1]!, range[0]!, range[2]!], symbol, roles };
  if (range.length === 4)
    return {
      range: [range[0]!, range[1]!, range[2]!, range[3]!],
      symbol,
      roles,
    };
  return undefined;
}

/** The documents of a SCIP index (external symbol information is not read). */
export function readScip(buf: Uint8Array): ScipDocument[] {
  const top = new Reader(buf, 0, buf.length);
  const documents: ScipDocument[] = [];
  for (const [f, w, v] of top.fields()) {
    if (f !== 2 || w !== 2) continue;
    const [s, e] = v as [number, number];
    const d = new Reader(buf, s, e);
    const doc: ScipDocument = { path: "", occurrences: [] };
    for (const [g, gw, x] of d.fields()) {
      if (gw !== 2) continue;
      if (g === 1) doc.path = text(buf, x as [number, number]);
      else if (g === 2) {
        const o = occurrence(buf, x as [number, number]);
        if (o && o.symbol) doc.occurrences.push(o);
      }
    }
    documents.push(doc);
  }
  return documents;
}

export type DescriptorKind =
  | "namespace"
  | "type"
  | "term"
  | "method"
  | "macro"
  | "meta"
  | "typeparam"
  | "param"
  | "?";
export interface ParsedSymbol {
  local: boolean;
  crate: string;
  version: string;
  path: string[];
  kinds: DescriptorKind[];
  last: string;
}

/**
 * "rust-analyzer cargo core 1.98.1 option/Option#None." ->
 * { crate: "core", version: "1.98.1", path: [option, Option, None], kinds: [namespace, type, term] }
 */
export function parseSymbol(symbol: string): ParsedSymbol {
  if (symbol.startsWith("local "))
    return { local: true, crate: "", version: "", path: [], kinds: [], last: "" };
  const parts: string[] = [];
  let i = 0;
  for (let n = 0; n < 4; n++) {
    let token = "";
    while (i < symbol.length) {
      if (symbol[i] === " ") {
        if (symbol[i + 1] === " ") {
          token += " ";
          i += 2;
          continue;
        }
        break;
      }
      token += symbol[i++];
    }
    parts.push(token);
    i++;
  }
  const descriptors = symbol.slice(i);
  const path: string[] = [];
  const kinds: DescriptorKind[] = [];
  let j = 0;
  while (j < descriptors.length) {
    let name = "";
    if (descriptors[j] === "`") {
      j++;
      while (j < descriptors.length) {
        if (descriptors[j] === "`") {
          if (descriptors[j + 1] === "`") {
            name += "`";
            j += 2;
            continue;
          }
          j++;
          break;
        }
        name += descriptors[j++];
      }
    } else if (descriptors[j] === "[" || descriptors[j] === "(") {
      const close = descriptors[j] === "[" ? "]" : ")";
      const quoted = descriptors[j + 1] === "`";
      const k = quoted
        ? descriptors.indexOf("`" + close, j + 2) + 1
        : descriptors.indexOf(close, j);
      if (k <= j) break;
      path.push(
        quoted
          ? descriptors.slice(j + 2, k - 1).replace(/``/g, "`")
          : descriptors.slice(j + 1, k),
      );
      kinds.push(descriptors[j] === "[" ? "typeparam" : "param");
      j = k + 1;
      continue;
    } else
      while (j < descriptors.length && /[A-Za-z0-9_$+-]/.test(descriptors[j]!))
        name += descriptors[j++];
    const c = descriptors[j];
    if (c === "/") (kinds.push("namespace"), j++);
    else if (c === "#") (kinds.push("type"), j++);
    else if (c === ".") (kinds.push("term"), j++);
    else if (c === "!") (kinds.push("macro"), j++);
    else if (c === ":") (kinds.push("meta"), j++);
    else if (c === "(") {
      const k = descriptors.indexOf(").", j);
      kinds.push("method");
      j = k < 0 ? descriptors.length : k + 2;
    } else {
      kinds.push("?");
      j++;
    }
    path.push(name);
  }
  return {
    local: false,
    crate: parts[2] ?? "",
    version: parts[3] ?? "",
    path,
    kinds,
    last: path[path.length - 1] ?? "",
  };
}
