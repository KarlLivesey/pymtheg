// SPDX-License-Identifier: MIT
import { posix } from "node:path";
import ts from "typescript";
import {
  competingTestNames,
  globalTypeAvailability,
  isTestFramework,
  isTestGlobal,
  nodeCanDeclare,
  nodeGlobalCall,
  nodeGlobalTarget,
  nodeMemberTarget,
  nodeReceiverTypes,
  runtimeHashbang,
  testGlobalTargets,
  testSetupFramework,
} from "./global-types.js";
import type {
  Diagnostic,
  Json,
  LibraryTarget,
  LinkDraft,
  ParseResult,
  SymbolDraft,
} from "../../types.js";
import {
  fromVirtual,
  LIB_ROOT,
  matchesPathAlias,
  toVirtual,
} from "./project.js";
import type { entryProvenance, UnbuiltEntry } from "./workspace-entries.js";
import {
  bundledLibraryUnit,
  importedTarget,
  libraryKey,
  libraryReader,
  packageUnit,
  storableName,
} from "./library.js";
import {
  aliasChain,
  causesOfSymbol,
  usesOwnerTypeParameters,
  taintOf,
  type Taint,
} from "./taint.js";
import { createJudge, type Judge, type Judged } from "./judge.js";
import {
  objectProducers,
  propertyWrite,
  propertyWriteKeys,
  staticName,
} from "./object-producers.js";
import {
  NAMES,
  restoreNames,
  type FreshNames,
  type Renamed,
} from "./rename.js";

/** Per-file context for module-system names (see rename.ts). */
export interface RenameContext {
  fresh: FreshNames;
  explicitTypes: boolean;
  /** Present when this file's compiler text was renamed. */
  renamed?: Renamed | undefined;
  /** Resolves a module specifier from a file to a captured path, if any. */
  resolveModule: (specifier: string, from: string) => string | undefined;
  hasDenoImports: boolean;
  selectSpecifier: (specifier: string, from: string) => string | undefined;
  workspaceReason: (
    specifier: string,
    from: string,
    lookups: readonly string[],
    includeInstalled?: boolean,
  ) => string | undefined;
  workspaceBoundaryKnown: (from: string) => boolean;
  unbuilt?: ReturnType<typeof entryProvenance>;
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
const programNodeEvidence = new WeakMap<ts.Program, boolean>();
const programTestSetups = new WeakMap<
  ts.Program,
  { units: ReadonlySet<string>; competitors: ReadonlySet<string> }
>();
const producerReaders = new WeakMap<
  ts.Program,
  ReturnType<typeof objectProducers>
>();
import {
  anchorOf,
  rootDeclaration,
  containerOf,
  enclosingAnchor,
  identityOf,
  isEntityName,
  bindingSpecifier,
  isCommonJsRequire,
  isJsFile,
  isLocalCallable,
  isScopedDeclaration,
  keyOf,
  kindOf,
  nameOf,
  objectMember,
  rangeOf,
  unwrap,
} from "./symbols.js";

// These syntax classifiers are exported by the pinned compiler alongside its
// checker. Assignment targets include updates, destructuring and for-in/of.
const syntax = ts as typeof ts & {
  getAssignmentTargetKind(node: ts.Node): number;
  isInExpressionContext(node: ts.Node): boolean;
};

function insideWith(node: ts.Node): boolean {
  return !!ts.findAncestor(
    node,
    (at) =>
      !!at.parent &&
      ts.isWithStatement(at.parent) &&
      at.parent.statement === at,
  );
}

/** A link target recorded by analysis: a symbol key inside a captured file. */
export interface TargetFact {
  file: string;
  key: string;
}
/** What a usage can mean: a call needs something callable, a type position a type. */
type Meaning = "call" | "value" | "type" | "any";
interface Targets {
  targets: TargetFact[];
  unbuiltEntry?: UnbuiltEntry;
  viaSpecifier?: ts.StringLiteralLike;
  libraryFacts?: LibraryTarget[];
  /** Written outside identity independent of missing checker declarations. */
  lexicalLibrary?: boolean;
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
  competingTypes?: readonly string[];
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
  at?: ts.Node;
  construct?: boolean;
  memberCall?: boolean;
  typeQuery?: boolean;
  recoveredMember?: boolean;
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

const relativeSpecifier = (value: string) => /^\.\.?(\/|$)/.test(value);
const requiredProperty = (element: ts.BindingElement) =>
  element.dotDotDotToken || element.initializer
    ? undefined
    : staticName(element.propertyName ?? element.name);

export function extractFile(
  file: ts.SourceFile,
  checker: ts.TypeChecker,
  program: ts.Program,
  captured: ReadonlySet<string>,
  diagnostics: Diagnostic[],
  data: { [key: string]: Json },
  incompleteConfig: boolean,
  context: RenameContext,
  library: ReturnType<typeof libraryReader>,
): ParseResult {
  const uncertainAt = new Set(context.renamed?.uncertain ?? []);
  const uncertainReason = (offset: number) =>
    context.renamed?.reasons[offset] ?? "dynamic-scope";
  const freshExportNames = new Set(Object.values(context.fresh.local));
  const path = file.fileName.slice(1);
  const importer = library.forImporter(path);
  const globals = globalTypeAvailability(
    program,
    library.isNodeTypeFile,
    (name, source) => {
      const from = fromVirtual(source) ?? path;
      return (
        context.selectSpecifier(name, from) === name &&
        library.forImporter(from).typePackageUnredirected(name)
      );
    },
  );
  let missingNode =
    !globals.hasNode &&
    (globals.expectsNode ||
      (!context.explicitTypes && library.expectsNode(path)));
  const importers = new WeakMap<ts.SourceFile, typeof importer>();
  const importerOf = (node: ts.Node) => {
    const source = node.getSourceFile();
    if (source === file) return importer;
    let reader = importers.get(source);
    if (!reader) {
      reader = library.forImporter(fromVirtual(source.fileName) ?? path);
      importers.set(source, reader);
    }
    return reader;
  };
  const symbols: SymbolDraft[] = [];
  const links: LinkDraft[] = [];
  const keys = new Set<string>();
  const lexicalReferences = new Map<string, Set<ts.Node>>();
  const scopedNames = new Set<string>();
  const propertyWrites: NonNullable<ReturnType<typeof propertyWrite>>[] = [];
  const collectScopedNames = (node: ts.Node): void => {
    if (isScopedDeclaration(node)) {
      const name = (node as ts.NamedDeclaration).name;
      if (name && ts.isIdentifier(name)) scopedNames.add(name.text);
    }
    if (
      node.kind === ts.SyntaxKind.PropertyAccessExpression ||
      node.kind === ts.SyntaxKind.ElementAccessExpression ||
      node.kind === ts.SyntaxKind.CallExpression
    ) {
      const written = propertyWrite(node, syntax.getAssignmentTargetKind);
      if (written) propertyWrites.push(written);
    }
    ts.forEachChild(node, collectScopedNames);
  };
  collectScopedNames(file);
  const moduleKey = keyOf(file);
  const range = (node: ts.Node) => ({
    start: node.getStart(file),
    end: node.end,
  });

  let writtenMembers: Map<ts.Symbol, Set<string | undefined>> | undefined;
  function memberBinding(identifier: ts.Identifier): ts.Symbol | undefined {
    let symbol = checker.getSymbolAtLocation(identifier);
    // Explicit const aliases in this file can name the same module object.
    for (let depth = 0; symbol && depth < 16; depth++) {
      const declaration = symbol.valueDeclaration;
      if (
        !declaration ||
        declaration.getSourceFile() !== file ||
        !ts.isVariableDeclaration(declaration) ||
        !(declaration.parent.flags & ts.NodeFlags.Const) ||
        !declaration.initializer
      )
        break;
      const value = unwrap(declaration.initializer);
      if (!ts.isIdentifier(value)) break;
      const next = checker.getSymbolAtLocation(value);
      if (!next || next === symbol) break;
      symbol = next;
    }
    return symbol;
  }
  function memberWritten(receiver: ts.Expression, member: string): boolean {
    if (!propertyWrites.length) return false;
    const value = unwrap(receiver);
    if (!ts.isIdentifier(value)) return false;
    if (!writtenMembers) {
      const byBinding = new Map<ts.Symbol, Set<string | undefined>>();
      for (const write of propertyWrites)
        for (const expression of write.receivers) {
          const binding = unwrap(expression);
          if (!ts.isIdentifier(binding)) continue;
          const symbol = memberBinding(binding);
          if (!symbol) continue;
          let members = byBinding.get(symbol);
          if (!members) {
            members = new Set();
            byBinding.set(symbol, members);
          }
          for (const key of propertyWriteKeys(write)) members.add(key);
        }
      writtenMembers = byBinding;
    }
    const symbol = memberBinding(value);
    const keys = symbol && writtenMembers.get(symbol);
    return !!keys && (keys.has(member) || keys.has(undefined));
  }

  // The checker recurses once per inference step and can exhaust the stack.
  // After an overflow its internal state is not trustworthy (a retried lookup
  // may silently answer "no symbol"), so an overflow aborts this extraction
  // with CheckerLimit; the caller rebuilds the program and retries with that
  // node in `skip`, whose links are then `compiler-limit` without asking.
  let limitHit = false;
  let limited = false;
  let mutations: { writes: Set<ts.Symbol>; eval: boolean } | undefined;
  function localMutations() {
    if (mutations) return mutations;
    const result = { writes: new Set<ts.Symbol>(), eval: false };
    const visitWrite = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        if (node.text === "eval") {
          let outer: ts.Node = node;
          while (ts.isParenthesizedExpression(outer.parent))
            outer = outer.parent;
          if (
            ts.isCallExpression(outer.parent) &&
            outer.parent.expression === outer
          )
            result.eval = true;
        }
        if (
          scopedNames.has(node.text) &&
          syntax.getAssignmentTargetKind(node)
        ) {
          const symbol = ts.isShorthandPropertyAssignment(node.parent)
            ? checker.getShorthandAssignmentValueSymbol(node.parent)
            : checker.getSymbolAtLocation(node);
          if (symbol) result.writes.add(symbol);
        }
      }
      ts.forEachChild(node, visitWrite);
    };
    visitWrite(file);
    mutations = result;
    return result;
  }

