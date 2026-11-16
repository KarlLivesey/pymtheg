// SPDX-License-Identifier: MIT
/** Snapshot-only TOML reader. Unsupported or invalid syntax rejects the whole
 * document: callers must never mistake unread keys for absent keys. No recovery.
 * Keys/tables are parsed structurally, not extracted with Cargo-specific regexes.
 */
export type TomlValue = string | boolean | number | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}
export function table(value: TomlValue | undefined): TomlTable | undefined {
  return value !== undefined &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value
    : undefined;
}
export function readToml(source: string): TomlTable | null {
  let at = 0,
    depth = 0;
  const text = source.replace(/\r\n/g, "\n"),
    arrays = new WeakSet<TomlValue[]>();
  const states = new WeakMap<
    TomlTable,
    { declared: boolean; dotted: boolean; sealed: boolean }
  >();
  const fail = (): never => {
    throw new Error("unreadable TOML");
  };
  const make = (declared = false): TomlTable => {
    const t = Object.create(null) as TomlTable;
    states.set(t, { declared, dotted: false, sealed: false });
    return t;
  };
  const root = make(true);
  let current = root;
  function space(lines = false): void {
    while (at < text.length) {
      if (text[at] === " " || text[at] === "\t" || (lines && text[at] === "\n"))
        at++;
      else if (text[at] === "#") {
        while (at < text.length && text[at] !== "\n") {
          if (/[\x00-\x08\x0b-\x1f\x7f]/.test(text[at]!)) fail();
          at++;
        }
      } else break;
    }
  }
  function string(key = false): string {
    const quote = text[at++]!,
      multi = !key && text.slice(at, at + 2) === quote.repeat(2);
    if (multi) {
      at += 2;
      if (text[at] === "\n") at++;
    }
    let result = "";
    while (at < text.length) {
      const c = text[at++]!;
      if (c === quote) {
        if (!multi) return result;
        let count = 1;
        while (text[at] === quote) {
          count++;
          at++;
        }
        if (count >= 3) {
          if (count > 5) fail();
          return result + quote.repeat(count - 3);
        }
        result += quote.repeat(count);
        continue;
      }
      if (c === "\n" && !multi) fail();
      if (/[\x00-\x08\x0b-\x1f\x7f]/.test(c) && c !== "\n") fail();
      if (c !== "\\" || quote === "'") {
        result += c;
        continue;
      }
      if (multi && /[ \t\n]/.test(text[at] ?? "")) {
        while (text[at] === " " || text[at] === "\t") at++;
        if (text[at++] !== "\n") fail();
        while (/[ \t\n]/.test(text[at] ?? "")) at++;
        continue;
      }
      const escape = text[at++]!,
        simple: Record<string, string> = {
          b: "\b",
          t: "\t",
          n: "\n",
          f: "\f",
          r: "\r",
          '"': '"',
          "\\": "\\",
        };
      if (escape in simple) result += simple[escape];
      else if (escape === "u" || escape === "U") {
        const length = escape === "u" ? 4 : 8,
          hex = text.slice(at, at + length);
        if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) fail();
        const code = parseInt(hex, 16);
        if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) fail();
        result += String.fromCodePoint(code);
        at += length;
      } else fail();
    }
    return fail();
  }
  function keyPath(): string[] {
    const keys: string[] = [];
    while (true) {
      space();
      if (text[at] === '"' || text[at] === "'") keys.push(string(true));
      else {
        const start = at;
        while (/[A-Za-z0-9_-]/.test(text[at] ?? "")) at++;
        if (at === start) fail();
        keys.push(text.slice(start, at));
      }
      space();
      if (text[at] !== ".") return keys;
      at++;
    }
  }
  function descend(parent: TomlTable, key: string, dotted: boolean): TomlTable {
    const v = parent[key];
    if (v === undefined) {
      const child = make();
      states.get(child)!.dotted = dotted;
      parent[key] = child;
      return child;
    }
    const child =
      Array.isArray(v) && arrays.has(v) ? table(v.at(-1)) : table(v);
    if (!child || states.get(child)!.sealed) return fail();
    return child;
  }
  function assign(parent: TomlTable, keys: string[], value: TomlValue): void {
    for (const key of keys.slice(0, -1)) parent = descend(parent, key, true);
    const last = keys.at(-1)!;
    if (Object.hasOwn(parent, last)) fail();
    parent[last] = value;
  }
  function value(): TomlValue {
    if (++depth > 128) fail();
    try {
      space();
      if (text[at] === '"' || text[at] === "'") return string();
      if (text[at] === "[") {
        at++;
        const values: TomlValue[] = [];
        space(true);
        while (text[at] !== "]") {
          values.push(value());
          space(true);
          if (text[at] !== ",") break;
          at++;
          space(true);
        }
        if (text[at++] !== "]") fail();
        return values;
      }
      if (text[at] === "{") {
        at++;
        const result = make();
        space();
        while (text[at] !== "}") {
          const keys = keyPath();
          if (text[at++] !== "=") fail();
          assign(result, keys, value());
          space();
          if (text[at] !== ",") break;
          at++;
          space();
          if (text[at] === "}") fail();
        }
        if (text[at++] !== "}") fail();
        function seal(t: TomlTable): void {
          states.get(t)!.sealed = true;
          for (const v of Object.values(t)) {
            const nested = table(v);
            if (nested) seal(nested);
          }
        }
        seal(result);
        return result;
      }
      const start = at;
      while (at < text.length && !/[\s,#\]}]/.test(text[at]!)) at++;
      const raw = text.slice(start, at);
      if (raw === "true" || raw === "false") return raw === "true";
      if (/^[+-]?(?:inf|nan)$/.test(raw)) return Number.NaN;
      if (
        /^[+-]?(?:0|[1-9](?:_?\d)*)$/.test(raw) ||
        /^0(?:x[\da-fA-F](?:_?[\da-fA-F])*|o[0-7](?:_?[0-7])*|b[01](?:_?[01])*)$/.test(
          raw,
        )
      )
        return Number(raw.replaceAll("_", ""));
      if (
        /^[+-]?(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*(?:[eE][+-]?\d(?:_?\d)*)?|[eE][+-]?\d(?:_?\d)*)$/.test(
          raw,
        )
      )
        return Number(raw.replaceAll("_", ""));
      // Datetimes are not Cargo facts. Reject rather than guess their extent
      // (notably TOML's space-separated datetime form) or silently skip text.
      return fail();
    } finally {
      depth--;
    }
  }
  try {
    if (text[0] === "\ufeff") at++;
    while (true) {
      space(true);
      if (at === text.length) return root;
      if (text[at] === "[") {
        at++;
        const array = text[at] === "[";
        if (array) at++;
        const keys = keyPath();
        if (text[at++] !== "]" || (array && text[at++] !== "]")) fail();
        let parent = root;
        for (const key of keys.slice(0, -1))
          parent = descend(parent, key, false);
        const key = keys.at(-1)!,
          previous = parent[key];
        if (array) {
          let list: TomlValue[];
          if (previous === undefined) {
            list = [];
            arrays.add(list);
            parent[key] = list;
          } else if (Array.isArray(previous) && arrays.has(previous))
            list = previous;
          else return fail();
          current = make(true);
          list.push(current);
        } else {
          if (previous === undefined) parent[key] = make();
          const t = table(parent[key]);
          if (!t) fail();
          const state = states.get(t!)!;
          if (state.declared || state.dotted || state.sealed) fail();
          state.declared = true;
          current = t!;
        }
      } else {
        const keys = keyPath();
        if (text[at++] !== "=") fail();
        assign(current, keys, value());
      }
      space();
      if (at < text.length && text[at++] !== "\n") fail();
    }
  } catch {
    return null;
  }
}
