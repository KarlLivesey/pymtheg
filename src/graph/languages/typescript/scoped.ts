// SPDX-License-Identifier: MIT
/**
 * What other files' analysis can read of one file, for a re-index that
 * extracts only the edited file (C-38). Two descriptions, each free of
 * positions and comments, are compared between the file's previous and
 * current text:
 *
 * - the syntactic surface: the file's tokens with every function body left
 *   out (so every declaration, signature, initialiser, alias, interface and
 *   enum outside bodies, and JSDoc, which types JavaScript), and, from inside
 *   bodies, what the module's whole-program scans read without the checker:
 *   module references, returned values, writes, declaration initialisers;
 *   plus the hashbang and the module's CommonJS test;
 * - the checker surface: the type the checker infers for each declaration
 *   outside function bodies that has no written type, as it prints it,
 *   which is what a body edit can change of what other files read (an
 *   inferred return type, for one). A written type is in the tokens.
 *
 * Equal descriptions in every program that loads the file mean another
 * file's extraction cannot tell the two texts apart, apart from the file's
 * own declaration positions (`rekey`). Anything the descriptions do not
 * cover makes them `undefined`: the caller then runs the full analysis.
 */
import ts from "typescript";
import type { Json, ParseResult, SymbolDraft } from "../../types.js";

const syntax = ts as typeof ts & {
  getAssignmentTargetKind(node: ts.Node): number;
};

/** The body blocks of function-like nodes in `node` (itself included), outermost only. */
function bodiesWithin(node: ts.Node): ts.Block[] {
  const found: ts.Block[] = [];
  const visit = (child: ts.Node): void => {
    if (
      ts.isFunctionLike(child) &&
      "body" in child &&
      child.body &&
      ts.isBlock(child.body as ts.Node)
    ) {
      found.push(child.body as ts.Block);
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/**
 * A node's tokens, comments left out (JSDoc kept), with the bodies of the
 * functions inside it (itself included) shown as `{}`.
 */
function tokens(node: ts.Node, source: ts.SourceFile): string {
  const bodies = new Set<ts.Node>(bodiesWithin(node));
  const out: string[] = [];
  const visit = (child: ts.Node): void => {
    if (bodies.has(child)) {
      out.push("{}");
      return;
    }
    if (ts.isJSDoc(child)) {
      out.push(child.getText(source));
      return;
    }
    const children = child.getChildren(source);
    if (!children.length) {
      if (child.kind !== ts.SyntaxKind.EndOfFileToken)
        out.push(child.getText(source));
      return;
    }
    for (const item of children) visit(item);
  };
  visit(node);
  return out.join(" ");
}

const declarationFile = (path: string) => /\.d\.[cm]?ts$/.test(path);

const scriptKind = (path: string): ts.ScriptKind =>
  path.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : path.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : /\.[cm]?js$/.test(path)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

/**
 * The syntactic surface of one file's text, or undefined when the file can
 * declare or augment anything outside itself (a declaration file, `declare
 * global`, `declare module`).
 */
export function syntacticSurface(
  path: string,
  text: string,
): string | undefined {
  if (declarationFile(path)) return undefined;
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  );
  const parts: string[] = [
    `hashbang ${/^#!.*/.exec(text)?.[0] ?? ""}`,
    // The module's own test of a CommonJS file (index.ts `moduleKind`).
    `commonjs ${/(^|[^.\w$])(module\.exports|exports\.[\w$]+)\s*=/.test(text)}`,
  ];
  for (const reference of source.referencedFiles)
    parts.push(`path ${reference.fileName}`);
  for (const reference of source.typeReferenceDirectives)
    parts.push(`types ${reference.fileName} ${reference.resolutionMode ?? ""}`);
  for (const reference of source.libReferenceDirectives)
    parts.push(`lib ${reference.fileName}`);
  let open = true;
  // Inside function bodies: what the whole-program scans read
  // (object-producers.ts, extract.ts, global-types.ts) without the checker.
  const visit = (node: ts.Node): void => {
    if (!open) return;
    if (
      ts.isModuleDeclaration(node) &&
      (ts.isStringLiteral(node.name) ||
        node.flags & ts.NodeFlags.GlobalAugmentation)
    ) {
      // An ambient module or a global augmentation reaches other files.
      open = false;
      return;
    }
    if (ts.isImportTypeNode(node))
      parts.push(`import-type ${tokens(node.argument, source)}`);
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require")
      )
        parts.push(`call-module ${tokens(node, source)}`);
      else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        (callee.expression.text === "Object" ||
          callee.expression.text === "Reflect")
      )
        parts.push(`reflect ${tokens(node, source)}`);
    } else if (ts.isReturnStatement(node))
      parts.push(
        `return ${node.expression ? tokens(node.expression, source) : ""}`,
      );
    else if (ts.isArrowFunction(node) && !ts.isBlock(node.body))
      parts.push(`arrow ${tokens(node.body, source)}`);
    else if (ts.isVariableDeclaration(node) && node.initializer)
      parts.push(
        `initializer ${tokens(node.name, source)} = ${tokens(node.initializer, source)}`,
      );
    else if (ts.isDeleteExpression(node))
      parts.push(`delete ${tokens(node.expression, source)}`);
    if (
      (ts.isIdentifier(node) ||
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      syntax.getAssignmentTargetKind(node)
    )
      parts.push(
        `write ${syntax.getAssignmentTargetKind(node)} ${tokens(node, source)}`,
      );
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!open) return undefined;
  // Outside function bodies: every token.
  parts.push(`shallow ${tokens(source, source)}`);
  return parts.join("\n");
}

