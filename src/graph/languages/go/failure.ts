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
    if (first) {
      const { at, end, message } = offending(root, first);
      return {
        message: `${position(text, at)}: ${message}`,
        range: { start: at, end },
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
