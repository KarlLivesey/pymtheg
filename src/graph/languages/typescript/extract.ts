import { posix } from "node:path";
import ts from "typescript";
import type {
  Diagnostic,
  Json,
  LinkDraft,
  ParseResult,
  SymbolDraft,
} from "../../types.js";
import { fromVirtual } from "./project.js";
import {
  NAMES,
  restoreNames,
  type FreshNames,
  type Renamed,
} from "./rename.js";

/** Per-file context for module-system names (see rename.ts). */
export interface RenameContext {
  fresh: FreshNames;
  /** Present when this file's compiler text was renamed. */
  renamed?: Renamed | undefined;
  /** Resolves a module specifier from a file to a captured path, if any. */
  resolveModule: (specifier: string, from: string) => string | undefined;
  /** Nodes (and warm-up steps) whose checker lookups overflowed before. */
  skip: ReadonlySet<string>;
  /** What a captured target file is: a module, a script (no exports), partial (syntax errors), or unavailable (failed). */
  moduleKind: (path: string) => "module" | "script" | "partial" | "unavailable";
  /** Offsets of assumed free `require`/`module` in each file (bundler reading). */
  assumedIn: (path: string) => ReadonlySet<number>;
  /** Whether any file of the program has such an assumption. */
  anyAssumed: boolean;
}
import {
  anchorOf,
  containerOf,
  identityOf,
  isEntityName,
  bindingSpecifier,
  isCommonJsRequire,
  isJsFile,
  keyOf,
  kindOf,
  nameOf,
  rangeOf,
  unwrap,
} from "./symbols.js";

/** A link target recorded by analysis: a symbol key inside a captured file. */
export interface TargetFact {
  file: string;
  key: string;
}
/** What a usage can mean: a call needs something callable, a type position a type. */
type Meaning = "call" | "value" | "type" | "any";
interface Targets {
  targets: TargetFact[];
  /** Whether the lookup passed through an import alias. */
  viaAlias?: boolean;
  /** Reached through a free `require` in an ES module (bundler assumption). */
  assumes?: boolean;
  /** The receiver of a member lookup, if any. */
  receiver?: ts.Expression | undefined;
  /**
   * Why there is no complete target set: external, local, no-symbol,
   * missing-module, external-package, unresolved-alias, computed-specifier.
   */
  reason?: string;
}

const TYPE_DECLARATIONS = new Set([
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.TypeParameter,
  ts.SyntaxKind.SourceFile,
]);
/** Declarations a call cannot invoke. */
const NOT_CALLABLE = new Set([
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.EnumMember,
  ts.SyntaxKind.TypeParameter,
]);
const TYPE_ONLY = new Set([
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.TypeParameter,
]);
const isLimit = (error: unknown) =>
  error instanceof RangeError && /call stack/i.test(error.message);
