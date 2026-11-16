// SPDX-License-Identifier: MIT
import type { Node } from "web-tree-sitter";
import type { Diagnostic } from "../../types.js";

/** What Go allows at the top level of a file. */
const TOP_LEVEL = new Set([
  "package_clause",
  "import_declaration",
  "function_declaration",
  "method_declaration",
  "type_declaration",
  "var_declaration",
  "const_declaration",
  "comment",
]);

/** 1-based line and column of a UTF-16 offset (columns count UTF-16 units). */
export function position(text: string, offset: number): string {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const column = offset - (before.lastIndexOf("\n") + 1) + 1;
  return `line ${line}, column ${column}`;
}

/** A token's text, on one line, at most 40 characters. */
function show(text: string): string {
  const line = text.split(/\r?\n/)[0] ?? "";
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

/** The first token of a node's text. */
function firstToken(node: Node): string {
  let current = node;
  while (current.childCount > 0) {
    const child = current.child(0);
    if (!child) break;
    current = child;
  }
  return show(current.text || node.text);
}

/** The first non-empty token starting at or after `offset` (undefined at end of file). */
function tokenAt(root: Node, offset: number): Node | undefined {
  let best: Node | undefined;
  const stack: Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.endIndex <= offset && node.endIndex > node.startIndex) continue;
    if (best && node.startIndex >= best.startIndex) continue;
    if (node.childCount === 0) {
      if (
        node.startIndex >= offset &&
        node.endIndex > node.startIndex &&
        node.type !== "comment"
      )
        best = node;
      continue;
    }
    for (let index = node.childCount - 1; index >= 0; index--) {
      const child = node.child(index);
      if (child) stack.push(child);
    }
  }
  return best;
}

/** The last non-empty token ending at or before `offset` (undefined at the start). */
function tokenBefore(root: Node, offset: number): Node | undefined {
  let best: Node | undefined;
  const stack: Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.startIndex >= offset) continue;
    if (best && node.endIndex <= best.endIndex) continue;
    if (node.childCount === 0) {
      if (
        node.endIndex <= offset &&
        node.endIndex > node.startIndex &&
        node.type !== "comment"
      )
        best = node;
      continue;
    }
    for (let index = 0; index < node.childCount; index++) {
      const child = node.child(index);
      if (child) stack.push(child);
    }
  }
  return best;
}

/** 1-based line of a UTF-16 offset. */
const lineOf = (text: string, offset: number) =>
  text.slice(0, Math.max(0, offset)).split("\n").length;

/**
 * The lines that bracket a syntax error (tree-sitter gives no exact position):
 * from the line where the last valid token before the error node ends, to the
 * line of the first real token after it (or the node's own end, if later).
 * The exact position needs the Go toolchain.
 */
function bracket(
  root: Node,
  text: string,
  node: Node,
): { first: number; last: number } {
  const before = tokenBefore(root, node.startIndex);
  const after = tokenAt(root, node.endIndex);
  const first = before ? lineOf(text, before.endIndex - 1) : 1;
  const last = Math.max(
    lineOf(text, Math.max(node.startIndex, node.endIndex - 1)),
    after ? lineOf(text, after.startIndex) : lineOf(text, text.length),
  );
  return { first, last };
}

/** Lines `first`..`last`, whole, as a range of offsets. */
function lineRange(
  text: string,
  first: number,
  last: number,
): { start: number; end: number } {
  const lines = text.split("\n");
  const start = lines
    .slice(0, first - 1)
    .reduce((sum, line) => sum + line.length + 1, 0);
  const end = Math.min(
    text.length,
    lines.slice(0, last).reduce((sum, line) => sum + line.length + 1, 0),
  );
  return { start, end: Math.max(start, end) };
}

/**
 * The first string or rune literal that is not terminated, found by reading the
 * text as Go's scanner does (comments, raw strings, escapes): an interpreted
 * string or rune ends at its line's end, a raw string at the end of the file.
 * Tree-sitter reports such a literal late, at whatever it could not fit; Go
 * reports it at the opening quote.
 */
function unterminated(
  text: string,
): { at: number; message: string } | undefined {
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "/" && text[index + 1] === "/") {
      const end = text.indexOf("\n", index);
      if (end < 0) return undefined;
      index = end + 1;
    } else if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end < 0) return undefined;
      index = end + 2;
    } else if (char === "`") {
      const end = text.indexOf("`", index + 1);
      if (end < 0) return { at: index, message: "raw string not terminated" };
      index = end + 1;
    } else if (char === '"' || char === "'") {
      let at = index + 1;
      while (at < text.length && text[at] !== char && text[at] !== "\n")
        at += text[at] === "\\" && text[at + 1] !== "\n" ? 2 : 1;
      if (at >= text.length || text[at] !== char)
        return {
          at: index,
          message: `${char === '"' ? "string" : "rune"} not terminated`,
        };
      index = at + 1;
    } else index++;
  }
  return undefined;
}
/** Tokens that are wrong in themselves when an ERROR node holds only them. */
const STRAY = new Set([")", "]", "}", ",", ";"]);

