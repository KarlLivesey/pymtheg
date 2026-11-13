import { posix } from "node:path";
import ts from "typescript";
import type {
  Diagnostic,
  Json,
  LinkDraft,
  ParseResult,
  SymbolDraft,
} from "../../types.js";
import { fromVirtual, toVirtual } from "./project.js";
import {
  aliasChain,
  causesOfSymbol,
  usesOwnerTypeParameters,
  taintOf,
  type Taint,
} from "./taint.js";
import { createJudge, type Judge, type Judged } from "./judge.js";
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
  /**
   * What a captured target file is: a module, a script (no exports),
   * invalid (a syntax error: failed, absent from every program), or
   * unavailable (failed for another reason).
   */
  moduleKind: (path: string) => "module" | "script" | "invalid" | "unavailable";
  /** Whether this program would include any failed file (taint is computed then). */
  anyFailed: boolean;
  /**
   * Identifier names that occur in the text of the program's failed files,
   * with those files: an unseen declaration can only introduce such a name.
   */
  failedNames: ReadonlyMap<string, readonly string[]>;
}
/** One structural judgement per program (its checker), shared by its files. */
const judges = new WeakMap<ts.TypeChecker, Judge>();
import {
  anchorOf,
  rootDeclaration,
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
  /** The receiver of a member lookup, if any. */
  receiver?: ts.Expression | undefined;
  /** For `invalid-code`: the failed file(s) that caused it (never a target). */
  cause?: readonly string[];
  /** For `invalid-code`: what in valid code depends on the failed file. */
  via?: string;
  /** The declarations recorded as targets (for the own-member test). */
  declarations?: readonly ts.Node[];
  /** Unresolved with no declaration found anywhere (not even outside the project). */
  noAnswer?: boolean;
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
  invalid: "invalid-code",
  unavailable: "target-unavailable",
} as const;
/** moduleReason: the compiler did not type the specifier, but it names a captured file. */
const CAPTURED = "\0captured";
/** A global a failed file augments counts as a member set it changes. */
const GLOBAL_AUGMENTATION = true;
/** O2 for call links: overloads whose parameter types depend on a failed file (mutation switch). */
const FAILED_PARAMETER_OVERLOADS = true;
/** A `/// <reference path>` to a failed file is broken, not missing. */
const REFERENCE_PATHS = true;
/** At least one failed file: an `invalid-code` link cannot exist without one. */
type Causes = readonly [string, ...string[]];
const causesOf = (files: Iterable<string>): Causes | undefined => {
  const list = [...new Set(files)].sort();
  return list.length ? (list as unknown as Causes) : undefined;
};
/** The one constructor of a failed link: no targets, the cause required. */
const invalid = (
  cause: Causes,
  via: string,
  receiver?: ts.Expression,
): Targets => ({
  targets: [],
  reason: "invalid-code",
  cause: [...cause],
  via,
  ...(receiver ? { receiver } : {}),
});
/** Causes and the dependence that justifies them. */
interface Dependence {
  causes: Causes;
  via: string;
  /** Only through type arguments: members are found the same way. */
  weak?: boolean;
}
/** What a name lookup found: a symbol, or why there is none, and the member's receiver. */
interface Lookup {
  symbol?: ts.Symbol | undefined;
  /** The member name looked up, when there is a receiver. */
  name?: string | undefined;
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
  /**
   * T2, the one consumer of taint (taint.ts), before any checker answer is
   * accepted: a name whose binding resolves into a failed file fails; a
   * member reached through a tainted receiver (its symbols, its type, the
   * names along its chain) fails unless the answer is an own member of the
   * receiver's own declarations.
   */
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
    const taint = currentTaint();
    const named = found.symbol && namedCauses(taint, found.symbol);
    if (named) return invalid(named.causes, named.via, found.receiver);
    const result = resolveChecked(found, meaning);
    if (!found.receiver) return result;
    const failed = structural(taint, found.receiver, result);
    return failed ? invalid(failed.causes, failed.via, found.receiver) : result;
  }
  function resolveChecked(found: Lookup, meaning: Meaning): Targets {
    const receiver = found.receiver;
    if (found.reason || !found.symbol)
      return { targets: [], reason: found.reason ?? "no-symbol", receiver };
    const facts = new Map<string, TargetFact>();
    let external = 0;
    let local = 0;
    let viaAlias = false;
    let firstAlias: ts.Symbol | undefined;
    let declaredSomewhere = false;
    const declarations: ts.Node[] = [];
    const record = (declaration: ts.Declaration): boolean => {
      const target = fromVirtual(declaration.getSourceFile().fileName);
      if (target === undefined || !captured.has(target)) return false;
      const anchor = anchorOf(declaration);
      if (!anchor) return false;
      const key = keyOf(anchor);
      facts.set(`${target}\0${key}`, { file: target, key });
      declarations.push(declaration);
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
      else declaredSomewhere = true;
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
    if (!external && !local)
      return { targets, viaAlias, receiver, declarations };
    // An alias whose module did not resolve keeps that module's reason.
    const moduleFailure =
      external &&
      !targets.length &&
      ((firstAlias && bindingReason(firstAlias)) ||
        (receiver && receiverReason(receiver)));
    const result: Targets = {
      targets,
      reason: local ? "local" : moduleFailure || "external",
      viaAlias,
      receiver,
      ...(!targets.length && !declaredSomewhere ? { noAnswer: true } : {}),
    };
    return result;
  }
  // ----- failed (invalid) files: nothing in them is a target -----
  const currentTaint = (): Taint =>
    taintOf(
      {
        program,
        checker,
        captured,
        resolveModule: context.resolveModule,
        invalid: (at) => context.moduleKind(at) === "invalid",
        failedNames: context.failedNames,
      },
      context.anyFailed,
    );
  /**
   * The structural rule, for a member reached through a receiver (P-E,
   * default-deny; judge.ts): when any name in the receiver is tainted, the
   * receiver's type is derived by explicit cases only, and a receiver that
   * is FAILED fails the member. Then the member set (O1): a receiver whose
   * class or interface reaches a failed file through heritage, a merge or a
   * global augmentation keeps only a member declared directly in one of its
   * own declarations; any other answer, or none, fails.
   */
  function structural(
    taint: Taint,
    receiver: ts.Expression,
    result: Targets,
  ): Dependence | undefined {
    const through =
      receiverCauses(taint, receiver) ??
      namesInReceiver(taint, receiver) ??
      reachedFrom(taint, receiver);
    if (through) {
      let judged: Judged | undefined;
      try {
        judged = judgeOf(taint).expression(receiver);
      } catch (error) {
        if (!isLimit(error)) throw error;
      }
      if (judged?.k === "failed")
        return { causes: through.causes, via: `${through.via}; ${judged.why}` };
    }
    const membership: string[] = [];
    let owner = "";
    try {
      const type = checker.getTypeAtLocation(receiver);
      for (const part of type.isUnionOrIntersection() ? type.types : [type]) {
        const symbol = part.getSymbol();
        if (!symbol) continue;
        const causes = memberSetCauses(taint, symbol);
        if (causes.length) {
          membership.push(...causes);
          owner ||= symbol.name;
        }
      }
    } catch (error) {
      if (!isLimit(error)) throw error;
    }
    const files = causesOf(membership);
    if (!files) return undefined;
    if (
      result.targets.length &&
      !result.reason &&
      ownMembers(result.declarations ?? [], receiver)
    )
      return undefined;
    return {
      causes: files,
      via: result.targets.length
        ? `inherited or merged member of ${owner}, whose member set reaches the failed file`
        : `member of ${owner}, whose member set reaches the failed file`,
    };
  }
  /** The failed files a class's or interface's member set reaches. */
  function memberSetCauses(taint: Taint, symbol: ts.Symbol): string[] {
    return [
      ...causesOfSymbol(taint.all, symbol),
      // A global interface or namespace a failed file augments.
      ...(GLOBAL_AUGMENTATION && isGlobal(symbol)
        ? (context.failedNames.get(symbol.name) ?? [])
        : []),
    ];
  }
  /** Any name in the receiver, at any depth, that is tainted. */
  function namesInReceiver(
    taint: Taint,
    receiver: ts.Expression,
  ): Dependence | undefined {
    let found: Dependence | undefined;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        const causes: string[] = [];
        if (
          !symbol ||
          (!symbol.declarations?.length &&
            !(symbol.flags & ts.SymbolFlags.Alias))
        )
          causes.push(...(context.failedNames.get(node.text) ?? []));
        else
          for (const step of aliasChain(checker, symbol))
            causes.push(
              ...(taint.seeds.get(step) ?? []),
              ...causesOfSymbol(taint.all, step),
              ...causesOfSymbol(taint.weak, step),
            );
        const files = causesOf(causes);
        if (files)
          found = { causes: files, via: `name ${node.text} in the receiver` };
        return;
      }
      ts.forEachChild(node, visit);
    };
    try {
      visit(receiver);
    } catch (error) {
      if (!isLimit(error)) throw error;
    }
    return found;
  }
  /** The gate at any depth: the failed files the receiver reaches through its names. */
  function reachedFrom(
    taint: Taint,
    receiver: ts.Expression,
  ): Dependence | undefined {
    if (!taint.all.size && !taint.seeds.size) return undefined;
    let files: string[];
    try {
      files = judgeOf(taint).reaches(receiver);
    } catch (error) {
      if (!isLimit(error)) throw error;
      return undefined;
    }
    const causes = causesOf(files);
    return causes && { causes, via: "the receiver depends on the failed file" };
  }
  function judgeOf(taint: Taint): Judge {
    const known = judges.get(checker);
    if (known) return known;
    const judge = createJudge({
      checker,
      program,
      taint,
      failedNames: context.failedNames,
      failedModule: (specifier) => {
        if (!ts.isStringLiteralLike(specifier)) return undefined;
        const from = fromVirtual(specifier.getSourceFile().fileName);
        const module = from && context.resolveModule(specifier.text, from);
        return module && context.moduleKind(module) === "invalid"
          ? module
          : undefined;
      },
      memberSetTainted: (symbol) => memberSetCauses(taint, symbol).length > 0,
    });
    judges.set(checker, judge);
    return judge;
  }
  /** A global interface or namespace (lib, a script, or `declare global`). */
  function isGlobal(symbol: ts.Symbol): boolean {
    if (!(symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Module)))
      return false;
    return (symbol.declarations ?? []).some((declaration) => {
      const source = declaration.getSourceFile() as ts.SourceFile & {
        externalModuleIndicator?: unknown;
      };
      return (
        !source.externalModuleIndicator ||
        !!ts.findAncestor(
          declaration,
          (node) =>
            ts.isModuleDeclaration(node) &&
            (node.flags & ts.NodeFlags.GlobalAugmentation) !== 0,
        )
      );
    });
  }
  /** Causes when a name's binding (its alias chain) resolves into a failed file. */
  function namedCauses(
    taint: Taint,
    symbol: ts.Symbol,
  ): Dependence | undefined {
    if (!taint.all.size) return undefined;
    const causes: string[] = [];
    // Only bindings that resolve into a failed file (seeds, reached
    // through re-exports and `export =` by the alias chain): a binding of a
    // valid declaration whose type depends on a failed file names that
    // declaration correctly.
    for (const step of aliasChain(checker, symbol))
      causes.push(...(taint.seeds.get(step) ?? []));
    const found = causesOf(causes);
    return found && { causes: found, via: `binding ${symbol.name}` };
  }
  /**
   * Whether a call's result type can depend on its arguments: the callee is
   * generic or overloaded. A non-generic single signature gives the same
   * result whatever the arguments.
   */
  function resultDependsOnArguments(
    call: ts.CallExpression | ts.NewExpression,
  ): boolean {
    const type = checker.getTypeAtLocation(call.expression);
    const signatures = ts.isNewExpression(call)
      ? type.getConstructSignatures()
      : type.getCallSignatures();
    return (
      signatures.length > 1 ||
      signatures.some((signature) => !!signature.typeParameters?.length)
    );
  }
  /** Causes from the names in a call's arguments, with the first one as the justification. */
  function argumentCauses(
    taint: Taint,
    call: ts.CallExpression | ts.NewExpression,
    why: string,
  ): Dependence | undefined {
    const causes: string[] = [];
    let via: string | undefined;
    let strong = false;
    const names = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol)
          for (const step of aliasChain(checker, symbol)) {
            const strongCauses = causesOfSymbol(taint.all, step);
            const weakCauses = causesOfSymbol(taint.weak, step);
            if (strongCauses.length) strong = true;
            if (strongCauses.length || weakCauses.length) {
              causes.push(...strongCauses, ...weakCauses);
              via ??= `argument ${node.text} of ${why} ${call.expression.getText(file)}`;
            }
          }
      }
      ts.forEachChild(node, names);
    };
    for (const argument of call.arguments ?? []) names(argument);
    const found = causesOf(causes);
    return found && { causes: found, via: via!, weak: !strong };
  }
  /**
   * Causes of whatever a receiver depends on: the names along its chain, the
   * arguments of a call in it whose result can depend on them (a generic or
   * overloaded callee), and its type.
   */
  function receiverCauses(
    taint: Taint,
    receiver: ts.Expression,
  ): Dependence | undefined {
    const causes: string[] = [];
    const weakCauses: string[] = [];
    let via: string | undefined;
    let weakVia: string | undefined;
    // Weak taint counts only for the receiver's own value (its name, or the
    // callee producing it), not for receivers further in.
    let outer = true;
    const symbolCauses = (symbol: ts.Symbol | undefined, label: string) => {
      if (symbol)
        for (const step of aliasChain(checker, symbol)) {
          const found = causesOfSymbol(taint.all, step);
          if (found.length) {
            causes.push(...found);
            via ??= `${label} ${symbol.name}`;
          }
          const weakFound = outer ? causesOfSymbol(taint.weak, step) : [];
          if (weakFound.length) {
            weakCauses.push(...weakFound);
            weakVia ??= `${label} ${symbol.name} (type argument)`;
          }
        }
    };
    try {
      for (let node: ts.Node | undefined = receiver; node; ) {
        if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
          const symbol = checker.getSymbolAtLocation(node);
          symbolCauses(symbol, "receiver");
          // A name no declaration answers that a failed file declares (in a
          // type, the compiler answers with its "unknown" symbol).
          if (
            (!symbol ||
              (!symbol.declarations?.length &&
                !(symbol.flags & ts.SymbolFlags.Alias))) &&
            ts.isIdentifier(node)
          ) {
            const declared = context.failedNames.get(node.text) ?? [];
            if (declared.length) {
              causes.push(...declared);
              via ??= `name ${node.text} declared in the failed file`;
            }
          }
          node = undefined;
        } else if (
          ts.isAsExpression(node) ||
          ts.isTypeAssertionExpression(node)
        ) {
          // The asserted type replaces the expression's: its names decide.
          const names = (part: ts.Node): void => {
            if (ts.isIdentifier(part))
              symbolCauses(checker.getSymbolAtLocation(part), "asserted type");
            ts.forEachChild(part, names);
          };
          names(node.type);
          node = undefined;
        } else if (ts.isPropertyAccessExpression(node)) {
          const member = checker.getSymbolAtLocation(node.name);
          symbolCauses(member, "receiver");
          // The object's type arguments reach the member's value only when
          // its declared type refers to its owner's type parameters.
          if (!usesOwnerTypeParameters(checker, member)) outer = false;
          node = node.expression;
        } else if (ts.isQualifiedName(node)) {
          symbolCauses(checker.getSymbolAtLocation(node.right), "receiver");
          outer = false;
          node = node.left;
        } else if (
          ts.isElementAccessExpression(node) ||
          ts.isCallExpression(node) ||
          ts.isNewExpression(node) ||
          ts.isParenthesizedExpression(node) ||
          ts.isNonNullExpression(node) ||
          ts.isSatisfiesExpression(node) ||
          ts.isAwaitExpression(node)
        ) {
          if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            symbolCauses(
              checker.getSymbolAtLocation(node.expression),
              "callee",
            );
            // Only a generic or overloaded callee's result can depend on
            // the arguments (and only the outermost call's result is the
            // receiver's value).
            if (outer && resultDependsOnArguments(node)) {
              const argument = argumentCauses(
                taint,
                node,
                "generic or overloaded",
              );
              if (argument?.weak) {
                weakCauses.push(...argument.causes);
                weakVia ??= argument.via;
              } else if (argument) {
                causes.push(...argument.causes);
                via ??= argument.via;
              }
            }
          }
          node = node.expression;
        } else node = undefined;
      }
      const type = checker.getTypeAtLocation(receiver);
      for (const part of type.isUnionOrIntersection() ? type.types : [type]) {
        symbolCauses(part.getSymbol(), "type");
        symbolCauses(part.aliasSymbol, "type");
      }
    } catch (error) {
      if (!isLimit(error)) throw error;
    }
    const found = causesOf(causes);
    if (found) return { causes: found, via: via! };
    const weakFound = causesOf(weakCauses);
    return weakFound && { causes: weakFound, via: weakVia!, weak: true };
  }
  /**
   * Whether every target is declared directly in the receiver type's own
   * declarations: one object type (not a union or intersection), the target
   * a member of one of its declarations. An inherited or merged member, or
   * one found in another part, is not.
   */
  function ownMembers(
    declarations: readonly ts.Node[],
    receiver: ts.Expression,
  ): boolean {
    if (!declarations.length) return false;
    const type = checker.getTypeAtLocation(receiver);
    if (type.isUnionOrIntersection()) return false;
    const owners = new Set<ts.Node>(type.getSymbol()?.declarations ?? []);
    return declarations.every(
      (declaration) => !!declaration.parent && owners.has(declaration.parent),
    );
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
    // An unresolved bare name that a failed file of this program declares:
    // that file is why there is no answer (a global, a `declare global`,
    // a namespace). A member name through an untainted receiver never is.
    if (
      !found.targets.length &&
      !found.receiver &&
      (found.reason === "no-symbol" ||
        (found.reason === "external" && found.noAnswer)) &&
      ts.isIdentifier(at) &&
      !receiverOf(at)
    ) {
      const unread = causesOf(context.failedNames.get(at.text) ?? []);
      if (unread)
        found = invalid(unread, `name ${at.text} declared in the failed file`);
    }
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
      reason !== "invalid-code" &&
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
    if (reason === "invalid-code") {
      // Failed: nothing that names a likely answer, only the broken file.
      const cause = found.cause ?? [];
      if (!cause.length)
        throw Error("An invalid-code link must name its cause");
      facts.cause = {
        ...(cause.length === 1 ? { file: cause[0]! } : { files: [...cause] }),
        ...(found.via ? { via: found.via } : {}),
      };
    } else if (found.targets.length)
      facts.targets = found.targets.map((target) => ({ ...target }));
    if (reason) facts.reason = reason;
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
      ? kind === "invalid"
        ? // A file that cannot be read has failed: no target, its file the cause.
          invalid([file], "import of the failed file")
        : {
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
    const name =
      receiver && (ts.isIdentifier(node) || ts.isPrivateIdentifier(node))
        ? node.text
        : receiver && ts.isStringLiteralLike(node)
          ? node.text
          : undefined;
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
        // A destructured parameter has no variable declaration: only a
        // variable's initialiser can be a `require(...)`.
        const holder = ts.isVariableDeclaration(declaration)
          ? declaration
          : rootDeclaration(declaration);
        const init = holder?.initializer;
        const initRoot = init && rootOf(init);
        const initCall = init && unwrap(init);
        if (
          initCall &&
          ts.isCallExpression(initCall) &&
          requireForm(initCall) &&
          holder!.getSourceFile() === file
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
      if (reason) return { reason, receiver, name };
    }
    return symbol ? { symbol, receiver, name } : { receiver, name };
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
    call?: ts.CallExpression | ts.NewExpression,
  ) {
    const { at, symbol } = calleeTarget(callee);
    const expression = unwrap(callee);
    const name = isEntityChain(expression)
      ? expression.getText(file)
      : ts.isPropertyAccessExpression(expression)
        ? `(expression).${expression.name.text}`
        : "(expression)";
    let found = targetsOf(symbol, "call");
    // The callee decides a call; its arguments only pick between distinct
    // overload targets. With two or more, a tainted argument fails the link.
    if (call && found.targets.length > 1 && !found.reason) {
      const taint = currentTaint();
      const argument = argumentCauses(taint, call, "overloaded");
      if (argument) found = invalid(argument.causes, argument.via);
      else if (FAILED_PARAMETER_OVERLOADS && taint.all.size) {
        // O2: an overload whose parameter types depend on a failed file
        // accepts anything there (the error type): selection is untrustworthy.
        const signatures = (found.declarations ?? []).filter(
          (declaration): declaration is ts.SignatureDeclaration =>
            ts.isFunctionLike(declaration) &&
            !(declaration as { body?: ts.Node }).body,
        );
        const judge = judgeOf(taint);
        const files = causesOf(
          signatures.flatMap((signature) =>
            judge.signatureDependsOnFailed(signature),
          ),
        );
        if (files)
          found = invalid(
            files,
            "overloaded callee whose parameter types depend on the failed file",
          );
      }
    }
    link(owner, "calls", name, at, found, extra);
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
      const target = context.resolveModule(specifier.text, path);
      if (target !== undefined && context.moduleKind(target) === "unavailable")
        reason = "target-unavailable";
    }
    const module =
      specifier && ts.isStringLiteralLike(specifier)
        ? context.resolveModule(specifier.text, path)
        : undefined;
    let found: Targets =
      reason === "invalid-code" && module !== undefined
        ? invalid([module], "import of the failed file")
        : reason
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
            // A re-export from a failed module is a tainted binding (T2).
            reason && reason !== "invalid-code"
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
        const requireFacts: { [key: string]: Json } = { require: true };
        moduleLink(
          owner,
          node.arguments[0] as ts.StringLiteralLike,
          requireFacts,
        );
        requireBindings(owner, node, requireFacts);
      } else if (requireForm(node)) {
        // `(require)("x")`, `(0, require)("x")`, `module.require("x")`: the
        // loader, though the compiler does not type it; the edge is linked.
        const formFacts: { [key: string]: Json } = {
          require: true,
          calleeForm: requireForm(node)!,
        };
        moduleLink(owner, node.arguments[0] as ts.StringLiteralLike, formFacts);
        // Its bindings are real but the compiler does not type them.
        requireBindings(owner, node, formFacts);
      } else callLink(owner, node.expression, {}, node);
    } else if (ts.isNewExpression(node))
      callLink(owner, node.expression, { construct: true }, node);
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
      link(
        owner,
        kind,
        isEntityChain(expression) ? expression.getText(file) : "(expression)",
        node.expression,
        found,
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
      // A referenced file that exists but failed is broken, not missing.
      const failedTarget = [base, `${base}.ts`, `${base}.d.ts`, `${base}.tsx`]
        .map((name) => name.slice(1))
        .find(
          (path) =>
            captured.has(path) && context.moduleKind(path) === "invalid",
        );
      found = target
        ? { targets: [{ file: target.fileName.slice(1), key: keyOf(target) }] }
        : REFERENCE_PATHS && failedTarget !== undefined
          ? invalid([failedTarget], "reference to the failed file")
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
        ...(found.cause?.length
          ? { cause: { file: found.cause[0]!, via: found.via! } }
          : {}),
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