/** Nodes the checker surface reads per program before it gives up (counted). */
export const SURFACE_STEPS = 200_000;

/**
 * The checker surface of `fileName` in `program`: the printed inferred type
 * of every declaration outside function bodies without a written type (the
 * return type of each signature, the type of each variable, property,
 * parameter, binding and object member), in source order. Undefined when the file is a script (its declarations are
 * global), when the checker exhausts its stack, or past SURFACE_STEPS.
 */
export function checkerSurface(
  program: ts.Program,
  checker: ts.TypeChecker,
  fileName: string,
  steps = SURFACE_STEPS,
): string | undefined {
  const source = program.getSourceFile(fileName);
  if (!source || !checker.getSymbolAtLocation(source)) return undefined;
  const flags =
    ts.TypeFormatFlags.NoTruncation |
    ts.TypeFormatFlags.UseFullyQualifiedType |
    ts.TypeFormatFlags.UseStructuralFallback;
  const out: string[] = [];
  let left = steps;
  const visit = (node: ts.Node): void => {
    if (--left < 0) throw new SurfaceLimit();
    if (ts.isFunctionLike(node)) {
      const signature = checker.getSignatureFromDeclaration(
        node as ts.SignatureDeclaration,
      );
      if (signature && !annotated(node))
        out.push(
          `${ts.SyntaxKind[node.kind]} ${checker.typeToString(checker.getReturnTypeOfSignature(signature), undefined, flags)}`,
        );
      // Its parameters and type parameters, not its body.
      for (const parameter of (node as ts.SignatureDeclaration).parameters)
        visit(parameter);
      return;
    }
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node)) &&
      node.name &&
      !annotated(node)
    )
      out.push(
        `${ts.SyntaxKind[node.kind]} ${checker.typeToString(checker.getTypeAtLocation(node.name), undefined, flags)}`,
      );
    ts.forEachChild(node, visit);
  };
  try {
    visit(source);
  } catch (error) {
    if (error instanceof SurfaceLimit || error instanceof RangeError)
      return undefined;
    throw error;
  }
  return out.join("\n");
}

class SurfaceLimit extends Error {}

/**
 * Whether a declaration's type is written out (a type annotation, or a
 * JSDoc type in a JavaScript file): its tokens are then in the syntactic
 * surface, and only an inferred type needs the checker.
 */
function annotated(node: ts.Node): boolean {
  if ((node as { type?: ts.Node }).type) return true;
  if (ts.isFunctionLike(node)) return !!ts.getJSDocReturnType(node);
  return !!ts.getJSDocType(node);
}

/**
 * Old symbol key to new for one file whose declarations moved: the same
 * identities in the same order (the store's symbol IDs are identity and
 * ordinal). Undefined when the two symbol lists do not pair up.
 */
export function rekey(
  before: readonly SymbolDraft[],
  after: readonly SymbolDraft[],
): Map<string, string> | undefined {
  if (before.length !== after.length) return undefined;
  const map = new Map<string, string>();
  const queue = new Map<string, SymbolDraft[]>();
  for (const symbol of after)
    queue.set(symbol.identity, [...(queue.get(symbol.identity) ?? []), symbol]);
  for (const symbol of before) {
    const next = queue.get(symbol.identity)?.shift();
    if (!next || next.kind !== symbol.kind) return undefined;
    map.set(symbol.key, next.key);
  }
  return map;
}

/**
 * A result with every target fact into `file` moved to its new key, the
 * same object when nothing moved, or undefined when a target names a key
 * the map does not know.
 */
export function moveTargets(
  result: ParseResult,
  file: string,
  keys: ReadonlyMap<string, string>,
): ParseResult | undefined {
  let moved = false;
  let unknown = false;
  const visit = (value: Json): Json => {
    if (Array.isArray(value)) return value.map(visit);
    if (value === null || typeof value !== "object") return value;
    const record = value as { [key: string]: Json };
    if (record.file === file && typeof record.key === "string") {
      const key = keys.get(record.key);
      if (key === undefined) {
        unknown = true;
        return value;
      }
      if (key === record.key) return value;
      moved = true;
      return { ...record, key };
    }
    let changed = false;
    const next: { [key: string]: Json } = {};
    for (const [name, item] of Object.entries(record)) {
      const visited = visit(item);
      if (visited !== item) changed = true;
      next[name] = visited;
    }
    return changed ? next : value;
  };
  const links = result.links.map((link) =>
    link.data === undefined ? link : { ...link, data: visit(link.data) },
  );
  if (unknown) return undefined;
  return moved ? { ...result, links } : result;
}
