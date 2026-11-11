import ts from "typescript";

/**
 * Same-length renaming of locally bound module-system names in JavaScript.
 *
 * The compiler treats `require("x")`, `module.exports` and `exports.x` in a JS
 * file as CommonJS by name alone, even when the file declares its own
 * `require`, `module` or `exports`. It then binds `const m = require("./dep")`
 * as an import of `./dep`, and every type and alias derived from `m` points
 * there. Instead of chasing such values afterwards, the text handed to the
 * compiler renames exactly the identifier occurrences bound to a local
 * declaration of those names to a fresh identifier of the same length. Offsets
 * and every other character are unchanged, so positions stay valid; the
 * compiler then sees ordinary code and gets every downstream answer right.
 * Facts reported for such a file restore the original names.
 */
const NAMES = ["require", "module", "exports"] as const;
type Name = (typeof NAMES)[number];
export interface Rename {
  original: Name;
  replacement: string;
}
export interface Renamed {
  text: string;
  renames: Rename[];
  /** Set when no fresh name exists: the file must fail rather than be misread. */
  error?: string;
}

const isJs = (path: string) => /\.(c|m)?jsx?$/.test(path);
const scriptKind = (path: string) =>
  path.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.JS;

/**
 * A fresh identifier of the same length that does not occur in the text:
 * one changed letter, else two. Deterministic, so files that import and export
 * a renamed binding from each other usually agree on the same replacement.
 */
function replacementFor(name: string, text: string): string | undefined {
  const letters = "fghjkqvwxzbcdpuyamnorstlei";
  const swap = (value: string, position: number, letter: string) =>
    value.slice(0, position) + letter + value.slice(position + 1);
  for (let position = name.length - 1; position > 0; position--)
    for (const letter of letters) {
      if (letter === name[position]) continue;
      const candidate = swap(name, position, letter);
      if (!text.includes(candidate)) return candidate;
    }
  for (let first = name.length - 1; first > 0; first--)
    for (let second = first - 1; second > 0; second--)
      for (const a of letters)
        for (const b of letters) {
          const candidate = swap(swap(name, first, a), second, b);
          if (candidate !== name && !text.includes(candidate)) return candidate;
        }
  return undefined;
}

/** Whether `const require = createRequire(...)`: the real loader, never renamed. */
function isCreateRequire(declaration: ts.VariableDeclaration): boolean {
  let value = declaration.initializer;
  while (value && ts.isParenthesizedExpression(value)) value = value.expression;
  if (!value || !ts.isCallExpression(value)) return false;
  const callee = value.expression;
  return (
    (ts.isIdentifier(callee) && callee.text === "createRequire") ||
    (ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "createRequire")
  );
}

const bindingNames = (name: ts.BindingName): ts.Identifier[] =>
  ts.isIdentifier(name)
    ? [name]
    : name.elements.flatMap((element) =>
        ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
      );

/** The nearest function-like node or source file: the scope of `var` and parameters. */
function functionScope(node: ts.Node): ts.Node {
  let current = node.parent;
  while (current && !ts.isFunctionLike(current) && !ts.isSourceFile(current))
    current = current.parent;
  return current ?? node.getSourceFile();
}
/** The nearest block-like node: the scope of `let`, `const`, `class`, block functions. */
function blockScope(node: ts.Node): ts.Node {
  let current = node.parent;
  while (
    current &&
    !ts.isBlock(current) &&
    !ts.isSourceFile(current) &&
    !ts.isModuleBlock(current) &&
    !ts.isCaseBlock(current) &&
    !ts.isForStatement(current) &&
    !ts.isForInStatement(current) &&
    !ts.isForOfStatement(current) &&
    !ts.isFunctionLike(current)
  )
    current = current.parent;
  return current ?? node.getSourceFile();
}

