import type { Node } from "web-tree-sitter";
import type { SourceRange } from "../../types.js";

/**
 * Layer 2 switch, for tests only: with recovery off, layer 1 alone must keep every
 * link sound (see W2-B.md, "Declaration-lossy files").
 */
export const recoveryOptions = { enabled: true };

/** Tokens that may start a swallowed declaration, or show a brace imbalance. */
const SUSPECT = new Set([
  "{",
  "}",
  "func",
  "type",
  "var",
  "const",
  "import",
  "package",
]);

/**
 * Layer 1, from the tree alone: a top-level declaration with a syntax error
 * cannot have swallowed following declarations. Only a function or method
 * qualifies: its header is intact, its body ends with a real `}`, no error or
 * missing node in the body holds a brace or a declaration keyword, and no
 * function literal or type in the body has an error (a swallowed header could
 * hide there). Everything else with an error is lossy.
 */
export function confined(node: Node): boolean {
  if (
    node.type !== "function_declaration" &&
    node.type !== "method_declaration"
  )
    return false;
  const body = node.childForFieldName("body");
  if (!body) return false;
  for (const child of node.children)
    if (
      child &&
      child.startIndex !== body.startIndex &&
      (child.hasError || child.isMissing || child.type === "ERROR")
    )
      return false;
  const last = body.lastChild;
  if (!last || last.type !== "}" || last.isMissing) return false;
  const suspect = (current: Node): boolean => {
    if (current.childCount === 0) return SUSPECT.has(current.type);
    for (const child of current.children)
      if (child && suspect(child)) return true;
    return false;
  };
  const visit = (current: Node): boolean => {
    if (current.type === "ERROR" || current.isMissing)
      return !suspect(current) && !SUSPECT.has(current.type);
    if (
      (current.type === "func_literal" || current.type === "function_type") &&
      current.hasError
    )
      return false;
    if (!current.hasError) return true;
    for (const child of current.children)
      if (child && !visit(child)) return false;
    return true;
  };
  return visit(body);
}

/**
 * The text with comments and string, raw-string and rune literals replaced by
 * spaces (newlines kept), lexed from the start of the file so literal state is
 * always known. Offsets are unchanged.
 */
export function maskLiterals(text: string): string {
  const out = text.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++)
      if (out[i] !== "\n") out[i] = " ";
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === "`") {
      const end = text.indexOf("`", i + 1);
      const stop = end < 0 ? text.length : end + 1;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n")
        j += text[j] === "\\" ? 2 : 1;
      const stop = Math.min(text.length, j + 1);
      blank(i, stop);
      i = stop;
    } else i++;
  }
  return out.join("");
}

export interface Header {
  kind:
    | "method"
    | "function"
    | "type"
    | "struct"
    | "interface"
    | "alias"
    | "var"
    | "const"
    | "import"
    | "unreadable";
  name: string;
  receiver?: string;
  pointer?: boolean;
  span: SourceRange;
}

interface Token {
  text: string;
  start: number;
  /** First token on its line. */
  line: boolean;
}
const IDENT = /^[\p{L}_][\p{L}\p{Nd}_]*$/u;
const KEYWORDS = new Set([
  "break",
  "case",
  "chan",
  "const",
  "continue",
  "default",
  "defer",
  "else",
  "fallthrough",
  "for",
  "func",
  "go",
  "goto",
  "if",
  "import",
  "interface",
  "map",
  "package",
  "range",
  "return",
  "select",
  "struct",
  "switch",
  "type",
  "var",
]);
const isIdent = (token: Token | undefined) =>
  !!token && IDENT.test(token.text) && !KEYWORDS.has(token.text);

function tokens(masked: string, start: number, end: number): Token[] {
  const out: Token[] = [];
  const pattern = /[\p{L}_][\p{L}\p{Nd}_]*|\p{Nd}[\p{L}\p{Nd}_.]*|\S/gu;
  const text = masked.slice(start, end);
  let previous = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index;
    out.push({
      text: match[0],
      start: start + at,
      line: out.length === 0 || text.slice(previous, at).includes("\n"),
    });
    previous = at + match[0].length;
  }
  return out;
}