/** Thrown when the checker overflows: retry with `key` in RenameContext.skip. */
export class CheckerLimit extends Error {
  constructor(readonly key: string) {
    super(`The TypeScript checker exhausted its stack at ${key}`);
  }
}
/** Stands for a checker lookup that exhausted the stack. */
const LIMIT = Object.freeze({ flags: 0 }) as unknown as ts.Symbol;
/** A binding's reason when its module is a captured file the compiler did not type. */
const KIND_REASON = {
  module: "untyped-require",
  script: "not-a-module",
  partial: "partial-target",
  unavailable: "target-unavailable",
} as const;
/** moduleReason: the compiler did not type the specifier, but it names a captured file. */
const CAPTURED = "\0captured";
/** What a name lookup found: a symbol, or why there is none, and the member's receiver. */
interface Lookup {
  symbol?: ts.Symbol | undefined;
  reason?: string;
  receiver?: ts.Expression | undefined;
}
const clip = (text: string) => {
  const flat = text
    .replace(/\s*(\??\.)\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > 120 ? flat.slice(0, 117) + "..." : flat;
};
const isEntityChain = (node: ts.Expression): boolean =>
  ts.isIdentifier(node) ||
  node.kind === ts.SyntaxKind.ThisKeyword ||
  node.kind === ts.SyntaxKind.SuperKeyword ||
  (ts.isPropertyAccessExpression(node) && isEntityChain(node.expression)) ||
  (ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    isEntityChain(node.expression));

export function extractFile(
  file: ts.SourceFile,
  checker: ts.TypeChecker,
  program: ts.Program,
  captured: ReadonlySet<string>,
  diagnostics: Diagnostic[],
  data: { [key: string]: Json },
  incompleteConfig: boolean,
  context: RenameContext,
): ParseResult {
  const uncertainAt = new Set(context.renamed?.uncertain ?? []);
  const uncertainReason = (offset: number) =>
    context.renamed?.reasons[offset] ?? "dynamic-scope";
  const assumedAt = new Set(context.renamed?.assumed ?? []);
  /**
   * Whether a value rests on the bundler reading of a free `require`/`module`
   * in an ES module, in this file or another one: followed through alias
   * chains (imports, re-exports, barrels), variable and destructuring
   * initialisers, default exports and the members of a receiver chain.
   */
  const assumedMemo = new Map<ts.Symbol, boolean>();
  const symbolAssumed = (symbol: ts.Symbol | undefined, depth = 0): boolean => {
    if (!context.anyAssumed || !symbol || symbol === LIMIT || depth > 24)
      return false;
    const known = assumedMemo.get(symbol);
    if (known !== undefined) return known;
    assumedMemo.set(symbol, false);
    let result = false;
    let current: ts.Symbol | undefined = symbol;
    for (let steps = 0; current && steps < 64 && !result; steps++) {
      if (current.declarations?.some((d) => declarationAssumed(d, depth)))
        result = true;
      if (!(current.flags & ts.SymbolFlags.Alias)) break;
      const next: ts.Symbol | undefined =
        checker.getImmediateAliasedSymbol(current);
      if (!next || next === current) break;
      current = next;
    }
    assumedMemo.set(symbol, result);
    return result;
  };
  const declarationAssumed = (declaration: ts.Node, depth: number): boolean => {
    let holder: ts.Node | undefined = declaration;
    while (
      holder &&
      (ts.isBindingElement(holder) ||
        ts.isObjectBindingPattern(holder) ||
        ts.isArrayBindingPattern(holder))
    )
      holder = holder.parent;
    const value =
      holder && ts.isVariableDeclaration(holder)
        ? holder.initializer
        : holder && ts.isExportAssignment(holder)
          ? holder.expression
          : undefined;
    return !!value && expressionAssumed(value, depth + 1);
  };
  const expressionAssumed = (expression: ts.Expression, depth = 0): boolean => {
    if (!context.anyAssumed) return false;
    let current: ts.Node = expression;
    for (;;) {
      if (
        ts.isParenthesizedExpression(current) ||
        ts.isNonNullExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isAwaitExpression(current)
      ) {
        current = current.expression;
        continue;
      }
      if (ts.isPropertyAccessExpression(current)) {
        if (symbolAssumed(symbolOf(current.name), depth)) return true;
        current = current.expression;
        continue;
      }
      if (
        ts.isElementAccessExpression(current) ||
        ts.isCallExpression(current)
      ) {
        current = current.expression;
        continue;
      }
      break;
    }
    if (!ts.isIdentifier(current)) return false;
    const source = current.getSourceFile();
    const at = fromVirtual(source.fileName);
    if (at !== undefined && context.assumedIn(at).has(current.getStart(source)))
      return true;
    return symbolAssumed(symbolOf(current), depth);
  };

  // ----- syntax errors: what a partial declaration may support -----
  /**
   * Error positions per file: the parser's diagnostics plus heritage grammar
   * the parser accepts but that has no meaning (`extends A, B`, two
   * `extends` clauses, `extends` after `implements`, `implements` on an
   * interface).
   */
  const errorMemo = new Map<ts.SourceFile, number[]>();
  const errorsOf = (source: ts.SourceFile): number[] => {
    const known = errorMemo.get(source);
    if (known) return known;
    const errors = program
      .getSyntacticDiagnostics(source)
      .map((diagnostic) => diagnostic.start ?? 0);
    const visit = (node: ts.Node): void => {
      if (
        (ts.isClassLike(node) || ts.isInterfaceDeclaration(node)) &&
        node.heritageClauses?.length
      ) {
        const clauses = node.heritageClauses;
        const extendsClauses = clauses.filter(
          (c) => c.token === ts.SyntaxKind.ExtendsKeyword,
        );
        const bad =
          (ts.isClassLike(node) &&
            (extendsClauses.length > 1 ||
              extendsClauses.some((c) => c.types.length > 1) ||
              (clauses.findIndex(
                (c) => c.token === ts.SyntaxKind.ImplementsKeyword,
              ) <
                clauses.findIndex(
                  (c) => c.token === ts.SyntaxKind.ExtendsKeyword,
                ) &&
                clauses.some(
                  (c) => c.token === ts.SyntaxKind.ImplementsKeyword,
                ) &&
                extendsClauses.length > 0))) ||
          (ts.isInterfaceDeclaration(node) &&
            clauses.some((c) => c.token === ts.SyntaxKind.ImplementsKeyword));
        if (bad) errors.push(clauses[0]!.getStart(source));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    errors.sort((a, b) => a - b);
    errorMemo.set(source, errors);
    return errors;
  };
  /** The top-level statement (or the file) that contains a node. */
  const topOf = (node: ts.Node): ts.Node => {
    let current = node;
    while (current.parent && !ts.isSourceFile(current.parent))
      current = current.parent;
    return current;
  };
  /** The first error inside the top-level declaration containing `node`. */
  const firstError = (node: ts.Node): number | undefined => {
    const source = node.getSourceFile();
    const errors = errorsOf(source);
    if (!errors.length) return undefined;
    const top = topOf(node);
    const start = ts.isSourceFile(top) ? 0 : top.getStart(source);
    return errors.find((e) => e >= start && e <= top.end);
  };
  /** A target whose name token is not wholly before the first error. */
  const targetWithheld = (declaration: ts.Node): boolean => {
    // A module's existence never depends on its contents.
    if (ts.isSourceFile(declaration)) return false;
    const error = firstError(declaration);
    if (error === undefined) return false;
    const name = (declaration as ts.NamedDeclaration).name;
    return (name ?? declaration).end > error;
  };
  /** The part of a declaration that determines the type a lookup goes through. */
  const typePart = (declaration: ts.Node): ts.Node => {
    let holder: ts.Node = declaration;
    while (
      ts.isBindingElement(holder) ||
      ts.isObjectBindingPattern(holder) ||
      ts.isArrayBindingPattern(holder)
    )
      holder = holder.parent;
    if (ts.isFunctionLike(holder))
      return (holder as ts.SignatureDeclaration).type ?? holder;
    if (
      ts.isVariableDeclaration(holder) ||
      ts.isParameter(holder) ||
      ts.isPropertyDeclaration(holder) ||
      ts.isPropertySignature(holder) ||
      ts.isPropertyAssignment(holder)
    ) {
      const typed = holder as ts.VariableDeclaration;
      return typed.type ?? typed.initializer ?? typed.name;
    }
    if (
      ts.isClassLike(holder) ||
      ts.isInterfaceDeclaration(holder) ||
      ts.isEnumDeclaration(holder) ||
      ts.isModuleDeclaration(holder)
    )
      return (holder as ts.NamedDeclaration).name ?? holder;
    return holder;
  };
  /** A symbol whose type-determining part is not wholly before the first error. */
  const throughWithheld = (symbol: ts.Symbol | undefined): boolean => {
    if (!symbol || symbol === LIMIT) return false;
    let current = symbol;
    if (current.flags & ts.SymbolFlags.Alias)
      current = checker.getAliasedSymbol(current);
    return !!current.declarations?.some((declaration) => {
      const at = fromVirtual(declaration.getSourceFile().fileName);
      if (at === undefined || !captured.has(at)) return false;
      const error = firstError(declaration);
      if (error === undefined) return false;
      if (targetWithheld(declaration)) return true;
      // An unannotated parameter takes its type from the callee it is passed to.
      if (
        ts.isParameter(declaration) &&
        !declaration.type &&
        (ts.isArrowFunction(declaration.parent) ||
          ts.isFunctionExpression(declaration.parent)) &&
        ts.isCallExpression(declaration.parent.parent)
      )
        return throughWithheld(
          symbolOf(calleeName(declaration.parent.parent.expression)),
        );
      return typePart(declaration).end > error;
    });
  };
  const calleeName = (callee: ts.Expression): ts.Node => {
    const value = unwrap(callee);
    return ts.isPropertyAccessExpression(value) ? value.name : value;
  };
  /** A member reached through a receiver whose type rests on partial structure. */
  const receiverWithheld = (
    receiver: ts.Expression,
    targets: readonly ts.Node[],
  ): boolean => {
    let current: ts.Node = receiver;
    for (;;) {
      if (
        ts.isParenthesizedExpression(current) ||
        ts.isNonNullExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isAwaitExpression(current)
      )
        current = current.expression;
      else if (ts.isPropertyAccessExpression(current)) {
        if (throughWithheld(symbolOf(current.name))) return true;
        current = current.expression;
      } else if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
        if (throughWithheld(symbolOf(calleeName(current.expression))))
          return true;
        current = current.expression;
      } else if (ts.isElementAccessExpression(current))
        current = current.expression;
      else break;
    }
    if (ts.isIdentifier(current) && throughWithheld(symbolOf(current)))
      return true;
    // Inherited members through a heritage clause that is not wholly before
    // the first error of the receiver type's declaration.
    const type = checker.getTypeAtLocation(receiver);
    for (const declaration of type.getSymbol()?.declarations ?? []) {
      if (
        !(
          ts.isClassLike(declaration) || ts.isInterfaceDeclaration(declaration)
        ) ||
        !declaration.heritageClauses?.length
      )
        continue;
      const error = firstError(declaration);
      const heritageEnd = declaration.heritageClauses.at(-1)!.end;
      if (error === undefined || error >= heritageEnd) continue;
      if (targets.some((target) => target.parent !== declaration)) return true;
    }
    return false;
  };
  const freshExportNames = new Set(Object.values(context.fresh.local));
  const path = file.fileName.slice(1);
  const symbols: SymbolDraft[] = [];
  const links: LinkDraft[] = [];
  const keys = new Set<string>();
  const moduleKey = keyOf(file);
  const range = (node: ts.Node) => ({
    start: node.getStart(file),
    end: node.end,
  });

  // The checker recurses once per inference step and can exhaust the stack.
  // After an overflow its internal state is not trustworthy (a retried lookup
  // may silently answer "no symbol"), so an overflow aborts this extraction
  // with CheckerLimit; the caller rebuilds the program and retries with that
  // node in `skip`, whose links are then `compiler-limit` without asking.
  let limitHit = false;
  let limited = false;
  function targetsOf(
    query: Lookup | ts.Symbol | undefined,
    meaning: Meaning,
  ): Targets {
    if (limited) {
      limitHit = true;
      return { targets: [], reason: "compiler-limit" };
    }
    return resolveTargets(query, meaning);
  }
  function resolveTargets(
    query: Lookup | ts.Symbol | undefined,
    meaning: Meaning,
  ): Targets {
    if (
      query === LIMIT ||
      (query && !("flags" in query) && query.symbol === LIMIT)
    )
      return { targets: [], reason: "compiler-limit" };
    const found: Lookup =
      query && "flags" in query ? { symbol: query } : (query ?? {});
    const receiver = found.receiver;
    if (found.reason || !found.symbol) {
      // Unresolved, but still resting on the bundler reading if its receiver does.
      const assumes = receiver !== undefined && expressionAssumed(receiver);
      return {
        targets: [],
        reason: found.reason ?? "no-symbol",
        receiver,
        ...(assumes ? { assumes } : {}),
      };
    }
    const facts = new Map<string, TargetFact>();
    let external = 0;
    let local = 0;
    let viaAlias = false;
    let firstAlias: ts.Symbol | undefined;
    let partial = false;
    const declared: ts.Node[] = [];
    const record = (declaration: ts.Declaration): boolean => {
      const target = fromVirtual(declaration.getSourceFile().fileName);
      if (target === undefined || !captured.has(target)) return false;
      const anchor = anchorOf(declaration);
      if (!anchor) return false;
      const key = keyOf(anchor);
      facts.set(`${target}\0${key}`, { file: target, key });
      declared.push(declaration);
      // Recovered structure at or after a syntax error supports no link.
      if (targetWithheld(declaration)) partial = true;
      return true;
    };
    const visit = (value: ts.Symbol, depth: number) => {
      let current = value;
      if (current.flags & ts.SymbolFlags.Alias) {
        viaAlias = true;
        firstAlias ??= current;
        current = checker.getAliasedSymbol(current);
      }
      let declarations = current.declarations ?? [];
      if (meaning !== "any" && declarations.length > 1) {
        const filtered = declarations.filter((declaration) =>
          meaning === "type"
            ? TYPE_DECLARATIONS.has(declaration.kind)
            : meaning === "call"
              ? !NOT_CALLABLE.has(declaration.kind)
              : !TYPE_ONLY.has(declaration.kind),
        );
        if (filtered.length) declarations = filtered;
      }
      if (!declarations.length) external++;
      for (const declaration of declarations) {
        if (ts.isShorthandPropertyAssignment(declaration) && depth < 8) {
          const shorthand =
            checker.getShorthandAssignmentValueSymbol(declaration);
          if (shorthand) {
            visit(shorthand, depth + 1);
            continue;
          }
        }
        const target = fromVirtual(declaration.getSourceFile().fileName);
        if (target === undefined || !captured.has(target)) {
          external++;
          continue;
        }
        if (!record(declaration)) local++;
      }
    };
    visit(found.symbol, 0);
    const targets = [...facts.values()];
    const assumes =
      symbolAssumed(found.symbol) ||
      (receiver !== undefined && expressionAssumed(receiver));
    if (
      !partial &&
      targets.length &&
      receiver !== undefined &&
      receiverWithheld(receiver, declared)
    )
      partial = true;
    if (partial)
      return {
        targets,
        reason: "partial-declaration",
        viaAlias,
        receiver,
        ...(assumes ? { assumes } : {}),
      };
    if (!external && !local)
      return { targets, viaAlias, receiver, ...(assumes ? { assumes } : {}) };
    // An alias whose module did not resolve keeps that module's reason.
    const moduleFailure =
      external &&
      !targets.length &&
      ((firstAlias && bindingReason(firstAlias)) ||
        (receiver && receiverReason(receiver)));
    return {
      targets,
      reason: local ? "local" : moduleFailure || "external",
      viaAlias,
      receiver,
      ...(assumes ? { assumes } : {}),
    };
  }
  /** The module reason of a member's receiver root, if that root is an unresolved binding. */
  function receiverReason(receiver: ts.Expression): string | undefined {
    const root = rootOf(receiver);
    const symbol = root && symbolOf(root);
    return symbol && symbol.flags & ts.SymbolFlags.Alias
      ? bindingReason(symbol)
      : undefined;
  }
  function bindingReason(symbol: ts.Symbol): string | undefined {
    const specifier = bindingSpecifier(symbol);
    return specifier && bindingModuleReason(specifier);
  }
  /** A binding's reason from its module: a captured file the compiler did not type. */
  function bindingModuleReason(specifier: ts.Expression): string | undefined {
    const reason = moduleReason(specifier);
    if (reason !== CAPTURED) return reason;
    const file = context.resolveModule(
      (specifier as ts.StringLiteralLike).text,
      path,
    )!;
    return KIND_REASON[context.moduleKind(file)];
  }
  /**
   * Under a config whose `extends` chain could not be captured, module
   * resolution and every checker answer reached through an import may differ.
   * Kept definite only: targets in this file, reached without an import step,
   * through no receiver or a receiver that is `this`/`super` or a class, enum,
   * namespace or function declared in this file.
   */
  function stableReceiver(expression: ts.Expression): boolean {
    const value = unwrap(expression);
    if (
      value.kind === ts.SyntaxKind.ThisKeyword ||
      value.kind === ts.SyntaxKind.SuperKeyword
    )
      return true;
    if (!ts.isIdentifier(value)) return false;
    const symbol = checker.getSymbolAtLocation(value);
    return (
      !!symbol &&
      !(symbol.flags & ts.SymbolFlags.Alias) &&
      !!symbol.declarations?.length &&
      symbol.declarations.every(
        (declaration) =>
          declaration.getSourceFile() === file &&
          (ts.isClassDeclaration(declaration) ||
            ts.isEnumDeclaration(declaration) ||
            ts.isModuleDeclaration(declaration) ||
            ts.isFunctionDeclaration(declaration)),
      )
    );
  }
  function link(
    sourceKey: string,
    kind: string,
    targetName: string,
    at: ts.Node,
    found: Targets,
    extra: { [key: string]: Json } = {},
  ) {
    const facts: { [key: string]: Json } = { ...extra };
    let reason = found.reason;
    // Inside a `with` body every name may be a property of the object.
    if (
      !found.targets.length &&
      (reason === "no-symbol" || reason === "external") &&
      ts.findAncestor(
        at,
        (node) =>
          !!node.parent &&
          ts.isWithStatement(node.parent) &&
          node.parent.statement === node,
      )
    )
      reason = "dynamic-scope";
    if (
      incompleteConfig &&
      (kind === "imports" ||
        kind === "exports" ||
        found.viaAlias ||
        found.targets.some((target) => target.file !== path) ||
        (found.receiver !== undefined && !stableReceiver(found.receiver)) ||
        (reason !== undefined && reason !== "local"))
    ) {
      if (reason) facts.reasonWithoutConfig = reason;
      reason = "incomplete-config";
    }
    if (found.targets.length)
      facts.targets = found.targets.map((target) => ({ ...target }));
    if (reason) facts.reason = reason;
    // Node itself has no `require` in an ES module; a bundler does.
    if (found.assumes) facts.assumes = "bundler-require";
    links.push({
      sourceKey,
      kind,
      targetName: clip(targetName) || "(expression)",
      range: range(at),
      data: facts,
    });
  }
  const paths = Object.keys(program.getCompilerOptions().paths ?? {});
  /** Why a module specifier does not resolve, or undefined when it does. */
  function moduleReason(specifier: ts.Expression): string | undefined {
    if (!ts.isStringLiteralLike(specifier)) return "computed-specifier";
    if (limited) return "compiler-limit";
    if (checker.getSymbolAtLocation(specifier)) return undefined;
    const text = specifier.text;
    // A captured file the compiler did not type here (a script, or a require
    // form the compiler does not recognise): the edge to that file is known.
    const resolved = context.resolveModule(text, path);
    if (resolved !== undefined && captured.has(resolved)) return CAPTURED;
    if (/^\.\.?(\/|$)/.test(text) || text.startsWith("/"))
      return "missing-module";
    const aliased =
      text.startsWith("#") ||
      paths.some((pattern) => {
        const star = pattern.indexOf("*");
        return star < 0
          ? pattern === text
          : text.length >= pattern.length - 1 &&
              text.startsWith(pattern.slice(0, star)) &&
              text.endsWith(pattern.slice(star + 1));
      });
    return aliased ? "unresolved-alias" : "external-package";
  }
  function moduleLink(
    owner: string,
    specifier: ts.StringLiteralLike,
    extra: { [key: string]: Json },
  ) {
    const reason = moduleReason(specifier);
    // The compiler did not type this edge, but the file is captured: link it.
    const file =
      reason === CAPTURED
        ? context.resolveModule(specifier.text, path)
        : undefined;
    const kind = file ? context.moduleKind(file) : undefined;
    const found: Targets = file
      ? {
          targets: [{ file, key: "module@0" }],
          // A target whose analysis failed has no facts to link to.
          ...(kind === "unavailable" ? { reason: "target-unavailable" } : {}),
        }
      : reason
        ? { targets: [], reason }
        : targetsOf(checker.getSymbolAtLocation(specifier), "any");
    // A target file whose analysis failed has no facts to link to.
    const reached = found.targets[0]?.file;
    const final: Targets =
      !found.reason &&
      reached !== undefined &&
      context.moduleKind(reached) === "unavailable"
        ? { ...found, reason: "target-unavailable" }
        : found;
    link(owner, "imports", specifier.text, specifier, final, {
      specifier: specifier.text,
      // `notAModule` means one thing: the target file has no imports/exports.
      ...(file && context.moduleKind(file) === "script"
        ? { notAModule: true }
        : {}),
      ...extra,
    });
  }
  const symbolOf = (node: ts.Node): ts.Symbol | undefined => {
    if (limited) {
      limitHit = true;
      return LIMIT;
    }
    return checker.getSymbolAtLocation(node);
  };

  /** The receiver of a member name (`a.b` → `a`, `a["b"]` → `a`, `A.B` → `A`). */
  const receiverOf = (node: ts.Node): ts.Expression | undefined => {
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node)
      return parent.expression;
    if (
      ts.isElementAccessExpression(parent) &&
      parent.argumentExpression === node
    )
      return parent.expression;
    if (ts.isQualifiedName(parent) && parent.right === node)
      return parent.left as unknown as ts.Expression;
    return undefined;
  };
  const rootOf = (node: ts.Node): ts.Identifier | undefined => {
    let current: ts.Node = node;
    for (;;) {
      if (ts.isIdentifier(current)) return current;
      if (
        ts.isPropertyAccessExpression(current) ||
        ts.isElementAccessExpression(current) ||
        ts.isCallExpression(current) ||
        ts.isParenthesizedExpression(current) ||
        ts.isNonNullExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isAwaitExpression(current)
      )
        current = current.expression;
      else if (ts.isQualifiedName(current)) current = current.left;
      else return undefined;
    }
  };
  /** `require` inside `(require)` or `(0, require)`. */
  function requireIdentifier(callee: ts.Expression): ts.Identifier | undefined {
    if (!ts.isParenthesizedExpression(callee)) return undefined;
    let inner = callee.expression;
    while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
    if (
      ts.isBinaryExpression(inner) &&
      inner.operatorToken.kind === ts.SyntaxKind.CommaToken
    )
      inner = inner.right;
    return ts.isIdentifier(inner) && inner.text === "require"
      ? inner
      : undefined;
  }
  /** Binding links for `const x = <loader call>` / `const { a } = <loader call>`. */
  function requireBindings(
    owner: string,
    node: ts.CallExpression,
    requireFacts: { [key: string]: Json },
  ) {
    let holder: ts.Node = node;
    while (
      ts.isParenthesizedExpression(holder.parent) ||
      ts.isAsExpression(holder.parent)
    )
      holder = holder.parent;
    const declaration = holder.parent;
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer === holder
    ) {
      if (ts.isIdentifier(declaration.name))
        binding(
          owner,
          "*",
          declaration.name,
          declaration.name,
          "imports",
          requireFacts,
          node.arguments[0],
        );
      else if (ts.isObjectBindingPattern(declaration.name))
        for (const element of declaration.name.elements)
          if (ts.isIdentifier(element.name))
            binding(
              owner,
              element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : element.name.text,
              element,
              element.name,
              "imports",
              requireFacts,
              node.arguments[0],
            );
    }
  }
  /** A supported indirect loader call form, by name; undefined otherwise. */
  function requireForm(call: ts.CallExpression): string | undefined {
    if (!isJsFile(file) || call.arguments.length !== 1) return undefined;
    if (!ts.isStringLiteralLike(call.arguments[0]!)) return undefined;
    const callee = call.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "require" &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "module"
    )
      return "module.require";
    const id = requireIdentifier(callee);
    if (!id) return undefined;
    let inner = (callee as ts.ParenthesizedExpression).expression;
    while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
    return ts.isBinaryExpression(inner) ? "(0, require)" : "(require)";
  }
  /** The checker's symbol for a name, with the receiver of a member name. */
  function lookup(node: ts.Node): Lookup {
    const receiver = receiverOf(node);
    const symbol = symbolOf(node);
    if (!symbol && receiver) {
      const root = rootOf(receiver);
      // A value from an uncertain `require(...)` call (dynamic scope).
      if (root && uncertainAt.has(root.getStart(file)))
        return { reason: uncertainReason(root.getStart(file)), receiver };
      const rootSymbol = root && symbolOf(root);
      const declaration = rootSymbol?.declarations?.[0];
      if (
        declaration &&
        (ts.isVariableDeclaration(declaration) ||
          ts.isBindingElement(declaration))
      ) {
        let holder: ts.Node = declaration;
        while (!ts.isVariableDeclaration(holder)) holder = holder.parent;
        const init = (holder as ts.VariableDeclaration).initializer;
        const initRoot = init && rootOf(init);
        const initCall = init && unwrap(init);
        if (
          initCall &&
          ts.isCallExpression(initCall) &&
          requireForm(initCall) &&
          holder.getSourceFile() === file
        )
          return { reason: "untyped-require", receiver };
        if (initRoot && uncertainAt.has(initRoot.getStart(file)))
          return {
            reason: uncertainReason(initRoot.getStart(file)),
            receiver,
          };
      }
      // A member of a binding whose module did not resolve keeps that reason.
      const reason =
        rootSymbol &&
        rootSymbol.flags & ts.SymbolFlags.Alias &&
        bindingReason(rootSymbol);
      if (reason) return { reason, receiver };
    }
    return symbol ? { symbol, receiver } : { receiver };
  }
  function calleeTarget(callee: ts.Expression): {
    at: ts.Node;
    symbol: Lookup;
  } {
    const expression = unwrap(callee);
    if (ts.isPropertyAccessExpression(expression))
      return { at: expression.name, symbol: lookup(expression.name) };
    if (ts.isElementAccessExpression(expression))
      return {
        at: expression,
        symbol: ts.isStringLiteralLike(expression.argumentExpression)
          ? lookup(expression.argumentExpression)
          : {},
      };
    if (
      ts.isIdentifier(expression) ||
      expression.kind === ts.SyntaxKind.SuperKeyword
    )
      return { at: expression, symbol: { symbol: symbolOf(expression) } };
    return { at: callee, symbol: {} };
  }
  function callLink(
    owner: string,
    callee: ts.Expression,
    extra: { [key: string]: Json } = {},
  ) {
    const { at, symbol } = calleeTarget(callee);
    const expression = unwrap(callee);
    const name = isEntityChain(expression)
      ? expression.getText(file)
      : ts.isPropertyAccessExpression(expression)
        ? `(expression).${expression.name.text}`
        : "(expression)";
    link(owner, "calls", name, at, targetsOf(symbol, "call"), extra);
  }
  function binding(
    owner: string,
    importedName: string,
    at: ts.Node,
    name: ts.Node,
    kind: string,
    extra: { [key: string]: Json },
    specifier?: ts.Expression,
  ) {
    // Bindings from a module that does not resolve share its reason.
    let reason = specifier && bindingModuleReason(specifier);
    if (!reason && specifier && ts.isStringLiteralLike(specifier)) {
      const module = context.resolveModule(specifier.text, path);
      if (module !== undefined && context.moduleKind(module) === "unavailable")
        reason = "target-unavailable";
    }
    let found: Targets = reason
      ? { targets: [], reason }
      : targetsOf(symbolOf(name), extra.typeOnly ? "type" : "any");
    // An export NAME `require`/`module`/`exports` is renamed in JS files only;
    // between a JS and a TS file (or a CommonJS property) the names differ.
    if (
      !reason &&
      !found.targets.length &&
      (freshExportNames.has(importedName) ||
        (NAMES as readonly string[]).includes(importedName))
    )
      found = { ...found, reason: "renamed-export" };
    link(owner, kind, importedName, at, found, extra);
  }

  function handle(node: ts.Node, owner: string): string | null {
    const anchor = anchorOf(node);
    if (anchor === node) {
      const key = keyOf(node);
      if (keys.has(key)) throw Error(`Duplicate symbol key ${key} in ${path}`);
      keys.add(key);
      const symbolData: { [key: string]: Json } = {};
      if (ts.isSourceFile(node)) {
        symbolData.declarationFile = node.isDeclarationFile;
        symbolData.javascript = isJsFile(node);
      }
      symbols.push({
        key,
        name: nameOf(node),
        kind: kindOf(node),
        identity: identityOf(node),
        range: rangeOf(node),
        ...(Object.keys(symbolData).length ? { data: symbolData } : {}),
      });
      const container = containerOf(node);
      if (container) {
        const containerKey = keyOf(container);
        links.push({
          sourceKey: containerKey,
          kind: "contains",
          targetName: identityOf(node),
          range: rangeOf(node),
          data: { targets: [{ file: path, key }] },
        });
      }
    }
    if (anchor) owner = keyOf(anchor);

    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const typeOnly = !!clause?.isTypeOnly;
      moduleLink(moduleKey, node.moduleSpecifier, typeOnly ? { typeOnly } : {});
      const facts = (only: boolean) => (only ? { typeOnly: true } : {});
      if (clause?.name)
        binding(
          moduleKey,
          "default",
          clause.name,
          clause.name,
          "imports",
          facts(typeOnly),
          node.moduleSpecifier,
        );
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        binding(
          moduleKey,
          "*",
          bindings,
          bindings.name,
          "imports",
          facts(typeOnly),
          node.moduleSpecifier,
        );
      else if (bindings)
        for (const element of bindings.elements)
          binding(
            moduleKey,
            (element.propertyName ?? element.name).text,
            element,
            element.name,
            "imports",
            facts(typeOnly || element.isTypeOnly),
            node.moduleSpecifier,
          );
      return null;
    }
    if (ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      const typeOnly = node.isTypeOnly;
      if (specifier && ts.isStringLiteralLike(specifier))
        moduleLink(moduleKey, specifier, {
          reexport: true,
          ...(typeOnly ? { typeOnly } : {}),
        });
      const clause = node.exportClause;
      if (clause && ts.isNamespaceExport(clause))
        binding(moduleKey, "*", clause, clause.name, "exports", {}, specifier);
      else if (clause)
        for (const element of clause.elements) {
          const local = specifier
            ? symbolOf(element.name)
            : limited
              ? LIMIT
              : checker.getExportSpecifierLocalTargetSymbol(element);
          const only = typeOnly || element.isTypeOnly;
          const reason = specifier && bindingModuleReason(specifier);
          link(
            moduleKey,
            "exports",
            (element.propertyName ?? element.name).text,
            element,
            reason
              ? { targets: [], reason }
              : targetsOf(local, only ? "type" : "any"),
            only ? { typeOnly: true } : {},
          );
        }
      return null;
    }
    if (ts.isExportAssignment(node) && isEntityName(unwrap(node.expression))) {
      const expression = unwrap(node.expression);
      const at = ts.isPropertyAccessExpression(expression)
        ? expression.name
        : expression;
      link(
        moduleKey,
        "exports",
        node.isExportEquals ? "export=" : "default",
        node.expression,
        targetsOf(lookup(at), "any"),
      );
      return null;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (
        ts.isExternalModuleReference(reference) &&
        ts.isStringLiteralLike(reference.expression)
      ) {
        moduleLink(moduleKey, reference.expression, {});
        binding(
          moduleKey,
          "*",
          node.name,
          node.name,
          "imports",
          {},
          reference.expression,
        );
      } else if (!ts.isExternalModuleReference(reference)) {
        const at = ts.isQualifiedName(reference) ? reference.right : reference;
        link(
          owner,
          "references",
          reference.getText(file),
          reference,
          targetsOf(symbolOf(at), "any"),
        );
      }
      return null;
    }
    if (ts.isCallExpression(node)) {
      const argument = node.arguments[0];
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (argument && ts.isStringLiteralLike(argument))
          moduleLink(owner, argument, { dynamic: true });
        else
          link(
            owner,
            "imports",
            "(dynamic import)",
            node,
            { targets: [], reason: "computed-specifier" },
            { dynamic: true },
          );
      } else if (
        ts.isIdentifier(node.expression) &&
        uncertainAt.has(node.expression.getStart(file))
      ) {
        // `require`/`module`/`exports` whose meaning is decided at run time
        // (with, direct eval, reassignment): neither the loader nor local.
        const argument = node.arguments[0];
        if (
          context.fresh.uncertain.require === node.expression.text &&
          argument &&
          ts.isStringLiteralLike(argument)
        ) {
          const target = context.resolveModule(argument.text, path);
          link(
            owner,
            "imports",
            argument.text,
            argument,
            {
              // A createRequire base decides where it resolves: the
              // would-be target from this file is not kept then.
              targets:
                target !== undefined &&
                captured.has(target) &&
                uncertainReason(node.expression.getStart(file)) ===
                  "dynamic-scope"
                  ? [{ file: target, key: "module@0" }]
                  : [],
              reason: uncertainReason(node.expression.getStart(file)),
            },
            { specifier: argument.text, require: true },
          );
        }
        link(owner, "calls", node.expression.text, node.expression, {
          targets: [],
          reason: uncertainReason(node.expression.getStart(file)),
        });
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments.length === 1 &&
        !ts.isStringLiteralLike(node.arguments[0]!) &&
        isJsFile(file)
      )
        link(
          owner,
          "imports",
          "(computed require)",
          node,
          { targets: [], reason: "computed-specifier" },
          { require: true },
        );
      else if (isCommonJsRequire(node)) {
        const requireFacts: { [key: string]: Json } = assumedAt.has(
          node.expression.getStart(file),
        )
          ? { require: true, assumes: "bundler-require" }
          : { require: true };
        moduleLink(
          owner,
          node.arguments[0] as ts.StringLiteralLike,
          requireFacts,
        );
        requireBindings(owner, node, requireFacts);
      } else if (requireForm(node)) {
        // `(require)("x")`, `(0, require)("x")`, `module.require("x")`: the
        // loader, though the compiler does not type it; the edge is linked.
        const callee = node.expression;
        const id = ts.isPropertyAccessExpression(callee)
          ? (callee.expression as ts.Identifier)
          : requireIdentifier(callee)!;
        const formFacts: { [key: string]: Json } = {
          require: true,
          calleeForm: requireForm(node)!,
          ...(assumedAt.has(id.getStart(file))
            ? { assumes: "bundler-require" }
            : {}),
        };
        moduleLink(owner, node.arguments[0] as ts.StringLiteralLike, formFacts);
        // Its bindings are real but the compiler does not type them.
        requireBindings(owner, node, formFacts);
      } else callLink(owner, node.expression);
    } else if (ts.isNewExpression(node))
      callLink(owner, node.expression, { construct: true });
    else if (ts.isTaggedTemplateExpression(node))
      callLink(owner, node.tag, { tagged: true });
    else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      const intrinsic =
        ts.isJsxNamespacedName(tag) ||
        (ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) ||
        tag.kind === ts.SyntaxKind.ThisKeyword;
      if (!intrinsic) {
        const at = ts.isPropertyAccessExpression(tag) ? tag.name : tag;
        link(
          owner,
          "calls",
          tag.getText(file),
          at,
          targetsOf(lookup(at), "call"),
          { jsx: true },
        );
      }
    } else if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName;
      const at = ts.isQualifiedName(name) ? name.right : name;
      link(
        owner,
        "references",
        name.getText(file),
        name,
        targetsOf(lookup(at), "type"),
      );
    } else if (ts.isTypeQueryNode(node)) {
      const name = node.exprName;
      const at = ts.isQualifiedName(name) ? name.right : name;
      link(
        owner,
        "references",
        name.getText(file),
        name,
        targetsOf(lookup(at), "value"),
        { typeof: true },
      );
    } else if (
      ts.isExpressionWithTypeArguments(node) &&
      ts.isHeritageClause(node.parent)
    ) {
      const kind =
        node.parent.token === ts.SyntaxKind.ImplementsKeyword
          ? "implements"
          : "extends";
      const expression = unwrap(node.expression);
      const at = ts.isPropertyAccessExpression(expression)
        ? expression.name
        : expression;
      const found = targetsOf(
        lookup(at),
        ts.isInterfaceDeclaration(node.parent.parent) || kind === "implements"
          ? "type"
          : "value",
      );
      // A heritage clause that is not wholly before the first syntax error of
      // its declaration supports nothing.
      const error = firstError(node.parent.parent);
      link(
        owner,
        kind,
        isEntityChain(expression) ? expression.getText(file) : "(expression)",
        node.expression,
        error !== undefined &&
          error <= node.parent.parent.heritageClauses!.at(-1)!.end
          ? { ...found, reason: "partial-declaration" }
          : found,
      );
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (
        ts.isLiteralTypeNode(argument) &&
        ts.isStringLiteralLike(argument.literal)
      )
        moduleLink(owner, argument.literal, { typeOnly: true });
    }
    return owner;
  }
  /** Visits a node: its own links in a guard, then its children. */
  function visit(node: ts.Node, owner: string) {
    const key = `${node.kind}@${node.getStart(file)}`;
    limited = context.skip.has(key);
    let next: string | null;
    try {
      next = handle(node, owner);
    } catch (error) {
      if (isLimit(error)) throw new CheckerLimit(key);
      throw error;
    } finally {
      limited = false;
    }
    if (next !== null) ts.forEachChild(node, (child) => visit(child, next));
  }
  // Ask for declaration types in source order first, so each inference step
  // builds on an already computed one instead of recursing through the chain.
  // The whole program is warmed in program order before extraction (index.ts).

  visit(file, moduleKey);

  // Triple-slash directives: path references link to the file; types and lib
  // references name packages or the standard library, which are never captured.
  const directives: [ts.FileReference, string][] = [
    ...file.referencedFiles.map(
      (item) => [item, "path"] as [ts.FileReference, string],
    ),
    ...file.typeReferenceDirectives.map(
      (item) => [item, "types"] as [ts.FileReference, string],
    ),
    ...file.libReferenceDirectives.map(
      (item) => [item, "lib"] as [ts.FileReference, string],
    ),
  ];
  for (const [reference, kind] of directives.sort(
    (a, b) => a[0].pos - b[0].pos,
  )) {
    let found: Targets = {
      targets: [],
      reason: kind === "lib" ? "external" : "external-package",
    };
    if (kind === "path") {
      const base = posix.normalize(
        posix.join(posix.dirname(file.fileName), reference.fileName),
      );
      const target = [base, `${base}.ts`, `${base}.d.ts`, `${base}.tsx`]
        .map((name) => program.getSourceFile(name))
        .find((source) => source && captured.has(source.fileName.slice(1)));
      found = target
        ? { targets: [{ file: target.fileName.slice(1), key: keyOf(target) }] }
        : { targets: [], reason: "missing-module" };
    }
    links.push({
      sourceKey: moduleKey,
      kind: "imports",
      targetName: reference.fileName || "(empty reference)",
      range: { start: reference.pos, end: reference.end },
      data: {
        reference: kind,
        ...(found.targets.length
          ? { targets: found.targets.map((target) => ({ ...target })) }
          : {}),
        ...(found.reason ? { reason: found.reason } : {}),
      },
    });
  }

  for (const diagnostic of program.getSyntacticDiagnostics(file)) {
    const start = diagnostic.start ?? 0;
    diagnostics.push({
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      range: {
        start,
        end: Math.min(file.text.length, start + (diagnostic.length ?? 0)),
      },
    });
  }
  // Heritage grammar the parser accepts but that has no meaning makes this
  // file partial too (see errorsOf).
  for (const at of errorsOf(file))
    if (
      !program
        .getSyntacticDiagnostics(file)
        .some((diagnostic) => diagnostic.start === at)
    )
      diagnostics.push({
        message:
          "Invalid heritage clauses (more than one base class, extends after implements, or implements on an interface)",
        range: { start: at, end: at },
      });
  if (limitHit)
    diagnostics.push({
      message:
        "The TypeScript checker exhausted its stack on some lookups; those links are unresolved (compiler-limit)",
    });
  // Facts of a renamed file report the original names (see rename.ts).
  if (context.renamed) {
    const fresh = context.fresh;
    for (const symbol of symbols) {
      symbol.name = restoreNames(symbol.name, fresh);
      symbol.identity = restoreNames(symbol.identity, fresh);
    }
    for (const item of links)
      item.targetName = restoreNames(item.targetName, fresh);
    for (const diagnostic of diagnostics)
      diagnostic.message = restoreNames(diagnostic.message, fresh);
  }

  return {
    status: diagnostics.length ? "partial" : "clean",
    diagnostics,
    symbols,
    links,
    data,
  };
}