  function provenLocalCall(
    declaration: ts.Declaration,
    symbol: ts.Symbol,
  ): boolean {
    if (declaration.getSourceFile() !== file) return false;
    const name = symbol.getName();
    const outer = checker.resolveName(
      name,
      file,
      ts.SymbolFlags.Alias | ts.SymbolFlags.Value,
      true,
    );
    if (outer && outer !== symbol && bindingSpecifier(outer)) return false;
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.parent.flags & ts.NodeFlags.Const
    )
      return true;
    const { writes, eval: mayEval } = localMutations();
    return !writes.has(symbol) && !mayEval;
  }
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
    let result = resolveChecked(found, meaning);
    if (
      !result.targets.length &&
      !result.libraryFacts?.length &&
      (result.noAnswer ||
        result.reason === "no-symbol" ||
        (result.reason === "external" &&
          (found.receiver !== undefined ||
            (result.viaAlias &&
              context.anyFailed &&
              globals.hasInstalledTypes))) ||
        result.reason === "external-package" ||
        result.reason === "any-receiver" ||
        result.reason === "untyped-require" ||
        result.reason === "local")
    ) {
      const fact = missingBinding(found, meaning);
      if (fact)
        result = {
          targets: [],
          libraryFacts: fact,
          lexicalLibrary: true,
          receiver: found.receiver,
        };
      else if (!incompleteConfig && !context.anyFailed) {
        if (found.receiver) {
          const imported = typedReceiverUnit(found);
          if (imported)
            result = {
              targets: [],
              receiver: found.receiver,
              libraryFacts: imported,
            };
        } else if (meaning === "call" && result.reason === "local") {
          const alias = selectedMemberAlias(found);
          if (alias) result = alias;
        }
      }
    }
    const ambient = ambientGlobal(found, result, meaning);
    if (ambient) return ambient;
    const outside = result.libraryFacts?.[0];
    if (
      !result.lexicalLibrary &&
      !result.targets.length &&
      result.libraryFacts?.length === 1 &&
      (outside?.ecosystem === "npm" || outside?.ecosystem === "node")
    ) {
      const alternatives = missingBinding(found, meaning, 0, true);
      if (alternatives && alternatives.length > 1)
        result = {
          ...result,
          libraryFacts: alternatives,
          lexicalLibrary: true,
        };
    }
    if (!found.receiver) return result;
    const failed = structural(taint, found.receiver, result);
    if (failed) return invalid(failed.causes, failed.via, found.receiver);
    if (
      !result.lexicalLibrary &&
      result.libraryFacts?.length &&
      found.name !== undefined &&
      memberWritten(found.receiver, found.name)
    ) {
      const fact =
        !result.targets.length &&
        missingBinding({ ...found, name: undefined }, meaning, 0, true);
      return fact
        ? {
            targets: [],
            libraryFacts: fact,
            lexicalLibrary: true,
            receiver: found.receiver,
          }
        : {
            targets: result.targets,
            reason: "library-member-written",
            receiver: found.receiver,
          };
    }
    return result;
  }
  function ambientGlobal(
    found: Lookup,
    result: Targets,
    meaning: Meaning,
  ): Targets | undefined {
    const { at, symbol } = found;
    if (
      !at ||
      !ts.isIdentifier(at) ||
      found.receiver ||
      (meaning !== "call" && !found.typeQuery) ||
      incompleteConfig ||
      context.anyFailed ||
      result.targets.length ||
      result.lexicalLibrary ||
      result.receiver
    )
      return undefined;
    const existing = result.libraryFacts ?? [];
    // A local binding or an explicit import wins. An already captured
    // ambient framework can coexist with another requested type package.
    if (
      symbol &&
      (!symbol.declarations?.length ||
        !existing.length ||
        existing.some(
          (target) =>
            target.ecosystem !== "npm" ||
            target.symbol !== at.text ||
            !isTestFramework(target.unit),
        ) ||
        symbol.flags & ts.SymbolFlags.Alias)
    )
      return undefined;
    if (!isTestGlobal(at.text)) {
      const target =
        !symbol && meaning === "call" && globals.expectsNode
          ? nodeGlobalCall(at.text, found.construct === true)
          : undefined;
      if (
        target &&
        !globals.hasNode &&
        !globals.otherRuntime &&
        !program.getCompilerOptions().typeRoots &&
        context.selectSpecifier("node", path) === "node" &&
        !globals.otherGlobals.has(at.text) &&
        !insideWith(at) &&
        importer.typePackageUnredirected("@types/node")
      )
        return { targets: [], libraryFacts: [target] };
      return undefined;
    }
    if (found.construct || insideWith(at)) return undefined;
    let setups = programTestSetups.get(program);
    if (!setups) {
      const units = new Set(globals.missingTestFrameworks);
      const competitors = new Set(globals.competingTestRequests);
      for (const source of program.getSourceFiles()) {
        const sourcePath = fromVirtual(source.fileName);
        if (
          sourcePath === undefined ||
          (source.isDeclarationFile &&
            sourcePath.split("/").includes("node_modules"))
        )
          continue;
        for (const statement of source.statements) {
          if (
            !ts.isImportDeclaration(statement) ||
            statement.importClause ||
            !ts.isStringLiteralLike(statement.moduleSpecifier)
          )
            continue;
          const specifier = statement.moduleSpecifier;
          const provider = testSetupFramework(specifier.text);
          const competitor = competingTestNames(specifier.text);
          const unit =
            provider ?? (competitor && packageUnit(specifier.text)?.unit);
          if (!unit) continue;
          if (globals.hasInstalledTypes) {
            const resolved = specifierResolution(specifier).path;
            if (resolved && program.getSourceFile(toVirtual(resolved)))
              continue;
          }
          const routes = missingUnits(specifier, competitor !== undefined);
          if (
            routes.length === 1 &&
            routes[0]!.ecosystem === "npm" &&
            (routes[0]!.unit === unit || routes[0]!.unit === specifier.text)
          ) {
            if (provider) units.add(provider);
            else competitors.add(specifier.text);
          }
        }
      }
      programTestSetups.set(program, (setups = { units, competitors }));
    }
    const alternatives = new Map(
      existing.map((target) => [target.unit, target]),
    );
    const installedBinding = symbol?.declarations?.some((declaration) =>
      importer.installedUnit(declaration.getSourceFile()),
    );
    if (existing.length && !installedBinding)
      for (const target of capturedTestGlobals(at.text))
        alternatives.set(target.unit, target);
    for (const target of testGlobalTargets(
      at.text,
      setups.units,
      meaning === "call",
    ))
      if (!alternatives.has(target.unit)) alternatives.set(target.unit, target);
    if (alternatives.size && setups.competitors.size) {
      const competing = [...setups.competitors].filter(
        (request) =>
          competingTestNames(request)?.includes(at.text) &&
          (request !== "@testing-library/jest-dom" ||
            !alternatives.has("jest")),
      );
      if (competing.length)
        return {
          targets: [],
          reason: "competing-test-globals",
          competingTypes: competing.sort(),
        };
    }
    if (alternatives.size > existing.length)
      return { targets: [], libraryFacts: [...alternatives.values()] };
    return undefined;
  }
  let capturedFrameworkGlobals: Map<string, LibraryTarget[]> | undefined;
  function capturedTestGlobals(name: string): readonly LibraryTarget[] {
    // Duplicate globals from two captured type packages may remain separate
    // compiler symbols, with an unqualified lookup selecting only the first.
    if (!capturedFrameworkGlobals) {
      const globals = new Map<string, LibraryTarget[]>();
      for (const source of program.getSourceFiles()) {
        const unit = importer.declarationUnit(source);
        if (unit?.ecosystem !== "npm" || !isTestFramework(unit.unit)) continue;
        const record = (declaration: ts.Declaration) => {
          const name = (declaration as ts.NamedDeclaration).name;
          if (!name || !ts.isIdentifier(name) || !isTestGlobal(name.text))
            return;
          const symbol = checker.getSymbolAtLocation(name);
          if (!symbol?.declarations?.includes(declaration)) return;
          const target = importer.targetOf(declaration, unit, checker);
          if (!target) return;
          const list = globals.get(name.text) ?? [];
          list.push(target);
          globals.set(name.text, list);
        };
        const visit = (node: ts.Statement) => {
          if (ts.isFunctionDeclaration(node)) record(node);
          else if (ts.isVariableStatement(node))
            node.declarationList.declarations.forEach(record);
        };
        for (const statement of source.statements) {
          if (
            ts.isModuleDeclaration(statement) &&
            statement.flags & ts.NodeFlags.GlobalAugmentation &&
            statement.body &&
            ts.isModuleBlock(statement.body)
          )
            statement.body.statements.forEach(visit);
          else if (!ts.isExternalModule(source)) visit(statement);
        }
      }
      capturedFrameworkGlobals = globals;
    }
    return capturedFrameworkGlobals.get(name) ?? [];
  }
  /** The selected property in a same-file, immutable function alias. */
  function selectedMemberAlias(found: Lookup): Targets | undefined {
    const declaration = found.symbol?.valueDeclaration;
    if (
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      declaration.getSourceFile() !== file ||
      !(declaration.parent.flags & ts.NodeFlags.Const) ||
      declaration.type ||
      !declaration.initializer ||
      !found.at ||
      insideWith(found.at)
    )
      return undefined;
    let value = declaration.initializer;
    while (ts.isParenthesizedExpression(value)) value = value.expression;
    if (!ts.isPropertyAccessExpression(value) || ts.isOptionalChain(value))
      return undefined;
    const alias = resolveTargets(
      { ...lookup(value.name), at: value.name },
      "call",
    );
    return alias.libraryFacts?.length &&
      !alias.targets.length &&
      (alias.lexicalLibrary || namedLibraryObject(value.expression))
      ? alias
      : undefined;
  }
  /** A namespace binding or bundled global supplies a fixed library object. */
  function namedLibraryObject(expression: ts.Expression): boolean {
    if (!ts.isIdentifier(expression)) return false;
    const declarations = checker.getSymbolAtLocation(expression)?.declarations;
    return (
      !!declarations?.length &&
      declarations.every(
        (declaration) =>
          ts.isNamespaceImport(declaration) ||
          declaration.getSourceFile().fileName.startsWith(LIB_ROOT + "/"),
      )
    );
  }
  /** An unavailable imported type establishes only the receiver's unit. */
  function typedReceiverUnit(found: Lookup): LibraryTarget[] | undefined {
    if (found.name === undefined || found.symbol?.declarations?.length)
      return undefined;
    const receiver = found.receiver!;
    let expression = receiver;
    while (ts.isParenthesizedExpression(expression))
      expression = expression.expression;
    let annotation: ts.TypeNode | undefined;
    if (
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression)
    )
      annotation = expression.type;
    else if (ts.isCallExpression(expression)) {
      const declaration = checker.getResolvedSignature(expression)?.declaration;
      // A selected overload does not prove the only return annotation.
      const name = declaration && (declaration as ts.NamedDeclaration).name;
      if (
        declaration?.type &&
        ts.isTypeNode(declaration.type) &&
        name &&
        checker.getSymbolAtLocation(name)?.declarations?.length === 1
      )
        annotation = declaration.type;
    } else {
      const declaration =
        checker.getSymbolAtLocation(expression)?.valueDeclaration;
      if (
        declaration &&
        (ts.isParameter(declaration) ||
          ts.isVariableDeclaration(declaration) ||
          ts.isPropertyDeclaration(declaration) ||
          ts.isPropertySignature(declaration))
      )
        annotation = declaration.type;
    }
    if (!annotation || !ts.isTypeReferenceNode(annotation)) return undefined;
    const type = checker.getTypeAtLocation(receiver);
    if (!(type.flags & ts.TypeFlags.Any) || type === checker.getAnyType())
      return undefined;
    for (
      let depth = 0;
      depth < 8 && ts.isTypeReferenceNode(annotation);
      depth++
    ) {
      const name = annotation.typeName;
      const at = ts.isQualifiedName(name) ? name.right : name;
      const query = lookup(at);
      const units = missingBinding({ ...query, at }, "type");
      if (units?.every(({ symbol }) => symbol !== undefined))
        return units.map(({ symbol: _symbol, ...unit }) => ({
          ...unit,
          evidence: "import-path",
        }));
      const symbol = query.symbol;
      if (!symbol || symbol === LIMIT) return undefined;
      const target =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const declaration =
        target.declarations?.length === 1 && target.declarations[0];
      if (!declaration || !ts.isTypeAliasDeclaration(declaration))
        return undefined;
      annotation = declaration.type;
    }
    return undefined;
  }
  function resolveChecked(found: Lookup, meaning: Meaning): Targets {
    const receiver = found.receiver;
    if (found.reason || !found.symbol)
      return { targets: [], reason: found.reason ?? "no-symbol", receiver };
    const facts = new Map<string, TargetFact>();
    let libraryFacts:
      | Map<string | ts.Symbol | ts.Declaration, LibraryTarget>
      | undefined;
    let external = 0;
    let local = 0;
    let viaAlias = false;
    let firstAlias: ts.Symbol | undefined;
    let declaredSomewhere = false;
    let missingGlobalTypes = false;
    let installedType = false;
    let nodeReceivers: ReturnType<typeof nodeReceiverTypes> | undefined;
    let verifyObjectProducers = false;
    const declarations: ts.Declaration[] = [];
    const usableLocalCall = (
      anchor: ts.Node,
      declaration: ts.Declaration,
      symbol: ts.Symbol,
    ) =>
      !(found.at && insideWith(found.at)) &&
      (!ts.isClassDeclaration(anchor) || found.construct) &&
      !(
        ts.isVariableDeclaration(anchor) &&
        found.construct &&
        ts.isArrowFunction(unwrap(anchor.initializer!))
      ) &&
      provenLocalCall(declaration, symbol);
    const record = (
      declaration: ts.Declaration,
      symbol: ts.Symbol,
      shorthandMember = false,
    ): boolean => {
      const target = fromVirtual(declaration.getSourceFile().fileName);
      if (target === undefined || !captured.has(target)) return false;
      const anchor = anchorOf(declaration);
      const member =
        !anchor &&
        (shorthandMember || !ts.isShorthandPropertyAssignment(declaration)) &&
        (meaning !== "call" ||
          (found.memberCall &&
            ts.isObjectLiteralExpression(declaration.parent) &&
            !declaration.getSourceFile().isDeclarationFile &&
            !!found.at &&
            checker.getSignaturesOfType(
              checker.getNonNullableType(checker.getTypeAtLocation(found.at)),
              found.construct
                ? ts.SignatureKind.Construct
                : ts.SignatureKind.Call,
            ).length > 0))
          ? objectMember(declaration)
          : undefined;
      if (!anchor && !member) return false;
      if (anchor && meaning === "call") {
        if (
          ts.isEnumDeclaration(anchor) &&
          !ts.isSourceFile(anchor.parent) &&
          !ts.isModuleBlock(anchor.parent)
        )
          return false;
        if (
          isLocalCallable(anchor) &&
          (found.receiver || !usableLocalCall(anchor, declaration, symbol))
        )
          return false;
      }
      const key = anchor ? keyOf(anchor) : member!.key;
      if (
        (!anchor || found.recoveredMember) &&
        ts.isObjectLiteralExpression(declaration.parent)
      )
        verifyObjectProducers = true;
      facts.set(`${target}\0${key}`, { file: target, key });
      declarations.push(declaration);
      return true;
    };
    const visit = (value: ts.Symbol, depth: number) => {
      let current = value;
      if (current.flags & ts.SymbolFlags.Alias) {
        viaAlias = true;
        firstAlias ??= current;
        const specifier = context.hasDenoImports && bindingSpecifier(current);
        if (
          specifier &&
          ts.isStringLiteralLike(specifier) &&
          unverifiedSpecifier(specifier)
        ) {
          external++;
          return;
        }
        current = checker.getAliasedSymbol(current);
      }
      let declarations = current.declarations ?? [];
      if (globals.hasInstalledTypes && firstAlias && declarations.length > 1) {
        const isAugmentation = (declaration: ts.Declaration) =>
          ts.isModuleDeclaration(declaration) &&
          ts.isStringLiteral(declaration.name) &&
          ts.isSourceFile(declaration.parent) &&
          ts.isExternalModule(declaration.parent);
        const specifier = bindingSpecifier(firstAlias);
        if (
          specifier &&
          ts.isStringLiteralLike(specifier) &&
          declarations.some(isAugmentation)
        ) {
          const entry = specifierResolution(specifier).path;
          const source = entry && program.getSourceFile(toVirtual(entry));
          const unit = source && importer.installedUnit(source);
          if (
            unit &&
            declarations.some(
              (declaration) =>
                !isAugmentation(declaration) &&
                importer.installedUnit(declaration.getSourceFile()) === unit,
            )
          ) {
            // A module augmentation wrapper is not the declaration of an
            // export of the module, including its synthetic default.
            declarations = declarations.filter(
              (declaration) => !isAugmentation(declaration),
            );
          }
        }
      }
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
      if (
        meaning === "type" &&
        declarations.length > 1 &&
        declarations.every(ts.isInterfaceDeclaration) &&
        declarations.some((declaration) => declaration.members.length > 0)
      ) {
        // Some packages declare empty compatibility interfaces for projects
        // without DOM types. A stub whose bases are already declared by the
        // native DOM interface adds no members or constraints to the merge.
        const nativeBases = new Set<ts.Symbol>();
        for (const declaration of globals.hasInstalledTypes
          ? declarations
          : []) {
          if (
            !declaration
              .getSourceFile()
              .fileName.startsWith(`${LIB_ROOT}/lib.dom.`)
          )
            continue;
          for (const clause of declaration.heritageClauses ?? [])
            for (const type of clause.types) {
              const base =
                !type.typeArguments?.length &&
                checker.getSymbolAtLocation(type.expression);
              if (base) nativeBases.add(base);
            }
        }
        declarations = declarations.filter(
          (declaration) =>
            declaration.members.length > 0 ||
            declaration.typeParameters?.length ||
            importer.installedUnit(declaration.getSourceFile())?.ecosystem !==
              "npm" ||
            declaration.heritageClauses?.some((clause) =>
              clause.types.some((type) => {
                const base =
                  !type.typeArguments?.length &&
                  checker.getSymbolAtLocation(type.expression);
                return !base || !nativeBases.has(base);
              }),
            ),
        );
      }
      if (
        globals.hasInstalledTypes &&
        meaning === "call" &&
        found.at?.kind === ts.SyntaxKind.SuperKeyword &&
        declarations.length > 1 &&
        declarations.every(ts.isInterfaceDeclaration)
      ) {
        // A constructor interface may be augmented with static members
        // without contributing a declaration of the constructor call.
        const constructors = declarations.filter((declaration) =>
          declaration.members.some(ts.isConstructSignatureDeclaration),
        );
        if (constructors.length) declarations = constructors;
      }
      if (!declarations.length) external++;
      else declaredSomewhere = true;
      for (const declaration of declarations) {
        if (ts.isShorthandPropertyAssignment(declaration) && depth < 8) {
          const shorthand =
            checker.getShorthandAssignmentValueSymbol(declaration);
          if (shorthand) {
            const value = shorthand.valueDeclaration;
            // Preserve existing shorthand links to named functions. For a
            // proven scoped callable the receiver guard excludes that route;
            // the independently declared property is the member target.
            if (
              found.memberCall &&
              value &&
              shorthand.declarations?.length === 1 &&
              isLocalCallable(value) &&
              usableLocalCall(value, value, shorthand) &&
              record(declaration, current, true)
            )
              continue;
            visit(shorthand, depth + 1);
            continue;
          }
        }
        const source = declaration.getSourceFile();
        const unit = importer.declarationUnit(source);
        if (unit) {
          const namespace =
            globals.hasInstalledTypes &&
            !receiver &&
            meaning !== "call" &&
            declarations.length === 1 &&
            ts.isSourceFile(declaration) &&
            firstAlias &&
            installedNamespaceBinding(firstAlias, source);
          const proved =
            !incompleteConfig &&
            (namespace ||
              (!context.anyFailed &&
                (importer.targetOf(declaration, unit, checker) ??
                  (globals.hasInstalledTypes &&
                    receiver &&
                    importer.installedUnit(source) === unit &&
                    importer.returnedMemberTarget(
                      declaration,
                      unit,
                      checker,
                    )))));
          if (proved) {
            if (meaning === "type" && importer.installedUnit(source))
              installedType = true;
            if (
              (missingNode || globals.otherGlobals.size > 0) &&
              source.fileName.startsWith(LIB_ROOT + "/") &&
              proved.symbol
            ) {
              const dot = proved.symbol.indexOf(".");
              const owner =
                dot < 0 ? proved.symbol : proved.symbol.slice(0, dot);
              if (globals.otherGlobals.has(owner)) {
                missingGlobalTypes = true;
                continue;
              }
              if (missingNode) {
                const member = found.name;
                const receivers =
                  receiver && member !== undefined && proved.ecosystem === "dom"
                    ? (nodeReceivers ??= nodeReceiverTypes(checker, receiver))
                    : undefined;
                const owners = receivers?.filter(
                  ({ type, name }) =>
                    name === owner ||
                    checker
                      .getPropertyOfType(type, member!)
                      ?.declarations?.includes(declaration),
                );
                if (owners?.length) {
                  for (const { name } of owners) {
                    const node = nodeMemberTarget(name, member!, proved.symbol);
                    if (node)
                      (libraryFacts ??= new Map()).set(libraryKey(node), node);
                    else missingGlobalTypes = true;
                  }
                } else if (
                  nodeCanDeclare(owner) &&
                  !(meaning === "type" && proved.symbol === "CryptoKey")
                ) {
                  const node = nodeGlobalTarget(proved.symbol);
                  if (node)
                    (libraryFacts ??= new Map()).set(libraryKey(node), node);
                  else missingGlobalTypes = true;
                }
              }
            }
            // A selected declaration can arrive through another package or a
            // typed return. The use site's manifest does not pin that route.
            (libraryFacts ??= new Map()).set(
              importer.targetKey(proved),
              proved,
            );
          } else if (inCheckout(declaration)) {
            if (!record(declaration, current)) local++;
          } else external++;
          continue;
        }
        const target = fromVirtual(source.fileName);
        if (target === undefined || !captured.has(target)) {
          external++;
          continue;
        }
        if (!record(declaration, current)) local++;
      }
    };
    visit(found.symbol, 0);
    if (
      !external &&
      !local &&
      !installedType &&
      libraryFacts?.size &&
      receiver &&
      found.name !== undefined
    ) {
      // A transient union symbol can omit an arm answered by an index
      // signature or by no declaration. Recheck each member before accepting
      // a complete set containing an outside target.
      const type = checker.getTypeAtLocation(receiver);
      const access =
        found.at && ts.isElementAccessExpression(found.at)
          ? found.at
          : found.at?.parent;
      const optional =
        access &&
        (ts.isPropertyAccessExpression(access) ||
          ts.isElementAccessExpression(access)) &&
        ts.isOptionalChain(access);
      const checked = optional ? checker.getNonNullableType(type) : type;
      if (checked.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) external++;
      else if (checked.isUnion()) {
        for (const part of checked.types) {
          const member = checker.getPropertyOfType(part, found.name);
          if (member?.declarations?.length) visit(member, 0);
          else external++;
        }
      }
    }
    if (!external && !local && verifyObjectProducers) {
      let producers = producerReaders.get(program);
      if (!producers) {
        producers = objectProducers(
          program,
          checker,
          syntax.getAssignmentTargetKind,
        );
        producerReaders.set(program, producers);
      }
      const members =
        receiver && found.name !== undefined
          ? producers(receiver, found.name)
          : undefined;
      const verified =
        members &&
        declarations.every((declaration) => members.includes(declaration));
      if (verified) {
        for (const member of members) {
          if (declarations.includes(member)) continue;
          const name = (member as ts.NamedDeclaration).name;
          const symbol = name && checker.getSymbolAtLocation(name);
          if (!symbol || !record(member, symbol, true)) {
            local++;
            break;
          }
        }
      }
      if (!verified || local)
        return {
          targets: [],
          reason:
            members && members.length > 1
              ? "multiple-object-producers"
              : "object-producer-unverified",
          receiver,
        };
    }
    const targets = [...facts.values()];
    const libraries = libraryFacts && [...libraryFacts.values()];
    if (
      libraries &&
      libraries.length > 1 &&
      new Set(libraries.map(libraryKey)).size !== libraries.length
    )
      return { targets: [], reason: "ambiguous-library-declaration", receiver };
    if (!external && !local && !missingGlobalTypes) {
      const specifier =
        context.unbuilt && firstAlias && bindingSpecifier(firstAlias);
      const viaSpecifier =
        specifier && ts.isStringLiteralLike(specifier) ? specifier : undefined;
      const unbuiltEntry =
        viaSpecifier && context.unbuilt?.forSpecifier(viaSpecifier);
      return {
        targets,
        viaAlias,
        receiver,
        declarations,
        ...(libraries && { libraryFacts: libraries }),
        ...(unbuiltEntry && { unbuiltEntry }),
        ...(viaSpecifier && { viaSpecifier }),
      };
    }
    // An alias whose module did not resolve keeps that module's reason.
    const moduleFailure =
      external &&
      !targets.length &&
      ((firstAlias && bindingReason(firstAlias)) ||
        (receiver && receiverReason(receiver)));
    const result: Targets = {
      targets,
      reason: local
        ? "local"
        : missingGlobalTypes
          ? "missing-global-types"
          : moduleFailure || "external",
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
    const reason = specifier && bindingModuleReason(specifier);
    if (reason || !globals.hasInstalledTypes) return reason;
    for (const step of aliasChain(checker, symbol).slice(1)) {
      const reexport = bindingSpecifier(step);
      const missing = reexport && bindingModuleReason(reexport);
      if (
        missing === "workspace-entry-unavailable" ||
        missing === "workspace-build-output-missing"
      )
        return missing;
    }
    return undefined;
  }
  /** A binding's reason from its module: a captured file the compiler did not type. */
  function bindingModuleReason(specifier: ts.Expression): string | undefined {
    const reason = moduleReason(specifier);
    if (reason !== CAPTURED) return reason;
    const file = specifierResolution(specifier as ts.StringLiteralLike).path!;
    return KIND_REASON[context.moduleKind(file)];
  }

  const outsideUnits = new Map<
    ts.StringLiteralLike,
    ReturnType<typeof importer.importUnits>
  >();
  function missingUnits(
    specifier: ts.Expression | undefined,
    declared = false,
  ) {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return [];
    if (!declared && outsideUnits.has(specifier))
      return outsideUnits.get(specifier)!;
    const units = outsideRoutes(specifier, declared);
    if (!declared && !limited) outsideUnits.set(specifier, units);
    return units;
  }

  function outsideRoutes(
    specifier: ts.StringLiteralLike,
    declared: boolean,
    includeInstalledWorkspaces = true,
  ) {
    const selection = selectedSpecifier(specifier);
    if (!selection || (incompleteConfig && !selection.startsWith("node:")))
      return [];
    const reader = importerOf(specifier);
    const reason = includeInstalledWorkspaces
      ? moduleReason(specifier)
      : readModuleReason(specifier, false);
    if (reason === "external-package") {
      const routes = reader.importUnits(selection);
      return routes.some((unit) => reader.localPackage(unit)) ? [] : routes;
    }
    if (reason === undefined && globals.hasInstalledTypes) {
      // A mapped member or incomplete program may leave its owner open.
      // A literal binding still names the module when its routes agree.
      const installed = installedRoutes(specifier, selection);
      const written = reader.importUnits(selection);
      if (installed?.length === 1 && written.length === 1) {
        const actual = installed[0]!;
        const expected = written[0]!;
        if (
          actual.ecosystem === expected.ecosystem &&
          actual.unit === expected.unit
        )
          return [{ ...expected, ...(actual.pin && { pin: actual.pin }) }];
      }
    }
    if (declared && reason === undefined && declaredModuleFact(specifier))
      return reader.importUnits(selection);
    return [];
  }

  function importFact(
    specifier: ts.Expression | undefined,
    symbol?: string,
    declared = false,
  ): Targets | undefined {
    if (!specifier) return undefined;
    const units = missingUnits(specifier, declared);
    const targets = units.map((unit) => writtenLibrary(unit, symbol));
    return targets.length && targets.every((target) => target !== undefined)
      ? { targets: [], libraryFacts: targets, lexicalLibrary: true }
      : undefined;
  }

  function writtenLibrary(
    unit: NonNullable<ReturnType<typeof packageUnit>>,
    symbol?: string,
  ): LibraryTarget | undefined {
    const target = importedTarget(unit, symbol);
    if (
      !storableName(target.unit) ||
      (target.symbol !== undefined && !storableName(target.symbol))
    )
      return undefined;
    return target;
  }

  function installedNamespaceBinding(
    alias: ts.Symbol,
    declaration: ts.SourceFile,
  ) {
    const binding = alias.declarations?.length === 1 && alias.declarations[0];
    if (!binding || !ts.isImportSpecifier(binding)) return undefined;
    const specifier = bindingSpecifier(alias);
    if (!specifier || !ts.isStringLiteralLike(specifier)) return undefined;
    const path = specifierResolution(specifier).path;
    const entry = path && program.getSourceFile(toVirtual(path));
    const unit = entry && importer.installedUnit(entry);
    const selected = selectedSpecifier(specifier);
    const written = selected && packageUnit(selected);
    if (
      !unit ||
      !written ||
      unit.unit !== written.unit ||
      unit !== importer.installedUnit(declaration)
    )
      return undefined;
    // tsc represents a named namespace export as its source file. The
    // selected package entry supplies the public name of that binding.
    return writtenLibrary(
      { ...unit, ...(written.subpath && { subpath: written.subpath }) },
      (binding.propertyName ?? binding.name).text,
    );
  }

  function declaredModuleFact(
    specifier: ts.Expression | undefined,
  ): Targets | undefined {
    if (
      !specifier ||
      !ts.isStringLiteralLike(specifier) ||
      incompleteConfig ||
      limited
    )
      return undefined;
    if (context.anyFailed)
      return globals.hasInstalledTypes ? importFact(specifier) : undefined;
    const declarations = checker.getSymbolAtLocation(specifier)?.declarations;
    if (
      !declarations?.length ||
      !declarations.every((declaration) =>
        importerOf(specifier).declarationUnit(declaration.getSourceFile()),
      )
    )
      return undefined;
    const selection = selectedSpecifier(specifier);
    const installed = selection && installedRoutes(specifier, selection);
    if (installed) {
      const targets = new Map<string, LibraryTarget>();
      for (const unit of installed) {
        const target = writtenLibrary(unit);
        if (!target) return undefined;
        targets.set(libraryKey(target), target);
      }
      return {
        targets: [],
        libraryFacts: [...targets.values()],
        lexicalLibrary: true,
      };
    }
    const units = selection ? importerOf(specifier).importUnits(selection) : [];
    const targets = units.map((unit) => writtenLibrary(unit));
    return targets.length && targets.every((target) => target !== undefined)
      ? { targets: [], libraryFacts: targets }
      : undefined;
  }

  function installedRoutes(specifier: ts.StringLiteralLike, selection: string) {
    if (!globals.hasInstalledTypes) return undefined;
    const resolved = specifierResolution(specifier).path;
    const source = resolved && program.getSourceFile(toVirtual(resolved));
    if (source) {
      const unit = importerOf(specifier).installedUnit(source);
      // A module augmentation does not change which file the import opens.
      return unit ? [unit] : undefined;
    }
    const declarations = checker.getSymbolAtLocation(specifier)?.declarations;
    if (!declarations?.length) return undefined;
    const builtin = packageUnit(selection);
    const units = new Map<
      string,
      NonNullable<ReturnType<typeof packageUnit>>
    >();
    for (const declaration of declarations) {
      const installed = importerOf(specifier).installedUnit(
        declaration.getSourceFile(),
      );
      if (!installed) return undefined;
      const unit =
        installed.ecosystem === "node" && builtin?.ecosystem === "node"
          ? { ...builtin, ...(installed.pin && { pin: installed.pin }) }
          : installed;
      units.set(
        JSON.stringify([unit.ecosystem, unit.unit, unit.pin?.version]),
        unit,
      );
    }
    return [...units.values()];
  }

  /** Follow a lexical import or immutable bindings back to a literal loader. */
  function missingBinding(
    found: Lookup,
    meaning: Meaning,
    depth = 0,
    declared = false,
  ): LibraryTarget[] | undefined {
    if (depth >= 16 || (found.at && insideWith(found.at))) return undefined;
    const transparent = (expression: ts.Expression) => {
      while (
        ts.isParenthesizedExpression(expression) ||
        ts.isNonNullExpression(expression)
      )
        expression = expression.expression;
      return expression;
    };
    const requireSpecifier = (expression: ts.Expression | undefined) => {
      const call = expression && transparent(expression);
      if (
        !call ||
        !ts.isCallExpression(call) ||
        call.getSourceFile() !== file ||
        (!isCommonJsRequire(call) && !requireForm(call)) ||
        uncertainAt.has(call.expression.getStart(file))
      )
        return undefined;
      return call.arguments[0];
    };
    let present = found.symbol;
    if (found.receiver) {
      if (
        found.name !== undefined &&
        present &&
        present !== LIMIT &&
        present.flags & ts.SymbolFlags.Alias &&
        !memberWritten(found.receiver, found.name)
      ) {
        const selected = missingBinding(
          { ...found, receiver: undefined },
          meaning,
          depth + 1,
          declared,
        );
        if (selected) return selected;
      }
      const base = transparent(found.receiver);
      if (!ts.isIdentifier(base)) {
        const specifier = requireSpecifier(base);
        return importFact(specifier, found.name, declared)?.libraryFacts;
      }
      present = symbolOf(base);
      if (
        present &&
        present !== LIMIT &&
        present.declarations?.length !== 1 &&
        propertyWrites.length
      )
        present = memberBinding(base);
    }
    if (!present || present === LIMIT) return undefined;
    const chain =
      present.flags & ts.SymbolFlags.Alias
        ? aliasChain(checker, present)
        : [present];
    for (const binding of chain) {
      if (binding.declarations?.length !== 1) continue;
      const declaration = binding.declarations[0]!;
      let specifier: ts.Expression | undefined;
      let exported: string | undefined;
      let moduleObject = false;
      if (
        binding.flags & ts.SymbolFlags.Alias &&
        !ts.isVariableDeclaration(declaration) &&
        !ts.isBindingElement(declaration)
      ) {
        if ((meaning === "value" && !found.typeQuery) || meaning === "call") {
          const clause = ts.findAncestor(declaration, ts.isImportClause);
          if (
            clause?.isTypeOnly ||
            ts.findAncestor(declaration, ts.isExportDeclaration)?.isTypeOnly ||
            ((ts.isImportSpecifier(declaration) ||
              ts.isExportSpecifier(declaration) ||
              ts.isImportEqualsDeclaration(declaration)) &&
              declaration.isTypeOnly)
          )
            return undefined;
        }
        specifier = bindingSpecifier(binding);
        if (
          ts.isImportSpecifier(declaration) ||
          ts.isExportSpecifier(declaration)
        )
          exported = (declaration.propertyName ?? declaration.name).text;
        else if (ts.isImportClause(declaration)) exported = "default";
        else if (
          ts.isNamespaceImport(declaration) ||
          ts.isNamespaceExport(declaration) ||
          ts.isImportEqualsDeclaration(declaration)
        )
          moduleObject = true;
        else continue;
      } else if (
        ts.isVariableDeclaration(declaration) &&
        !declaration.type &&
        declaration.parent.flags & ts.NodeFlags.Const
      ) {
        specifier = requireSpecifier(declaration.initializer);
        moduleObject = true;
        const value =
          declaration.initializer && transparent(declaration.initializer);
        if (value && ts.isIdentifier(value)) {
          const target = missingBinding(
            {
              ...found,
              symbol: found.receiver ? undefined : symbolOf(value),
              receiver: found.receiver ? value : undefined,
            },
            meaning,
            depth + 1,
            declared,
          );
          if (target) return target;
        }
        if (!specifier && value && ts.isPropertyAccessExpression(value)) {
          specifier = requireSpecifier(value.expression);
          exported = value.name.text;
          moduleObject = false;
        }
      } else if (ts.isBindingElement(declaration)) {
        const owner = rootDeclaration(declaration);
        if (!owner || !(owner.parent.flags & ts.NodeFlags.Const)) continue;
        let hasDefault = false;
        for (
          let element: ts.Node = declaration;
          ts.isBindingElement(element);
          element = element.parent.parent
        )
          hasDefault ||= element.initializer !== undefined;
        if (hasDefault) continue;
        specifier = requireSpecifier(owner.initializer);
        if (
          owner === declaration.parent.parent &&
          ts.isObjectBindingPattern(declaration.parent)
        )
          exported = requiredProperty(declaration);
      }
      const units = missingUnits(specifier, declared);
      if (!units.length || !specifier) continue;
      // Node's ESM wrapper exposes the CommonJS export object as the default.
      // For an arbitrary imported value the selected member has no proven name.
      const member =
        found.receiver &&
        found.name !== undefined &&
        !memberWritten(found.receiver, found.name)
          ? found.name
          : undefined;
      let selected = found.symbol;
      const installedFallback =
        globals.hasInstalledTypes && moduleReason(specifier) === undefined;
      if (
        installedFallback &&
        selected &&
        selected.flags & ts.SymbolFlags.Alias
      )
        selected = checker.getAliasedSymbol(selected);
      const mayName =
        !installedFallback ||
        selected?.declarations?.some((declaration) =>
          importer.installedUnit(declaration.getSourceFile()),
        );
      const targets = units.map((unit) =>
        writtenLibrary(
          unit,
          !mayName
            ? undefined
            : found.receiver
              ? moduleObject ||
                (unit.ecosystem === "node" && exported === "default")
                ? member
                : undefined
              : exported,
        ),
      );
      if (targets.every((target) => target !== undefined)) return targets;
    }
    return undefined;
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
    if (
      !found.reason &&
      found.declarations?.some((declaration) =>
        context.unbuilt?.isStripped(path, declaration, found.viaSpecifier),
      )
    )
      found = { targets: [], reason: "workspace-build-output-missing" };
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
      insideWith(at)
    )
      reason = "dynamic-scope";
    if (
      incompleteConfig &&
      !found.lexicalLibrary &&
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
    if (found.libraryFacts?.length && !reason) {
      if (insideWith(at)) reason = "dynamic-scope";
      else
        facts.libraryFacts = found.libraryFacts.map((target) => ({
          ...target,
        }));
    }
    if (reason) facts.reason = reason;
    if (!reason && found.targets.length) {
      const entry =
        found.unbuiltEntry ??
        context.unbuilt?.forTarget(path, found.targets[0]!.file);
      if (
        entry &&
        (found.unbuiltEntry ||
          found.targets.every(
            (target) => context.unbuilt?.forTarget(path, target.file) === entry,
          ))
      )
        facts.unbuiltEntry = { ...entry };
    }
    if (found.competingTypes) facts.competingTypes = [...found.competingTypes];
    links.push({
      sourceKey,
      kind,
      targetName: clip(targetName) || "(expression)",
      range: range(at),
      data: facts,
    });
  }
  const paths = Object.keys(program.getCompilerOptions().paths ?? {});
  const selectedSpecifiers = new Map<
    ts.StringLiteralLike,
    string | undefined
  >();
  function selectedSpecifier(
    specifier: ts.StringLiteralLike,
  ): string | undefined {
    if (!context.hasDenoImports) return specifier.text;
    if (!selectedSpecifiers.has(specifier))
      selectedSpecifiers.set(
        specifier,
        context.selectSpecifier(
          specifier.text,
          fromVirtual(specifier.getSourceFile().fileName) ?? path,
        ),
      );
    return selectedSpecifiers.get(specifier);
  }
  function unverifiedSpecifier(specifier: ts.StringLiteralLike): boolean {
    const selection = selectedSpecifier(specifier);
    return selection === undefined || /^https?:/i.test(selection);
  }
  const specifierResolutions = new Map<
    ts.StringLiteralLike,
    {
      path: string | undefined;
      lookups: readonly string[];
      extensionFallback: boolean;
    }
  >();
  function specifierResolution(specifier: ts.StringLiteralLike) {
    const previous = specifierResolutions.get(specifier);
    if (previous) return previous;
    // Reuse the compiler's result in the actual import/require mode. The
    // snapshot-only fallback is for forms the compiler did not resolve at all.
    const resolution = (
      program as ts.Program & {
        getResolvedModuleFromModuleSpecifier(
          specifier: ts.StringLiteralLike,
          source: ts.SourceFile,
        ):
          | (ts.ResolvedModuleWithFailedLookupLocations & {
              failedLookupLocations?: readonly string[];
            })
          | undefined;
      }
    ).getResolvedModuleFromModuleSpecifier(
      specifier,
      specifier.getSourceFile(),
    );
    const resolved = resolution?.resolvedModule?.resolvedFileName;
    const from = fromVirtual(specifier.getSourceFile().fileName) ?? path;
    const selected = selectedSpecifier(specifier);
    const fallback =
      selected !== undefined &&
      !resolved &&
      (!resolution || relativeSpecifier(selected))
        ? context.resolveModule(specifier.text, from)
        : undefined;
    const result = {
      path: resolved
        ? fromVirtual(program.getSourceFile(resolved)?.fileName ?? resolved)
        : fallback,
      lookups: resolution?.failedLookupLocations ?? [],
      extensionFallback: !!(resolution && fallback),
    };
    specifierResolutions.set(specifier, result);
    return result;
  }
  /** Why a module specifier does not resolve, or undefined when it does. */
  const moduleReasons = new Map<ts.StringLiteralLike, string>();
  function moduleReason(specifier: ts.Expression): string | undefined {
    if (!ts.isStringLiteralLike(specifier)) return "computed-specifier";
    if (limited) return "compiler-limit";
    let reason = moduleReasons.get(specifier);
    if (reason === undefined) {
      reason = readModuleReason(specifier) ?? "";
      moduleReasons.set(specifier, reason);
    }
    return reason || undefined;
  }
  function readModuleReason(
    specifier: ts.StringLiteralLike,
    includeInstalledWorkspaces = true,
  ): string | undefined {
    const text = selectedSpecifier(specifier);
    if (text === undefined || /^https?:/i.test(text))
      return "deno-import-unverified";
    if (checker.getSymbolAtLocation(specifier)) return undefined;
    // A captured file the compiler did not type here (a script, or a require
    // form the compiler does not recognise): the edge to that file is known.
    const { path: resolved, lookups } = specifierResolution(specifier);
    if (resolved !== undefined && captured.has(resolved)) return CAPTURED;
    if (relativeSpecifier(text) || text.startsWith("/"))
      return "missing-module";
    const aliased =
      text.startsWith("#") ||
      (text === specifier.text && matchesPathAlias(text, paths));
    const importer = fromVirtual(specifier.getSourceFile().fileName) ?? path;
    if (aliased) return "unresolved-alias";
    const workspace = context.workspaceReason(
      text,
      importer,
      lookups,
      includeInstalledWorkspaces,
    );
    if (workspace) return workspace;
    if (!context.workspaceBoundaryKnown(importer)) {
      const unit = packageUnit(text);
      if (unit && unit.ecosystem !== "node")
        return "workspace-manifest-unreadable";
    }
    return "external-package";
  }
  function moduleLink(
    owner: string,
    specifier: ts.StringLiteralLike,
    extra: { [key: string]: Json },
  ) {
    const selection = limited ? undefined : specifierResolution(specifier);
    // An entry edge identifies the file selected by module resolution. A
    // merged declaration symbol may include augmentations in other files.
    const file =
      selection?.path && captured.has(selection.path)
        ? selection.path
        : undefined;
    const reason = file ? undefined : moduleReason(specifier);
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
        ? (importFact(specifier) ?? { targets: [], reason })
        : (declaredModuleFact(specifier) ??
          targetsOf(checker.getSymbolAtLocation(specifier), "any"));
    // A target file whose analysis failed has no facts to link to.
    const reached = found.targets[0]?.file;
    const final: Targets =
      !found.reason &&
      reached !== undefined &&
      context.moduleKind(reached) === "unavailable"
        ? { ...found, reason: "target-unavailable" }
        : found;
    const unbuiltEntry = context.unbuilt?.forSpecifier(specifier);
    link(
      owner,
      "imports",
      specifier.text,
      specifier,
      unbuiltEntry ? { ...final, unbuiltEntry } : final,
      {
        specifier: specifier.text,
        ...(selection?.extensionFallback ? { extensionFallback: true } : {}),
        // `notAModule` means one thing: the target file has no imports/exports.
        ...(file && context.moduleKind(file) === "script"
          ? { notAModule: true }
          : {}),
        ...extra,
      },
    );
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
              { symbol: requiredProperty(element) },
            );
    }
  }
  /** A supported indirect loader call form, by name; undefined otherwise. */
  function requireForm(
    call: ts.CallExpression,
    source = file,
  ): string | undefined {
    if (!isJsFile(source) || call.arguments.length !== 1) return undefined;
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
          return { reason: "untyped-require", receiver, name };
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

  function inCheckout(declaration: ts.Declaration): boolean {
    const path = fromVirtual(declaration.getSourceFile().fileName);
    return path !== undefined && captured.has(path);
  }

  /** Only literal member lookups can identify a named declaration. */
  function memberCallLookup(
    access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    key:
      | ts.Identifier
      | ts.PrivateIdentifier
      | ts.StringLiteralLike
      | ts.NumericLiteral,
  ): Lookup {
    // Numeric keys had no checker lookup on main. In particular, keep the
    // existing outcome when the newly queried declaration is outside.
    const numeric = ts.isNumericLiteral(key);
    const previous = numeric ? {} : lookup(key);
    if (
      previous.reason ||
      previous.symbol === LIMIT ||
      (!previous.symbol && insideWith(key))
    )
      return { ...previous, name: key.text };
    const receiver = access.expression;
    const literal = ts.isElementAccessExpression(access);
    let symbol = numeric ? symbolOf(key) : previous.symbol;
    if (symbol === LIMIT) return { symbol };
    if (numeric && !symbol?.declarations?.length) symbol = undefined;
    if (symbol?.declarations?.length && !symbol.declarations.some(inCheckout))
      return previous;
    const member = (selected: ts.Symbol): Lookup => ({
      symbol: selected,
      receiver,
      name: key.text,
      memberCall: true,
      recoveredMember: selected !== previous.symbol,
    });
    if (
      symbol &&
      !(symbol.flags & ts.SymbolFlags.Transient) &&
      !symbol.declarations?.some(ts.isIndexSignatureDeclaration)
    )
      return member(symbol);
    let type = checker.getTypeAtLocation(receiver);
    if (
      access.questionDotToken ||
      (ts.isOptionalChain(receiver) &&
        type.isUnion() &&
        type.types.every(
          (part) =>
            !(part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) ||
            // The checker uses a distinct undefined marker for a short
            // circuit in an earlier segment of the same chain.
            ((part.flags & ts.TypeFlags.Undefined) !== 0 &&
              part !== checker.getUndefinedType()),
        ))
    )
      type = checker.getNonNullableType(type);
    if (!symbol && literal && ts.isOptionalChain(access)) {
      const member = checker.getPropertyOfType(type, key.text);
      if (
        member?.declarations?.length &&
        member.declarations.every(
          (declaration) =>
            inCheckout(declaration) ||
            importer.declarationUnit(declaration.getSourceFile()),
        )
      )
        symbol = member;
    }
    if (!symbol) {
      if (type === checker.getAnyType())
        return { reason: "any-receiver", receiver, name: key.text };
      if (type.flags & ts.TypeFlags.Unknown)
        return { reason: "unknown-receiver", receiver };
    }
    if (
      symbol?.declarations?.some(ts.isIndexSignatureDeclaration) ||
      (!ts.isPrivateIdentifier(key) &&
        (!symbol || type.isUnion()) &&
        (type.isUnion() ? type.types : [type]).some((part) => {
          // A union property symbol can omit an arm supplied only by an
          // index signature. That arm has no named declaration to link.
          if (symbol && checker.getPropertyOfType(part, key.text)) return false;
          const name = checker.getStringLiteralType(key.text);
          const number = Number(key.text);
          const numericName =
            String(number) === key.text
              ? checker.getNumberLiteralType(number)
              : undefined;
          return checker
            .getIndexInfosOfType(part)
            .some(
              ({ declaration, keyType }) =>
                (symbol?.declarations?.length ||
                  !declaration ||
                  inCheckout(declaration)) &&
                (checker.isTypeAssignableTo(name, keyType) ||
                  (numericName &&
                    checker.isTypeAssignableTo(numericName, keyType))),
            );
        }))
    )
      return { reason: "index-signature", receiver };
    return symbol ? member(symbol) : previous;
  }
  function calleeTarget(callee: ts.Expression): {
    at: ts.Node;
    symbol: Lookup;
  } {
    const expression = unwrap(callee);
    if (ts.isPropertyAccessExpression(expression))
      return {
        at: expression.name,
        symbol: memberCallLookup(expression, expression.name),
      };
    if (ts.isElementAccessExpression(expression)) {
      const key = expression.argumentExpression;
      return {
        at: expression,
        symbol:
          ts.isStringLiteralLike(key) || ts.isNumericLiteral(key)
            ? memberCallLookup(expression, key)
            : computedLibraryMember(expression),
      };
    }
    if (
      ts.isIdentifier(expression) ||
      expression.kind === ts.SyntaxKind.SuperKeyword
    )
      return { at: expression, symbol: { symbol: symbolOf(expression) } };
    return { at: callee, symbol: {} };
  }
  /** A computed selector can still be one checker-proven library property. */
  function computedLibraryMember(access: ts.ElementAccessExpression): Lookup {
    const key = access.argumentExpression;
    if (
      limited ||
      incompleteConfig ||
      context.anyFailed ||
      !ts.isIdentifier(key) ||
      insideWith(key) ||
      !namedLibraryObject(access.expression)
    )
      return {};
    const declaration = checker.getSymbolAtLocation(key)?.valueDeclaration;
    if (
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !(declaration.parent.flags & ts.NodeFlags.Const) ||
      !declaration.initializer ||
      (!ts.isStringLiteralLike(declaration.initializer) &&
        !ts.isNumericLiteral(declaration.initializer))
    )
      return {};
    const receiver = access.expression;
    const type = checker.getTypeAtLocation(receiver);
    const name = declaration.initializer.text;
    const symbol = checker.getPropertyOfType(
      ts.isOptionalChain(access) ? checker.getNonNullableType(type) : type,
      name,
    );
    return symbol?.declarations?.some((declaration) =>
      importer.declarationUnit(declaration.getSourceFile()),
    )
      ? { symbol, receiver, name }
      : {};
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
    let found = targetsOf(
      { ...symbol, at, construct: extra.construct === true },
      "call",
    );
    // The callee decides a call; its arguments only pick between distinct
    // overload targets. With two or more, a tainted argument fails the link.
    if (
      call &&
      found.targets.length + (found.libraryFacts?.length ?? 0) > 1 &&
      !found.reason
    ) {
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
    destructured?: { symbol: string | undefined },
  ) {
    // Bindings from a module that does not resolve share its reason.
    let reason = specifier && bindingModuleReason(specifier);
    if (!reason && specifier && ts.isStringLiteralLike(specifier)) {
      const target = specifierResolution(specifier).path;
      if (target !== undefined && context.moduleKind(target) === "unavailable")
        reason = "target-unavailable";
    }
    const module =
      specifier && ts.isStringLiteralLike(specifier)
        ? specifierResolution(specifier).path
        : undefined;
    let found: Targets =
      reason === "invalid-code" && module !== undefined
        ? invalid([module], "import of the failed file")
        : reason
          ? (importFact(
              specifier,
              destructured
                ? destructured.symbol
                : importedName === "*"
                  ? undefined
                  : importedName,
            ) ?? { targets: [], reason })
          : (importedName === "*" && declaredModuleFact(specifier)) ||
            targetsOf(symbolOf(name), extra.typeOnly ? "type" : "any");
    // An export NAME `require`/`module`/`exports` is renamed in JS files only;
    // between a JS and a TS file (or a CommonJS property) the names differ.
    if (
      !reason &&
      !found.targets.length &&
      !found.libraryFacts?.length &&
      (freshExportNames.has(importedName) ||
        (NAMES as readonly string[]).includes(importedName))
    )
      found = { ...found, reason: "renamed-export" };
    link(owner, kind, importedName, at, found, extra);
  }

  function handle(node: ts.Node, owner: string): string | null {
    const anchor = anchorOf(node);
    if (!anchor) {
      const member = objectMember(node);
      if (member) symbols.push(member);
    }
    if (anchor === node) {
      const key = keyOf(node);
      if (keys.has(key)) throw Error(`Duplicate symbol key ${key} in ${path}`);
      keys.add(key);
      const symbolData: { [key: string]: Json } = {};
      if (ts.isSourceFile(node)) {
        symbolData.declarationFile = node.isDeclarationFile;
        symbolData.javascript = isJsFile(node);
      }
      if (isScopedDeclaration(node)) symbolData.scoped = true;
      const identity = identityOf(node);
      symbols.push({
        key,
        name: nameOf(node),
        kind: kindOf(node),
        identity,
        range: rangeOf(node),
        ...(Object.keys(symbolData).length ? { data: symbolData } : {}),
      });
      const container = containerOf(node);
      if (container) {
        const containerKey = keyOf(container);
        links.push({
          sourceKey: containerKey,
          kind: "contains",
          targetName: identity,
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
              ? (importFact(
                  specifier,
                  (element.propertyName ?? element.name).text,
                ) ?? { targets: [], reason })
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
        const checked = targetsOf(symbolOf(at), "any");
        // The checker keeps the declaration for a qualified import alias
        // even when the namespace's outside module has no declarations.
        const lexical =
          checked.reason === "external" && ts.isQualifiedName(reference)
            ? targetsOf(lookup(at), "any")
            : undefined;
        link(
          owner,
          "references",
          reference.getText(file),
          reference,
          lexical?.lexicalLibrary ? lexical : checked,
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
          targetsOf({ ...lookup(at), at }, "call"),
          { jsx: true },
        );
      }
    } else if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName;
      const at = ts.isQualifiedName(name) ? name.right : name;
      const lookupResult = lookup(at);
      let found = targetsOf(lookupResult, "type");
      const declarations = lookupResult.symbol?.declarations;
      const parameter =
        declarations?.length === 1 ? declarations[0] : undefined;
      const extra: { [key: string]: Json } = {};
      if (
        found.reason === "local" &&
        !found.targets.length &&
        parameter &&
        ts.isTypeParameterDeclaration(parameter) &&
        parameter.getSourceFile() === file
      ) {
        found = {
          targets: [{ file: path, key: keyOf(enclosingAnchor(parameter)) }],
        };
        extra.localBinding = {
          name: restoreNames(parameter.name.text, context.fresh),
          ...range(parameter.name),
        };
      }
      link(owner, "references", name.getText(file), name, found, extra);
    } else if (ts.isTypeQueryNode(node)) {
      const name = node.exprName;
      const at = ts.isQualifiedName(name) ? name.right : name;
      const lookupResult = lookup(at);
      let found = targetsOf({ ...lookupResult, at, typeQuery: true }, "value");
      const extra: { [key: string]: Json } = { typeof: true };
      const declaration = lookupResult.symbol?.valueDeclaration;
      if (
        found.reason === "local" &&
        !found.targets.length &&
        ts.isIdentifier(name) &&
        declaration &&
        declaration.getSourceFile() === file &&
        lookupResult.symbol?.declarations?.length === 1 &&
        (ts.isVariableDeclaration(declaration) ||
          ts.isParameter(declaration) ||
          ts.isBindingElement(declaration)) &&
        ts.isIdentifier(declaration.name) &&
        !anchorOf(declaration) &&
        !insideWith(name)
      ) {
        extra.localBinding = {
          name: restoreNames(declaration.name.text, context.fresh),
          ...range(declaration.name),
        };
        found = {
          targets: [{ file: path, key: keyOf(enclosingAnchor(declaration)) }],
        };
      }
      link(owner, "references", name.getText(file), name, found, extra);
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
      const query = lookup(at);
      const type =
        ts.isInterfaceDeclaration(node.parent.parent) || kind === "implements";
      let found = targetsOf(query, type ? "type" : "value");
      if (
        !type &&
        file.isDeclarationFile &&
        (found.reason === "external-package" || found.reason === "no-symbol")
      ) {
        // An ambient heritage clause may use a type-only import.
        const lexical = targetsOf(query, "type");
        if (lexical.lexicalLibrary) found = lexical;
      }
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
    } else if (
      ts.isIdentifier(node) &&
      scopedNames.has(node.text) &&
      !limited
    ) {
      const parent = node.parent;
      const shorthand =
        ts.isShorthandPropertyAssignment(parent) && parent.name === node;
      if (
        (shorthand || syntax.isInExpressionContext(node)) &&
        !(ts.isPropertyAccessExpression(parent) && parent.name === node) &&
        !(
          (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
          parent.expression === node
        ) &&
        !(ts.isTaggedTemplateExpression(parent) && parent.tag === node) &&
        !insideWith(node)
      ) {
        const symbol = shorthand
          ? checker.getShorthandAssignmentValueSymbol(parent)
          : symbolOf(node);
        const declaration = symbol?.valueDeclaration;
        const local = declaration && anchorOf(declaration);
        if (
          local &&
          local.getSourceFile() === file &&
          isScopedDeclaration(local)
        ) {
          let seen = lexicalReferences.get(owner);
          if (!seen) lexicalReferences.set(owner, (seen = new Set()));
          if (!seen.has(local)) {
            seen.add(local);
            link(
              owner,
              "references",
              node.text,
              node,
              targetsOf(symbol, "value"),
            );
          }
        }
      }
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

  if (
    !globals.hasNode &&
    !globals.expectsNode &&
    !incompleteConfig &&
    !context.anyFailed
  ) {
    const probe = (
      source: ts.SourceFile,
      node: ts.Node,
      read: () => boolean,
    ) => {
      const key = `node-probe:${source.fileName}:${node.kind}@${node.getStart(source)}`;
      if (context.skip.has(key)) return false;
      try {
        return read();
      } catch (error) {
        if (isLimit(error)) throw new CheckerLimit(key);
        throw error;
      }
    };
    let expected = programNodeEvidence.get(program);
    if (expected === undefined) {
      const sources = program.getSourceFiles().filter((source) => {
        const path = fromVirtual(source.fileName);
        return path !== undefined && captured.has(path);
      });
      const declared = sources.some((source) =>
        library.expectsNode(fromVirtual(source.fileName)!),
      );
      // A missing package declaration can reference node, even if its importer
      // is a different file or the compiler's ambient type list excludes node.
      expected =
        (declared && globals.missingPackageTypes) ||
        sources.some((source) => {
          if (runtimeHashbang(source.text) === "node") return true;
          const commonJs = importerOf(source).commonJs;
          const unbound = (name: ts.Identifier) =>
            probe(source, name, () => {
              if (insideWith(name)) return false;
              const symbol = checker.getSymbolAtLocation(name);
              // The JS checker synthesizes a declaration-less CommonJS require.
              return (
                !symbol ||
                (name.text === "require" && !symbol.declarations?.length)
              );
            });
          const visit = (node: ts.Node): true | undefined => {
            let specifier: ts.Expression | undefined;
            if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
              specifier = node.moduleSpecifier;
            else if (
              ts.isImportEqualsDeclaration(node) &&
              ts.isExternalModuleReference(node.moduleReference)
            )
              specifier = node.moduleReference.expression;
            else if (
              ts.isImportTypeNode(node) &&
              ts.isLiteralTypeNode(node.argument)
            )
              specifier = node.argument.literal;
            else if (ts.isCallExpression(node)) {
              const callee = unwrap(node.expression);
              if (
                commonJs &&
                node.arguments.length &&
                ts.isIdentifier(callee) &&
                callee.text === "require" &&
                unbound(callee)
              )
                return true;
              if (
                callee.kind === ts.SyntaxKind.ImportKeyword ||
                ((isCommonJsRequire(node) || requireForm(node, source)) &&
                  !insideWith(node))
              )
                specifier = node.arguments[0];
            } else if (
              ts.isIdentifier(node) &&
              (node.text === "process" ||
                node.text === "__dirname" ||
                node.text === "__filename") &&
              syntax.isInExpressionContext(node) &&
              !(
                ts.isPropertyAccessExpression(node.parent) &&
                node.parent.name === node
              ) &&
              unbound(node)
            )
              return true;
            if (specifier && ts.isStringLiteralLike(specifier)) {
              const selection = selectedSpecifier(specifier);
              const unit = selection && packageUnit(selection);
              if (
                unit &&
                probe(source, specifier, () => {
                  // A missing dependency can still bring Node types once its
                  // workspace is built. Keep that possibility in C-11's probe.
                  if (unit.ecosystem === "node") {
                    const units = outsideRoutes(specifier, true, false);
                    if (units.length === 1 && units[0]!.ecosystem === "node")
                      return true;
                  }
                  return (
                    declared &&
                    readModuleReason(specifier, false) === "external-package"
                  );
                })
              )
                return true;
            }
            return ts.forEachChild(node, visit);
          };
          return ts.forEachChild(source, visit) === true;
        });
      programNodeEvidence.set(program, expected);
    }
    missingNode ||= expected;
  }
  visit(file, moduleKey);

  // Triple-slash directives name a captured file or a declaration unit.
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
    } else if (!incompleteConfig && !context.anyFailed && kind === "lib") {
      const name = `lib.${reference.fileName.toLowerCase()}.d.ts`;
      if (program.getSourceFile(`${LIB_ROOT}/${name}`))
        found = {
          targets: [],
          libraryFacts: [
            { ...bundledLibraryUnit(name), evidence: "reference-directive" },
          ],
        };
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
        ...(found.libraryFacts?.length
          ? {
              libraryFacts: found.libraryFacts.map((target) => ({ ...target })),
            }
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
