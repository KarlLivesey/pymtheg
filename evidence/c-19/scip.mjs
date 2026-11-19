// SPDX-License-Identifier: MIT
// C-19: a minimal reader for SCIP index files (protobuf, scip.proto), enough
// for definitions, references, symbol kinds and symbol strings. No dependency.
import { readFileSync } from "node:fs";

class Reader {
  constructor(buf, pos = 0, end = buf.length) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
  }
  varint() {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.buf[this.pos++];
      if (shift < 28) result |= (b & 0x7f) << shift;
      else result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return result >>> 0 === result ? result : result;
      shift += 7;
    }
  }
  *fields() {
    while (this.pos < this.end) {
      const key = this.varint();
      const field = key >>> 3;
      const wire = key & 7;
      if (wire === 0) yield [field, wire, this.varint()];
      else if (wire === 2) {
        const len = this.varint();
        const start = this.pos;
        this.pos += len;
        yield [field, wire, [start, start + len]];
      } else if (wire === 1) {
        this.pos += 8;
      } else if (wire === 5) {
        this.pos += 4;
      } else throw Error(`wire type ${wire}`);
    }
  }
}

const str = (buf, [s, e]) => buf.toString("utf8", s, e);

function occurrence(buf, [s, e]) {
  const r = new Reader(buf, s, e);
  const o = { range: [], symbol: "", roles: 0 };
  for (const [f, w, v] of r.fields()) {
    if (f === 1) {
      if (w === 2) {
        const p = new Reader(buf, v[0], v[1]);
        while (p.pos < p.end) o.range.push(p.varint() | 0);
      } else o.range.push(v | 0);
    } else if (f === 2) o.symbol = str(buf, v);
    else if (f === 3) o.roles = v;
  }
  return o;
}

function symbolInfo(buf, [s, e]) {
  const r = new Reader(buf, s, e);
  const i = { symbol: "", kind: 0, displayName: "", enclosing: "" };
  for (const [f, , v] of r.fields()) {
    if (f === 1) i.symbol = str(buf, v);
    else if (f === 5) i.kind = v;
    else if (f === 6) i.displayName = str(buf, v);
    else if (f === 8) i.enclosing = str(buf, v);
  }
  return i;
}

// Returns { documents: [{ path, occurrences, symbols }], external: [symbolInfo] }.
export function readScip(file) {
  const buf = readFileSync(file);
  const top = new Reader(buf);
  const documents = [];
  const external = [];
  for (const [f, , v] of top.fields()) {
    if (f === 2) {
      const d = new Reader(buf, v[0], v[1]);
      const doc = { path: "", occurrences: [], symbols: [] };
      for (const [g, , w] of d.fields()) {
        if (g === 1) doc.path = str(buf, w);
        else if (g === 2) doc.occurrences.push(occurrence(buf, w));
        else if (g === 3) doc.symbols.push(symbolInfo(buf, w));
      }
      documents.push(doc);
    } else if (f === 3) external.push(symbolInfo(buf, v));
  }
  return { documents, external };
}

// "rust-analyzer cargo core 1.98.1 option/Option#None." ->
// { local: false, crate: "core", version: "1.98.1", path: ["option","Option","None"], last: "None", suffix: "." }
export function parseSymbol(symbol) {
  if (symbol.startsWith("local ")) return { local: true };
  const parts = [];
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
  const path = [];
  const kinds = [];
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
      // a backtick-quoted name may contain the closing bracket: [`[T]`]
      const quoted = descriptors[j + 1] === "`";
      const k = quoted ? descriptors.indexOf("`" + close, j + 2) + 1 : descriptors.indexOf(close, j);
      path.push(quoted ? descriptors.slice(j + 2, k - 1).replace(/``/g, "`") : descriptors.slice(j + 1, k));
      kinds.push(descriptors[j] === "[" ? "typeparam" : "param");
      j = k + 1;
      continue;
    } else {
      while (j < descriptors.length && /[A-Za-z0-9_$+\-]/.test(descriptors[j])) name += descriptors[j++];
    }
    const c = descriptors[j];
    if (c === "/") kinds.push("namespace"), j++;
    else if (c === "#") kinds.push("type"), j++;
    else if (c === ".") kinds.push("term"), j++;
    else if (c === "!") kinds.push("macro"), j++;
    else if (c === ":") kinds.push("meta"), j++;
    else if (c === "(") {
      const k = descriptors.indexOf(").", j);
      kinds.push("method");
      j = k + 2;
    } else {
      kinds.push("?");
      j++;
    }
    path.push(name);
  }
  return {
    local: false,
    scheme: parts[0],
    manager: parts[1],
    crate: parts[2],
    version: parts[3],
    path,
    kinds,
    last: path[path.length - 1] ?? "",
  };
}