const CLOSE: { [open: string]: string } = { "(": ")", "[": "]", "{": "}" };
/** Index just past the bracket matching the one at `i` (or the end). */
function skip(list: Token[], i: number): number {
  const stack: string[] = [];
  for (let j = i; j < list.length; j++) {
    const text = list[j]!.text;
    if (CLOSE[text]) stack.push(CLOSE[text]);
    else if (text === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return j + 1;
    }
  }
  return list.length;
}

/**
 * Declaration headers in `masked[start, end)`, by Go's token rules, at any
 * indentation: `func (r T) M`, `func (r *T[P]) M`, `func F`, `type N …` (kind from
 * the next token), `type ( … )`, `var`/`const` names, alone or grouped, and
 * `import`. A `func (` whose receiver cannot be read is `unreadable`.
 */
export function readHeaders(
  masked: string,
  start: number,
  end: number,
): Header[] {
  const list = tokens(masked, start, end);
  const out: Header[] = [];
  const span = (token: Token): SourceRange => ({
    start: token.start,
    end: token.start + token.text.length,
  });
  const typeSpec = (i: number): number => {
    const name = list[i];
    if (!isIdent(name)) return i + 1;
    let j = i + 1;
    if (list[j]?.text === "[") j = skip(list, j);
    const next = list[j]?.text;
    out.push({
      kind:
        next === "struct"
          ? "struct"
          : next === "interface"
            ? "interface"
            : next === "="
              ? "alias"
              : "type",
      name: name!.text,
      span: span(name!),
    });
    return j;
  };
  const valueNames = (i: number, kind: "var" | "const"): number => {
    let j = i;
    while (isIdent(list[j])) {
      out.push({ kind, name: list[j]!.text, span: span(list[j]!) });
      if (list[j + 1]?.text !== ",") return j + 1;
      j += 2;
    }
    return j;
  };
  /** A `( … )` group: one spec per line (or after `;`) at the group's own depth. */
  const group = (i: number, spec: (j: number) => number): number => {
    const close = skip(list, i);
    let j = i + 1;
    let fresh = true;
    while (j < close - 1) {
      const token = list[j]!;
      if (token.text === ";") {
        fresh = true;
        j++;
        continue;
      }
      if (fresh || token.line) {
        fresh = false;
        const after = spec(j);
        j = Math.max(after, j + 1);
        continue;
      }
      j = CLOSE[token.text] ? skip(list, j) : j + 1;
    }
    return close;
  };
  for (let i = 0; i < list.length; ) {
    const token = list[i]!;
    const next = list[i + 1];
    if (token.text === "import") {
      out.push({ kind: "import", name: "import", span: span(token) });
      i++;
    } else if (token.text === "func" && next?.text === "(") {
      // Receiver: `(` [name] [`*`] Type [`[`…`]`] `)` Name.
      let j = i + 2;
      if (
        isIdent(list[j]) &&
        (isIdent(list[j + 1]) || list[j + 1]?.text === "*")
      )
        j++;
      const pointer = list[j]?.text === "*";
      if (pointer) j++;
      const receiver = list[j];
      if (isIdent(receiver)) {
        j++;
        if (list[j]?.text === "[") j = skip(list, j);
        if (list[j]?.text === ")" && isIdent(list[j + 1])) {
          out.push({
            kind: "method",
            name: list[j + 1]!.text,
            receiver: receiver!.text,
            pointer,
            span: { start: token.start, end: span(list[j + 1]!).end },
          });
          i = j + 2;
          continue;
        }
      }
      out.push({ kind: "unreadable", name: "func", span: span(token) });
      i += 2;
    } else if (token.text === "func" && isIdent(next)) {
      out.push({ kind: "function", name: next!.text, span: span(next!) });
      i += 2;
    } else if (token.text === "type") {
      i = next?.text === "(" ? group(i + 1, typeSpec) : typeSpec(i + 1);
    } else if (token.text === "var" || token.text === "const") {
      const kind = token.text;
      i =
        next?.text === "("
          ? group(i + 1, (j) => valueNames(j, kind))
          : valueNames(i + 1, kind);
    } else i++;
  }
  return out;
}
