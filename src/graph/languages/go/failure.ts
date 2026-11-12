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

/** 1-based line and column of a UTF-16 offset. */
export function position(text: string, offset: number): string {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const column = offset - (before.lastIndexOf("\n") + 1) + 1;
  return `line ${line}, column ${column}`;
}

/** The first token of a node's text, on one line, at most 40 characters. */
function firstToken(node: Node): string {
  let current = node;
  while (current.childCount > 0) {
    const child = current.child(0);
    if (!child) break;
    current = child;
  }
  const text = (current.text || node.text).split(/\r?\n/)[0] ?? "";
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
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
      const message = first.isMissing
        ? `missing \`${first.type}\``
        : `unexpected \`${firstToken(first)}\``;
      return {
        message: `${position(text, first.startIndex)}: ${message}`,
        range: { start: first.startIndex, end: first.endIndex },
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