/**
 * Where a syntax error is, as close to a compiler's report as the tree allows
 * (checked against `gofmt -e`): a MISSING node at the next real token; an
 * ERROR node at the first token after its last child (the node may enclose
 * valid code before the fault), unless it holds only stray closing or separator
 * tokens, which are themselves the unexpected ones.
 */
function offending(
  root: Node,
  node: Node,
): { at: number; end: number; message: string } {
  if (node.isMissing) {
    const next = tokenAt(root, node.endIndex);
    return {
      at: next?.startIndex ?? node.startIndex,
      end: next?.endIndex ?? node.endIndex,
      message: `missing \`${node.type}\``,
    };
  }
  const children = node.children.filter(
    (child): child is Node => !!child && child.type !== "comment",
  );
  const stray =
    children.length > 0 &&
    children.every((child) => child.childCount === 0 && STRAY.has(child.type));
  const token = stray
    ? children[0]!
    : tokenAt(root, children.at(-1)?.endIndex ?? node.endIndex);
  return token
    ? {
        at: token.startIndex,
        end: token.endIndex,
        message: `unexpected \`${show(token.text)}\``,
      }
    : {
        at: node.endIndex,
        end: node.endIndex,
        message: "unexpected end of file",
      };
}

/**
 * Why a Go file cannot be read, like a compiler's first error: a file that cannot
 * be read is not valid code; it has failed and nothing in it is a target. The
 * first syntax error by position (an ERROR or MISSING node anywhere), else a
 * missing or second package clause. Undefined when the file is valid.
 * Tree-sitter does not say what it expected at an ERROR node, so the message
 * only says what is there.
 */
export function syntaxFailure(
  root: Node,
  text: string,
): Diagnostic | undefined {
  if (root.hasError) {
    let first: Node | undefined;
    const stack: Node[] = [root];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.type === "ERROR" || node.isMissing) {
        if (!first || node.startIndex < first.startIndex) first = node;
        continue;
      }
      if (!node.hasError) continue;
      for (let index = node.childCount - 1; index >= 0; index--) {
        const child = node.child(index);
        if (child) stack.push(child);
      }
    }
    // An unterminated literal at or before the error tree-sitter found is Go's
    // first error: the range starts at its opening quote.
    const literal = unterminated(text);
    if (first) {
      let { message } = offending(root, first);
      let lines = bracket(root, text, first);
      if (literal && lineOf(text, literal.at) <= lines.last) {
        const line = lineOf(text, literal.at);
        // Before the bracket, the literal is the first error. Inside it, the
        // range keeps its start (an earlier error may be there: the range
        // never narrows), and the literal is named only on the first line.
        if (line < lines.first) lines = { first: line, last: line };
        if (line <= lines.first) message = literal.message;
        lines = { first: Math.min(line, lines.first), last: lines.last };
      }
      return {
        message: `syntax error in ${
          lines.first === lines.last
            ? `line ${lines.first}`
            : `lines ${lines.first}–${lines.last}`
        }: ${message}`,
        range: lineRange(text, lines.first, lines.last),
      };
    }
  }
  {
    const literal = unterminated(text);
    if (literal) {
      const line = lineOf(text, literal.at);
      return {
        message: `syntax error in line ${line}: ${literal.message}`,
        range: lineRange(text, line, line),
      };
    }
  }
  // Top-level text the grammar accepted that is not Go's top level (for example
  // `packge p`, read as expression statements).
  for (const child of root.namedChildren)
    if (child && !TOP_LEVEL.has(child.type))
      return {
        message: `${position(text, child.startIndex)}: unexpected \`${firstToken(child)}\``,
        range: { start: child.startIndex, end: child.endIndex },
      };
  const clauses = root.namedChildren.filter(
    (child): child is Node => child?.type === "package_clause",
  );
  if (!clauses.length)
    return {
      message: `${position(text, 0)}: no package clause`,
      range: { start: 0, end: 0 },
    };
  if (clauses.length > 1) {
    const second = clauses[1]!;
    return {
      message: `${position(text, second.startIndex)}: second package clause`,
      range: { start: second.startIndex, end: second.endIndex },
    };
  }
  return undefined;
}