/** Is this identifier occurrence a variable reference or declaration name (not a property name)? */
function isBindingOccurrence(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    ((ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodSignature(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node) ||
    (ts.isImportSpecifier(parent) && parent.propertyName === node) ||
    (ts.isExportSpecifier(parent) && parent.propertyName === node) ||
    ts.isJsxAttribute(parent) ||
    ts.isLabeledStatement(parent) ||
    ts.isBreakOrContinueStatement(parent) ||
    ts.isMetaProperty(parent)
  )
    return false;
  return true;
}

/** Renames locally bound `require`/`module`/`exports` in one JS file; other files pass through. */
export function renameShadowed(path: string, text: string): Renamed {
  if (!isJs(path) || !/\b(require|module|exports)\b/.test(text))
    return { text, renames: [] };
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  );
  // scope node -> name -> renamable (false for the real createRequire loader)
  const scopes = new Map<ts.Node, Map<Name, boolean>>();
  const declare = (scope: ts.Node, name: string, renamable: boolean) => {
    if (!(NAMES as readonly string[]).includes(name)) return;
    const names = scopes.get(scope) ?? new Map<Name, boolean>();
    if (!names.has(name as Name)) names.set(name as Name, renamable);
    scopes.set(scope, names);
  };
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      const list = node.parent;
      const blockScoped =
        ts.isVariableDeclarationList(list) &&
        !!(list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const));
      const scope = blockScoped ? blockScope(list) : functionScope(list);
      const real = isCreateRequire(node);
      for (const name of bindingNames(node.name))
        declare(scope, name.text, !(real && name.text === "require"));
    } else if (ts.isParameter(node))
      for (const name of bindingNames(node.name))
        declare(node.parent, name.text, true);
    else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name
    )
      declare(
        ts.isSourceFile(node.parent) ||
          ts.isBlock(node.parent) ||
          ts.isModuleBlock(node.parent)
          ? node.parent
          : blockScope(node),
        node.name.text,
        true,
      );
    else if (
      (ts.isFunctionExpression(node) || ts.isClassExpression(node)) &&
      node.name
    )
      declare(node, node.name.text, true);
    else if (ts.isImportClause(node) && node.name)
      declare(file, node.name.text, true);
    else if (ts.isNamespaceImport(node) || ts.isImportSpecifier(node))
      declare(file, node.name.text, true);
    else if (ts.isImportEqualsDeclaration(node))
      declare(file, node.name.text, true);
    else if (ts.isCatchClause(node) && node.variableDeclaration)
      for (const name of bindingNames(node.variableDeclaration.name))
        declare(node, name.text, true);
    ts.forEachChild(node, collect);
  };
  collect(file);
  if (!scopes.size) return { text, renames: [] };
  const occurrences = new Map<Name, ts.Identifier[]>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      (NAMES as readonly string[]).includes(node.text) &&
      isBindingOccurrence(node)
    ) {
      const name = node.text as Name;
      for (let scope: ts.Node | undefined = node; scope; scope = scope.parent) {
        const bound = scopes.get(scope)?.get(name);
        if (bound === undefined) continue;
        if (bound)
          occurrences.set(name, [...(occurrences.get(name) ?? []), node]);
        break;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  let output = text;
  const renames: Rename[] = [];
  for (const [original, nodes] of occurrences) {
    const replacement = replacementFor(original, output);
    if (!replacement)
      return {
        text,
        renames: [],
        error: `No fresh identifier of the same length as the locally bound "${original}"; the compiler would misread it as CommonJS`,
      };
    renames.push({ original, replacement });
    for (const node of nodes) {
      const start = node.getStart(file);
      output =
        output.slice(0, start) +
        replacement +
        output.slice(start + original.length);
    }
  }
  return { text: output, renames };
}

/** Puts the original names back into a name or message derived from a renamed file. */
export function restoreNames(
  value: string,
  renames: readonly Rename[],
): string {
  let result = value;
  for (const { original, replacement } of renames)
    result = result.replace(
      new RegExp(`(?<![\\w$])${replacement}(?![\\w$])`, "g"),
      original,
    );
  return result;
}
