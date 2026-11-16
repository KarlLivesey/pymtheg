// SPDX-License-Identifier: MIT
import { finding, type Finding, type Span } from "../shared/identity.js";
export interface Token {
  text: string;
  kind: "id" | "int" | "str" | "punct" | "eof";
  span: Span;
}
export function lex(
  file: string,
  source: string,
): { tokens: Token[]; diagnostics: Finding[] } {
  const tokens: Token[] = [],
    diagnostics: Finding[] = [];
  let p = 0;
  const push = (kind: Token["kind"], start: number): void => {
    tokens.push({
      kind,
      text: source.slice(start, p),
      span: { file, start, end: p },
    });
  };
  while (p < source.length) {
    const c = source[p]!;
    if (/\s/.test(c)) {
      p++;
      continue;
    }
    if (source.startsWith("//", p)) {
      while (p < source.length && source[p] !== "\n") p++;
      continue;
    }
    const start = p;
    if (/[A-Za-z_]/.test(c)) {
      p++;
      while (p < source.length && /[A-Za-z_0-9]/.test(source[p]!)) p++;
      push("id", start);
    } else if (/[0-9]/.test(c)) {
      p++;
      while (p < source.length && /[0-9]/.test(source[p]!)) p++;
      push("int", start);
    } else if (c === '"') {
      p++;
      let closed = false;
      while (p < source.length) {
        if (source[p] === "\\") {
          p += 2;
          continue;
        }
        if (source[p++] === '"') {
          closed = true;
          break;
        }
      }
      p = Math.min(p, source.length);
      push("str", start);
      try {
        if (!closed) throw Error();
        JSON.parse(source.slice(start, p));
      } catch {
        diagnostics.push(
          finding("P001", "Invalid or unterminated string", {
            file,
            start,
            end: p,
          }),
        );
      }
    } else {
      const two = source.slice(p, p + 2);
      if (["->", "=>", "<=", ">=", "==", "!=", "&&", "||", ".."].includes(two))
        p += 2;
      else p++;
      push("punct", start);
      if (!"{}()[]<>:;,=.+-*!|?".includes(c) && p === start + 1)
        diagnostics.push(
          finding("P001", `Unexpected character ${c}`, { file, start, end: p }),
        );
    }
  }
  tokens.push({ kind: "eof", text: "<eof>", span: { file, start: p, end: p } });
  return { tokens, diagnostics };
}
