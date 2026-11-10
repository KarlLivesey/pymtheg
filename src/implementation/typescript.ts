import ts from "typescript";
import { qualifyObservation } from "./partitions.js";
import { codeMutations, instanceClassForThis } from "./mutations.js";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { hash, json, identity } from "../shared/identity.js";
import { compareText } from "../shared/order.js";
import { type ObservedGraph, type ObservedSource } from "./schema.js";

/** Reads an immutable virtual project. It does not execute or reread target code. */
export function observeTypescript(
  input: readonly ObservedSource[],
  version: ObservedGraph["version"],
  options: {
    projectId?: string | null;
    sourcePaths?: readonly string[];
    discoveryComplete?: boolean;
    visitBudget?: number;
    fileVisitBudget?: number;
  } = {},
): ObservedGraph {
  if (input.length > 10000)
    throw Error("Observation exceeds 10,000 captured files");
  const files = [...input].sort((a, b) => compareText(a.path, b.path));
  const virtual = new Map<string, ts.SourceFile>();
  let bytes = 0;
  for (const file of files) {
    if (
      file.path.startsWith("/") ||
      file.path.includes("\\") ||
      file.path.split("/").includes("..")
    )
      throw Error("Observation source paths must be project-relative");
    if (file.hash !== hash(file.text))
      throw Error("Captured source hash does not match its text");
    bytes += Buffer.byteLength(file.text);
    if (bytes > 32 * 1024 * 1024)
      throw Error("Observation exceeds 32 MiB of source text");
    const name = "/" + file.path;
    if (virtual.has(name)) throw Error("Duplicate captured file " + file.path);
    virtual.set(
      name,
      ts.createSourceFile(
        name,
        file.text,
        ts.ScriptTarget.Latest,
        true,
        /\.tsx$/i.test(name)
          ? ts.ScriptKind.TSX
          : /\.jsx$/i.test(name)
            ? ts.ScriptKind.JSX
            : /\.[cm]?js$/i.test(name)
              ? ts.ScriptKind.JS
              : ts.ScriptKind.TS,
      ),
    );
  }
  const sourcePaths = new Set(
    (options.sourcePaths ?? files.map((f) => f.path)).map((f) => "/" + f),
  );
  const directories = new Set<string>(["/"]);
  for (const name of sourcePaths) {
    let directory = posix.dirname(name);
    while (!directories.has(directory)) {
      directories.add(directory);
      directory = posix.dirname(directory);
    }
  }
  const host: ts.CompilerHost = {
    getSourceFile: (file) => virtual.get(file),
    getDefaultLibFileName: () => "/__no_library__.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (file) => file,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (file) => sourcePaths.has(file),
    readFile: (file) => virtual.get(file)?.text,
    directoryExists: (directory) => directories.has(directory),
    getDirectories: (directory) =>
      [...directories].filter(
        (path) => posix.dirname(path) === directory && path !== directory,
      ),
  };
  const program = ts.createProgram(
    [...virtual.keys()],
    {
      noLib: true,
      types: [],
      allowJs: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    host,
  );
  const checker = program.getTypeChecker();
  // The pinned TypeScript binder keeps CommonJS source-module symbols here;
  // getSymbolAtLocation(SourceFile) exposes only ES module symbols.
  const sourceModule = (file: ts.SourceFile) =>
    checker.getSymbolAtLocation(file) ??
    (file as ts.SourceFile & { symbol?: ts.Symbol }).symbol;
  const printer = ts.createPrinter({
    removeComments: true,
    newLine: ts.NewLineKind.LineFeed,
  });
  const nodes: ObservedGraph["nodes"] = [],
    edges: ObservedGraph["edges"] = [],
    diagnostics: ObservedGraph["diagnostics"] = [];
  function defaultExportSymbol(node: ts.ExportAssignment) {
    const module = checker.getSymbolAtLocation(node.getSourceFile());
    return module
      ? checker.getExportsOfModule(module).find((s) => s.name === "default")
      : undefined;
  }
  const symbolAt = (node: ts.Node): ts.Symbol | undefined => {
    const symbol =
      ts.isIdentifier(node) &&
      ts.isShorthandPropertyAssignment(node.parent) &&
      node.parent.name === node
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : (checker.getSymbolAtLocation(node) ??
          ((ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) &&
          !node.name
            ? checker.getTypeAtLocation(node).getSymbol()
            : undefined) ??
          (ts.isExportAssignment(node)
            ? defaultExportSymbol(node)
            : undefined) ??
          (ts.isElementAccessExpression(node)
            ? checker
                .getTypeAtLocation(node.expression)
                .getProperty(literalKey(node.argumentExpression) ?? "")
            : undefined));
    return symbol && symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  };
  const mutated = new Set<ts.Symbol>();
  const writtenInstanceMembers = new Set<ts.Declaration>();
  const instanceMembers = new Map<
    ts.ClassLikeDeclaration,
    Map<string, ts.ClassElement[]>
  >();
  const escaped = new Set<ts.Symbol>();
  const extendedClasses = new Set<ts.Symbol>();
  const inheritanceFamilies: {
    owner: ts.ClassLikeDeclaration;
    bases: ts.Expression[];
  }[] = [];
  const ambiguousExports = new Set<ts.SourceFile>();
  const exportWrites = new Map<ts.SourceFile, Map<string, number>>();
  const exportForwards = new Map<ts.SourceFile, Set<ts.SourceFile>>();
  const moduleMemberAliases: NonNullable<ObservedGraph["moduleMemberAliases"]> =
    [];
  const inheritanceForwards: NonNullable<ObservedGraph["inheritanceForwards"]> =
    [];
  const requireAssignments = new Map<ts.Symbol, ts.Expression[]>();
  const requiredSymbols = new Set<ts.Symbol>(),
    requiredConsumers = new Map<ts.Symbol, Set<ts.Symbol>>();
  let originsComplete = true,
    solvingOrigins = false;
  const originSources = new Map<
    ts.Symbol,
    { node: ts.Node; field?: string; nested?: true }[]
  >();
  const originValues = new Map<ts.Symbol, RequiredOrigin[]>();
  const originKey = (o: RequiredOrigin) =>
    o.path + "\0" + o.name + "\0" + o.nested;
  function registerOrigin(
    symbol: ts.Symbol,
    node: ts.Node,
    field?: string,
    nested?: true,
  ) {
    const values = originSources.get(symbol) ?? [];
    values.push({
      node,
      ...(field !== undefined ? { field } : {}),
      ...(nested ? { nested } : {}),
    });
    originSources.set(symbol, values);
    originDependencies(node, symbol);
  }
  const requiredSymbolCache = new WeakMap<ts.Node, ts.Symbol | undefined>();
  const requiredSymbolAt = (node: ts.Node) => {
    if (requiredSymbolCache.has(node)) return requiredSymbolCache.get(node);
    const symbol =
      ts.isIdentifier(node) &&
      ts.isShorthandPropertyAssignment(node.parent) &&
      node.parent.name === node
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
    requiredSymbolCache.set(node, symbol);
    return symbol;
  };
  const exportObjectAliases = new Map<string, Set<string>>();
  const forwardedModuleObjects = new Set<string>();
  const exportObjectWrites = new Set<string>();
  const escapedModuleObjects = new Set<string>();
  const nodeIds = new Map<ts.Node, string>(),
    owners = new Map<ts.Node, string>();
  const parseFailures = new Set<string>();
  const implemented = new Set<string>();
  const bindingIds = new Set<string>();
  const originIndependentTargets = new Set<string>();
  const names = new Map<string, number>();
  let visits = 0,
    fileVisits = 0,
    fileBudget = 0;
  const visitBudget =
    options.visitBudget ?? Math.min(16_000_000, Math.max(2_000_000, bytes * 2));
  const budgetExceeded = Symbol("observation budget");
  const declarationFailures = new Set<string>(),
    relationshipFailures = new Set<string>();
  const beginFile = (file: ts.SourceFile) => {
    fileVisits = 0;
    fileBudget =
      options.fileVisitBudget ??
      Math.max(10000, Math.min(1000000, file.text.length * 4));
  };
  const checkBudget = () => {
    if (
      ++visits > visitBudget ||
      ++fileVisits > fileBudget ||
      nodes.length >= 100000 ||
      edges.length >= 1000000
    )
      throw budgetExceeded;
  };
  const budgetDiagnostic = (file: ts.SourceFile, phase: string) =>
    diagnostics.push({
      span: { file: file.fileName.slice(1), start: 0, end: 0 },
      severity: "warning",
      message: `Code ${phase} incomplete for this file: deterministic observation budget reached (${files.length} files, ${bytes} source bytes; ${visits} visits of ${visitBudget} total, ${fileVisits} of ${fileBudget} for this file/pass; maximum 100,000 declarations and 1,000,000 edges). Capture a narrower source scope to inspect omitted relationships or declarations.`,
    });
  const span = (node: ts.Node, file: ts.SourceFile) => ({
    file: file.fileName.slice(1),
    start: node.getStart(file),
    end: node.end,
  });
  const print = (node: ts.Node, file: ts.SourceFile) =>
    printer.printNode(ts.EmitHint.Unspecified, node, file);
  const unwrap = (value: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(value)) value = value.expression;
    return value;
  };
  function literalKey(node: ts.Expression): string | undefined {
    const type = checker.getTypeAtLocation(node);
    return type.isStringLiteral() || type.isNumberLiteral()
      ? String(type.value)
      : ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)
        ? node.text
        : undefined;
  }
  function dynamicImportTarget(node: ts.Node): string | undefined {
    if (
      !ts.isCallExpression(node) ||
      node.expression.kind !== ts.SyntaxKind.ImportKeyword ||
      !node.arguments[0] ||
      !ts.isStringLiteralLike(node.arguments[0])
    )
      return;
    return ts.resolveModuleName(
      node.arguments[0].text,
      node.getSourceFile().fileName,
      program.getCompilerOptions(),
      host,
    ).resolvedModule?.resolvedFileName;
  }
  function writesModuleExportsMember(node: ts.Expression): boolean {
    let receiver = unwrap(node);
    while (
      ts.isPropertyAccessExpression(receiver) ||
      ts.isElementAccessExpression(receiver)
    ) {
      receiver = unwrap(receiver.expression);
      if (commonjsName(receiver, receiver, true) === "") return true;
    }
    return false;
  }
  function commonjsName(
    left: ts.Node,
    value: ts.Node,
    exportKey = false,
  ): string | null {
    const parts: string[] = [];
    let current = left;
    while (
      ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current)
    ) {
      if (ts.isPropertyAccessExpression(current)) parts.push(current.name.text);
      else if (
        current.argumentExpression &&
        ts.isStringLiteral(current.argumentExpression)
      )
        parts.push(current.argumentExpression.text);
      else return null;
      current = current.expression;
    }
    if (!ts.isIdentifier(current)) return null;
    parts.push(current.text);
    parts.reverse();
    if (parts[0] === "exports" && parts.length > 1)
      return parts.slice(1).join(".");
    if (parts[0] !== "module" || parts[1] !== "exports") return null;
    if (parts.length > 2) return parts.slice(2).join(".");
    return exportKey
      ? ""
      : ts.isFunctionExpression(value) && value.name
        ? value.name.text
        : "default";
  }
  // For an unclassified expression, retain only instance-origin uncertainty.
  // A function used to compute an object/key is not thereby rebound or mutated.
  const instanceOriginsVisited = new Set<ts.Node>();
  function escapeInstanceOrigins(value: ts.Node) {
    if (instanceOriginsVisited.has(value)) return;
    instanceOriginsVisited.add(value);
    try {
      checkBudget();
      if (value.kind === ts.SyntaxKind.ThisKeyword) {
        const owner = instanceClassForThis(value);
        if (owner) {
          const symbol =
            symbolAt(owner.name ?? owner) ??
            checker.getTypeAtLocation(owner).symbol;
          if (symbol) escaped.add(symbol);
        }
        return;
      }
      if (ts.isIdentifier(value)) {
        const symbol = symbolAt(value);
        if (!symbol) return;
        for (const source of originSources.get(symbol) ?? [])
          escapeInstanceOrigins(source.node);
        for (const declaration of symbol.declarations ?? []) {
          if (ts.isVariableDeclaration(declaration) && declaration.initializer)
            escapeInstanceOrigins(declaration.initializer);
          if (ts.isBindingElement(declaration)) {
            let root: ts.Node = declaration;
            while (!ts.isVariableDeclaration(root) && !ts.isSourceFile(root))
              root = root.parent;
            if (ts.isVariableDeclaration(root) && root.initializer)
              escapeInstanceOrigins(root.initializer);
          }
        }
        return;
      }
      ts.forEachChild(value, (child) => escapeInstanceOrigins(child));
    } catch (error) {
      // A partial walk must never masquerade as completed origin coverage.
      instanceOriginsVisited.clear();
      throw error;
    }
  }
  // Mutation of a receiver (including through a static alias) invalidates its
  // apparent structural method identity. This is deliberately flow-insensitive.
  function markReceiver(
    value: ts.Expression,
    seen = new Set<ts.Symbol>(),
    trackedInstanceMember = false,
  ) {
    checkBudget();
    // Instance members are tracked by their own symbols. Writing this.x does
    // not rebind the constructor; unknown receiver writes are escapes below.
    if (value.kind === ts.SyntaxKind.ThisKeyword) {
      const owner = instanceClassForThis(value);
      if (owner) {
        if (!trackedInstanceMember) {
          const symbol =
            symbolAt(owner.name ?? owner) ??
            checker.getTypeAtLocation(owner).symbol;
          if (symbol) escaped.add(symbol);
        }
        return;
      }
    }
    if (
      ts.isParenthesizedExpression(value) ||
      ts.isAsExpression(value) ||
      ts.isTypeAssertionExpression(value) ||
      ts.isNonNullExpression(value) ||
      ts.isSatisfiesExpression(value)
    ) {
      markReceiver(value.expression, seen, trackedInstanceMember);
      return;
    }
    if (
      ts.isPropertyAccessExpression(value) ||
      ts.isElementAccessExpression(value)
    ) {
      if (!symbolAt(value.expression)?.declarations?.some(ts.isSourceFile))
        markReceiver(value.expression, seen, trackedInstanceMember);
    }
    if (
      ts.isIdentifier(value) &&
      (value.text === "exports" || value.text === "module")
    )
      ambiguousExports.add(value.getSourceFile());
    // Unclassified containers can still carry this through arrays, calls,
    // conditionals or comma expressions. Never silently discard that origin.
    if (
      !ts.isIdentifier(value) &&
      !ts.isPropertyAccessExpression(value) &&
      !ts.isElementAccessExpression(value) &&
      !ts.isFunctionLike(value)
    )
      escapeInstanceOrigins(value);
    const symbol = symbolAt(value);
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    mutated.add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer)
        markReceiver(declaration.initializer, seen, trackedInstanceMember);
      if (ts.isBindingElement(declaration)) {
        let root: ts.Node = declaration;
        while (!ts.isVariableDeclaration(root) && !ts.isSourceFile(root))
          root = root.parent;
        if (ts.isVariableDeclaration(root) && root.initializer)
          markReceiver(root.initializer, seen);
      }
    }
  }
  function markInstanceMember(target: ts.Expression) {
    const unwrapInstance = (value: ts.Expression): ts.Expression => {
      while (
        ts.isParenthesizedExpression(value) ||
        ts.isAsExpression(value) ||
        ts.isTypeAssertionExpression(value) ||
        ts.isNonNullExpression(value) ||
        ts.isSatisfiesExpression(value)
      )
        value = value.expression;
      return value;
    };
    let value = unwrapInstance(target),
      key: string | null = null;
    const seen = new Set<ts.Symbol>();
    while (true) {
      checkBudget();
      if (
        ts.isPropertyAccessExpression(value) ||
        ts.isElementAccessExpression(value)
      ) {
        key = ts.isPropertyAccessExpression(value)
          ? value.name.text
          : (literalKey(value.argumentExpression) ?? null);
        value = unwrapInstance(value.expression);
      } else if (ts.isIdentifier(value)) {
        const symbol = symbolAt(value);
        if (!symbol || seen.has(symbol)) return false;
        seen.add(symbol);
        const declaration = symbol.declarations?.find(ts.isVariableDeclaration);
        if (!declaration?.initializer) return false;
        value = unwrapInstance(declaration.initializer);
      } else break;
    }
    if (value.kind !== ts.SyntaxKind.ThisKeyword) return false;
    const owner = instanceClassForThis(value);
    if (!owner) return false;
    if (key === null || key === "__proto__" || key === "constructor") {
      const symbol = symbolAt(owner.name ?? owner);
      if (symbol) escaped.add(symbol);
      return false;
    }
    let members = instanceMembers.get(owner);
    if (!members) {
      members = new Map();
      instanceMembers.set(owner, members);
      for (const member of owner.members) {
        checkBudget();
        const name = member.name;
        if (!name) continue;
        const memberKey = ts.isComputedPropertyName(name)
          ? literalKey(name.expression)
          : ts.isIdentifier(name) ||
              ts.isStringLiteralLike(name) ||
              ts.isNumericLiteral(name)
            ? name.text
            : undefined;
        if (memberKey !== undefined) {
          const group = members.get(memberKey) ?? [];
          group.push(member);
          members.set(memberKey, group);
        }
      }
    }
    for (const member of members.get(key) ?? []) {
      writtenInstanceMembers.add(member);
      const symbol = symbolAt(member.name!);
      if (symbol) mutated.add(symbol);
    }
    return true;
  }

  function add(
    node: ts.Node,
    file: ts.SourceFile,
    owner: string,
    scope: string[],
  ) {
    let kind: ObservedGraph["nodes"][number]["kind"] | undefined;
    let name: string | undefined;
    let body: ts.ConciseBody | undefined;
    if (ts.isFunctionDeclaration(node)) {
      kind = "function";
      name = node.name?.text ?? "default";
      body = node.body;
    } else if (
      ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      kind = "method";
      name = ts.isConstructorDeclaration(node)
        ? "constructor"
        : node.name.getText(file);
      body = "body" in node ? node.body : undefined;
    } else if (
      (ts.isVariableDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isPropertyAssignment(node)) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      kind = ts.isVariableDeclaration(node) ? "function" : "method";
      name = node.name.getText(file);
      body = node.initializer.body;
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const value = unwrap(node.right);
      if (ts.isFunctionExpression(value) || ts.isArrowFunction(value)) {
        name = commonjsName(node.left, value) ?? undefined;
        kind = "function";
        body = value.body;
      }
    } else if (
      (ts.isVariableDeclaration(node) &&
        node.initializer &&
        ts.isVariableStatement(node.parent.parent) &&
        ts.isSourceFile(node.parent.parent.parent) &&
        ts.isIdentifier(node.name)) ||
      (ts.isPropertyDeclaration(node) && !!node.initializer)
    ) {
      kind = "binding";
      name = node.name.getText(file);
      body = node.initializer;
    } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      let root: ts.Node = node.parent;
      while (
        ts.isBindingElement(root) ||
        ts.isObjectBindingPattern(root) ||
        ts.isArrayBindingPattern(root)
      )
        root = root.parent;
      if (
        ts.isVariableDeclaration(root) &&
        root.initializer &&
        ts.isVariableStatement(root.parent.parent) &&
        ts.isSourceFile(root.parent.parent.parent)
      ) {
        kind = "binding";
        name = node.name.text;
        body = root.initializer;
      }
    } else if (ts.isEnumDeclaration(node)) {
      kind = "binding";
      name = node.name.text;
    } else if (ts.isClassDeclaration(node)) {
      kind = "class";
      name = node.name?.text ?? "default";
    } else if (ts.isInterfaceDeclaration(node)) {
      kind = "interface";
      name = node.name.text;
    } else if (ts.isTypeAliasDeclaration(node)) {
      kind = "type";
      name = node.name.text;
    }
    if (!kind || !name) return null;
    const qualifiedName = [...scope, name].join(".");
    const base = `${file.fileName.slice(1)}#${kind}:${qualifiedName}`;
    const ordinal = names.get(base) ?? 0;
    names.set(base, ordinal + 1);
    const id = ordinal ? base + "@" + ordinal : base;
    const signature = parseFailures.has(file.fileName)
      ? "Unparsed declaration — inspect the retained source and parse diagnostics"
      : body
        ? file.text.slice(node.getStart(file), body.getStart(file)).trim()
        : print(node, file);
    const printedBody = body ? print(body, file) : null;
    let bodyKind: ObservedGraph["nodes"][number]["body"] = body
      ? "present"
      : "declaration-only";
    if (kind === "class" || ts.isEnumDeclaration(node)) bodyKind = "present";
    if (body && ts.isBlock(body)) {
      if (!body.statements.length)
        bodyKind =
          ts.isConstructorDeclaration(node) &&
          node.parameters.some((parameter) =>
            ts.isParameterPropertyDeclaration(parameter, node),
          )
            ? "present"
            : "empty";
      else if (
        body.statements.length === 1 &&
        ts.isThrowStatement(body.statements[0]!) &&
        /["'`]Not implemented["'`]/i.test(print(body.statements[0]!, file))
      )
        bodyKind = "fail-fast";
    }
    if (parseFailures.has(file.fileName)) bodyKind = "unparsed";
    let moduleScoped = !!sourceModule(file);
    for (
      let ancestor: ts.Node | undefined = node.parent;
      ancestor && moduleScoped;
      ancestor = ancestor.parent
    )
      if (
        ts.isModuleDeclaration(ancestor) &&
        (ts.isStringLiteral(ancestor.name) ||
          ancestor.flags & ts.NodeFlags.GlobalAugmentation)
      )
        moduleScoped = false;
    if (
      moduleScoped &&
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        (ts.isVariableDeclaration(node) &&
          !!node.initializer &&
          (ts.isArrowFunction(node.initializer) ||
            ts.isFunctionExpression(node.initializer))))
    )
      originIndependentTargets.add(id);
    nodes.push({
      id,
      name,
      qualifiedName,
      ...(moduleScoped ? { moduleScoped: true } : {}),
      kind,
      span: span(node, file),
      signature,
      declarationHash: hash(signature),
      body: bodyKind,
      bodyHash:
        bodyKind === "unparsed"
          ? null
          : ts.isEnumDeclaration(node)
            ? hash(print(node, file))
            : printedBody === null
              ? null
              : hash(printedBody),
    });
    nodeIds.set(node, id);
    if (kind === "binding") bindingIds.add(id);
    if (body || kind === "class") implemented.add(id);
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isPropertyAssignment(node)) &&
      node.initializer
    )
      nodeIds.set(node.initializer, id);
    if (ts.isBinaryExpression(node)) {
      nodeIds.set(node.left, id);
      nodeIds.set(node.right, id);
      nodeIds.set(unwrap(node.right), id);
    }
    edges.push({
      from: owner,
      to: id,
      targetName: name,
      kind: "contains",
      resolution: "resolved",
      span: span(node, file),
    });
    return { id, scope: [...scope, name] };
  }
  function originDependencies(node: ts.Node, owner: ts.Symbol) {
    checkBudget();
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      originDependencies(node.expression, owner);
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      requiredSymbols.add(owner);
      return;
    }
    if (ts.isIdentifier(node)) {
      const symbol = requiredSymbolAt(node);
      if (symbol) {
        const users = requiredConsumers.get(symbol) ?? new Set<ts.Symbol>();
        users.add(owner);
        requiredConsumers.set(symbol, users);
      }
      return;
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      originDependencies(node.expression, owner);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      originDependencies(node.whenTrue, owner);
      originDependencies(node.whenFalse, owner);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      if (
        [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.CommaToken].includes(
          node.operatorToken.kind,
        )
      )
        originDependencies(node.right, owner);
      else if (
        [
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.BarBarEqualsToken,
          ts.SyntaxKind.AmpersandAmpersandEqualsToken,
          ts.SyntaxKind.QuestionQuestionEqualsToken,
        ].includes(node.operatorToken.kind)
      ) {
        originDependencies(node.left, owner);
        originDependencies(node.right, owner);
      }
    }
  }
  // Resolve all captured assignment sources, independent of statement order.
  for (const file of virtual.values()) {
    beginFile(file);
    try {
      const visit = (node: ts.Node) => {
        checkBudget();
        if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
          ts.isIdentifier(node.left)
        ) {
          const symbol = requiredSymbolAt(node.left);
          if (symbol) {
            const values = requireAssignments.get(symbol) ?? [];
            values.push(node.right);
            requireAssignments.set(symbol, values);
            registerOrigin(symbol, node.right);
          }
        }
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer
        ) {
          const symbol = requiredSymbolAt(node.name);
          if (symbol) registerOrigin(symbol, node.initializer);
        }
        if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
          let root: ts.Node = node.parent;
          while (
            ts.isBindingElement(root) ||
            ts.isObjectBindingPattern(root) ||
            ts.isArrayBindingPattern(root)
          )
            root = root.parent;
          const symbol = requiredSymbolAt(node.name);
          if (symbol && ts.isVariableDeclaration(root) && root.initializer) {
            let binding: ts.Node = node;
            const fields: string[] = [];
            while (binding !== root) {
              if (ts.isBindingElement(binding)) {
                const name = binding.propertyName ?? binding.name;
                if (ts.isIdentifier(name) || ts.isStringLiteralLike(name))
                  fields.unshift(name.text);
              }
              binding = binding.parent;
            }
            registerOrigin(
              symbol,
              root.initializer,
              fields[0],
              fields.length > 1 ? true : undefined,
            );
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    } catch (error) {
      if (error !== budgetExceeded) throw error;
      relationshipFailures.add(file.fileName);
      budgetDiagnostic(file, "assignment origins");
      originsComplete = false;
    }
  }
  const originQueue = [...requiredSymbols];
  for (let i = 0; i < originQueue.length; i++)
    for (const user of requiredConsumers.get(originQueue[i]!) ?? [])
      if (!requiredSymbols.has(user)) {
        requiredSymbols.add(user);
        originQueue.push(user);
      }
  const originVisits = new Map<ts.SourceFile, number>();
  let originFile = [...virtual.values()][0]!;
  try {
    solvingOrigins = true;
    const originPending = [
        ...(originsComplete ? requiredSymbols : originSources.keys()),
      ],
      originQueued = new Set(originPending);
    for (let i = 0; i < originPending.length; i++) {
      const symbol = originPending[i]!;
      originQueued.delete(symbol);
      const known = new Map(
        (originValues.get(symbol) ?? []).map((o) => [originKey(o), o]),
      );
      const before = known.size;
      for (const source of originSources.get(symbol) ?? []) {
        originFile = source.node.getSourceFile();
        beginFile(originFile);
        fileVisits = originVisits.get(originFile) ?? 0;
        for (const origin of requireOrigins(source.node)) {
          checkBudget();
          const value =
            source.field !== undefined
              ? {
                  ...origin,
                  name: origin.name ?? source.field,
                  ...(origin.name !== undefined || source.nested
                    ? { nested: true as const }
                    : {}),
                }
              : origin;
          known.set(originKey(value), value);
        }
        originVisits.set(originFile, fileVisits);
      }
      if (known.size === before) continue;
      originValues.set(symbol, [...known.values()]);
      for (const user of requiredConsumers.get(symbol) ?? [])
        if (!originQueued.has(user)) {
          originQueued.add(user);
          originPending.push(user);
        }
    }
  } catch (error) {
    if (error !== budgetExceeded) throw error;
    originsComplete = false;
    for (const file of virtual.values())
      relationshipFailures.add(file.fileName);
    budgetDiagnostic(originFile, "require origin fixed point");
  } finally {
    solvingOrigins = false;
  }
  for (const file of virtual.values()) {
    const fileDiagnostics = program.getSyntacticDiagnostics(file);
    if (fileDiagnostics.length) parseFailures.add(file.fileName);
    const id = `file:${file.fileName.slice(1)}`;
    nodes.push({
      id,
      name: file.fileName.slice(1),
      qualifiedName: file.fileName.slice(1),
      kind: "module",
      span: { file: file.fileName.slice(1), start: 0, end: file.end },
      signature: "module",
      declarationHash: hash("module"),
      body: fileDiagnostics.length ? "unparsed" : "present",
      bodyHash: hash(file.text),
    });
    nodeIds.set(file, id);
    for (const diagnostic of fileDiagnostics)
      diagnostics.push({
        span: {
          file: file.fileName.slice(1),
          start: diagnostic.start ?? 0,
          end: (diagnostic.start ?? 0) + (diagnostic.length ?? 0),
        },
        severity: "error",
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      });
    const visit = (node: ts.Node, owner: string, scope: string[]) => {
      checkBudget();
      if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
        if (
          node.moduleSpecifier &&
          ts.isStringLiteralLike(node.moduleSpecifier)
        ) {
          const resolved = ts.resolveModuleName(
            node.moduleSpecifier.text,
            file.fileName,
            program.getCompilerOptions(),
            host,
          ).resolvedModule?.resolvedFileName;
          if (resolved && sourcePaths.has(resolved)) {
            if (node.exportClause && ts.isNamedExports(node.exportClause)) {
              for (const item of node.exportClause.elements)
                if (!item.isTypeOnly) {
                  checkBudget();
                  inheritanceForwards.push({
                    file: file.fileName.slice(1),
                    name: item.name.text,
                    target: resolved.slice(1),
                    targetName: (item.propertyName ?? item.name).text,
                  });
                }
            } else if (!node.exportClause)
              inheritanceForwards.push({
                file: file.fileName.slice(1),
                name: "*",
                target: resolved.slice(1),
              });
          }
        } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const item of node.exportClause.elements)
            if (!item.isTypeOnly) {
              checkBudget();
              const imported = importedTarget(
                item.propertyName ?? item.name,
                true,
                checker.getExportSpecifierLocalTargetSymbol(item),
              );
              if (imported)
                inheritanceForwards.push({
                  file: file.fileName.slice(1),
                  name: item.name.text,
                  target: imported.file,
                  targetName: imported.name,
                });
            }
        }
      }
      if (ts.isClassLike(node)) {
        const bases = (node.heritageClauses ?? [])
          .filter((c) => c.token === ts.SyntaxKind.ExtendsKeyword)
          .flatMap((c) => c.types.map((t) => t.expression));
        if (bases.length) inheritanceFamilies.push({ owner: node, bases });
      }
      if (ts.isClassDeclaration(node))
        for (const clause of node.heritageClauses ?? []) {
          if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
          for (const base of clause.types) {
            let symbol = symbolAt(base.expression);
            if (symbol && symbol.flags & ts.SymbolFlags.Alias)
              symbol = checker.getAliasedSymbol(symbol);
            if (symbol) extendedClasses.add(symbol);
          }
        }
      if (
        ts.isReturnStatement(node) &&
        node.expression &&
        node.expression.kind !== ts.SyntaxKind.ThisKeyword
      ) {
        let enclosing: ts.Node | undefined = node.parent;
        while (enclosing && !ts.isFunctionLike(enclosing))
          enclosing = enclosing.parent;
        if (
          enclosing &&
          ts.isConstructorDeclaration(enclosing) &&
          ts.isClassLike(enclosing.parent)
        ) {
          const owner = enclosing.parent;
          const symbol =
            symbolAt(owner.name ?? owner) ??
            checker.getTypeAtLocation(owner).getSymbol();
          if (symbol) mutated.add(symbol);
        }
      }
      const assigned =
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          ? node.left
          : (ts.isPrefixUnaryExpression(node) ||
                ts.isPostfixUnaryExpression(node)) &&
              [
                ts.SyntaxKind.PlusPlusToken,
                ts.SyntaxKind.MinusMinusToken,
              ].includes(node.operator)
            ? node.operand
            : ts.isDeleteExpression(node)
              ? node.expression
              : null;
      if (
        assigned &&
        (writesModuleExportsMember(assigned) ||
          (ts.isIdentifier(assigned) && assigned.text === "exports"))
      )
        exportObjectWrites.add(file.fileName);
      const written = assigned ? symbolAt(assigned) : undefined;
      const definition =
        ts.isBinaryExpression(node) &&
        commonjsName(node.left, unwrap(node.right)) !== null;
      if (ts.isBinaryExpression(node) && assigned) {
        const key = commonjsName(node.left, unwrap(node.right), true);
        if (key !== null) {
          for (const source of key === ""
            ? requireOrigins(node.right)
                .filter((o) => o.name === undefined)
                .map((o) => o.path)
            : []) {
            forwardedModuleObjects.add(file.fileName);
            for (const [a, b] of [
              [file.fileName, source],
              [source, file.fileName],
            ]) {
              const group = exportObjectAliases.get(a!) ?? new Set<string>();
              group.add(b!);
              exportObjectAliases.set(a!, group);
            }
          }
          for (const origin of requireOrigins(node.right))
            if (
              (key && !key.includes(".")) ||
              (key === "" && origin.name !== undefined)
            )
              moduleMemberAliases.push({
                file: file.fileName.slice(1),
                name: key || "*",
                target: origin.path.slice(1),
                ...(origin.name !== undefined
                  ? { targetName: origin.name }
                  : {}),
              });
          const object = unwrap(node.right);
          if (ts.isObjectLiteralExpression(object))
            for (const property of object.properties) {
              if (
                !ts.isShorthandPropertyAssignment(property) &&
                !ts.isPropertyAssignment(property)
              )
                continue;
              const name = property.name;
              if (
                !ts.isIdentifier(name) &&
                !ts.isStringLiteralLike(name) &&
                !ts.isNumericLiteral(name)
              )
                continue;
              const value = ts.isShorthandPropertyAssignment(property)
                ? property.name
                : property.initializer;
              for (const origin of requireOrigins(value))
                moduleMemberAliases.push({
                  file: file.fileName.slice(1),
                  name: key ? key.split(".")[0]! : name.text,
                  target: origin.path.slice(1),
                  ...(origin.name !== undefined
                    ? { targetName: origin.name }
                    : {}),
                });
            }
          const forwarded = requireOrigin(node.right);
          if (forwarded?.file) {
            const sources =
              exportForwards.get(file) ?? new Set<ts.SourceFile>();
            sources.add(forwarded.file);
            exportForwards.set(file, sources);
          }
          const writes = exportWrites.get(file) ?? new Map<string, number>();
          if (
            (key === "" && writes.size > 0) ||
            !(
              ts.isExpressionStatement(node.parent) &&
              ts.isSourceFile(node.parent.parent)
            )
          )
            ambiguousExports.add(file);
          writes.set(key, (writes.get(key) ?? 0) + 1);
          if (key === "" && ts.isObjectLiteralExpression(unwrap(node.right))) {
            for (const property of (
              unwrap(node.right) as ts.ObjectLiteralExpression
            ).properties)
              if (
                property.name &&
                (ts.isIdentifier(property.name) ||
                  ts.isStringLiteral(property.name))
              )
                writes.set(
                  property.name.text,
                  (writes.get(property.name.text) ?? 0) + 1,
                );
          }
          if ([...writes.values()].some((count) => count > 1))
            ambiguousExports.add(file);
          exportWrites.set(file, writes);
        }
      }
      if (written && !definition) mutated.add(written);
      if (
        assigned &&
        !definition &&
        (ts.isPropertyAccessExpression(assigned) ||
          ts.isElementAccessExpression(assigned)) &&
        commonjsName(assigned, assigned, true) === null
      ) {
        const tracked = markInstanceMember(assigned);
        markReceiver(assigned.expression, new Set(), tracked);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        ["Object", "Reflect"].includes(node.expression.expression.text) &&
        [
          "assign",
          "defineProperty",
          "defineProperties",
          "setPrototypeOf",
          "set",
          "deleteProperty",
        ].includes(node.expression.name.text) &&
        node.arguments[0]
      )
        markReceiver(node.arguments[0]);
      const added = node === file ? null : add(node, file, owner, scope);
      const currentOwner = added?.id ?? owner;
      owners.set(node, currentOwner);
      const objectBinding =
        (ts.isVariableDeclaration(node) ||
          ts.isPropertyAssignment(node) ||
          ts.isPropertyDeclaration(node)) &&
        node.initializer &&
        ts.isObjectLiteralExpression(unwrap(node.initializer))
          ? node.name.getText(file)
          : ts.isBinaryExpression(node) &&
              ts.isObjectLiteralExpression(unwrap(node.right))
            ? commonjsName(node.left, unwrap(node.right), true)
            : null;
      const childScope =
        added?.scope ?? (objectBinding ? [...scope, objectBinding] : scope);
      ts.forEachChild(node, (child) => visit(child, currentOwner, childScope));
    };
    beginFile(file);
    const firstNode = nodes.length,
      firstEdge = edges.length;
    try {
      visit(file, id, []);
    } catch (error) {
      if (error !== budgetExceeded) throw error;
      declarationFailures.add(file.fileName);
      relationshipFailures.add(file.fileName);
      nodes.splice(firstNode);
      edges.splice(firstEdge);
      nodes[firstNode - 1]!.body = "unparsed";
      nodes[firstNode - 1]!.bodyHash = null;
      budgetDiagnostic(file, "declarations");
    }
  }
  // A member write through module.exports can mutate the whole-module object
  // imported from another file. Traverse shared objects in both directions so
  // direct consumers are qualified too, independent of file/capture order.
  const aliasWrites = [...exportObjectWrites].filter((file) =>
    forwardedModuleObjects.has(file),
  );
  while (aliasWrites.length) {
    const file = aliasWrites.pop()!;
    if (escapedModuleObjects.has(file)) continue;
    escapedModuleObjects.add(file);
    const captured = virtual.get(file);
    if (captured) ambiguousExports.add(captured);
    aliasWrites.push(...(exportObjectAliases.get(file) ?? []));
  }
  let mutationWrites: ReturnType<typeof codeMutations>["writes"] = [];
  let escapeSites: ReturnType<typeof codeMutations>["escapes"] = [];
  let mutationComplete = true;
  // Missing declarations cannot supply complete cross-file mutation provenance.
  if (declarationFailures.size) originsComplete = false;
  const mutationVisits = new Map<ts.SourceFile, number>();
  const dynamicThis = new WeakMap<ts.Node, boolean>();
  function unboundThis(node: ts.Node): boolean {
    if (dynamicThis.has(node)) return dynamicThis.get(node)!;
    const fn = ts.isFunctionLike(node)
      ? node
      : "initializer" in node &&
          node.initializer &&
          typeof node.initializer === "object" &&
          "kind" in node.initializer &&
          ts.isFunctionLike(node.initializer as ts.Node)
        ? (node.initializer as ts.FunctionLikeDeclaration)
        : undefined;
    if (
      !fn ||
      ts.isMethodDeclaration(fn) ||
      ts.isGetAccessorDeclaration(fn) ||
      ts.isSetAccessorDeclaration(fn)
    )
      return false;
    if (
      (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) &&
      ts.isPropertyAssignment(fn.parent)
    )
      return false;
    let found = false;
    function visit(child: ts.Node) {
      checkBudget();
      if (found) return;
      if (
        child !== fn &&
        ts.isFunctionLike(child) &&
        !ts.isArrowFunction(child)
      )
        return;
      if (child.kind === ts.SyntaxKind.ThisKeyword) {
        found = true;
        return;
      }
      ts.forEachChild(child, visit);
    }
    visit(fn);
    dynamicThis.set(node, found);
    return found;
  }
  let mutationFile: ts.SourceFile | undefined;
  const declarationValues = (d: ts.Declaration): ts.Node[] =>
    !virtual.has(d.getSourceFile().fileName)
      ? []
      : ts.isExportAssignment(d)
        ? [d]
        : "name" in d && d.name
          ? [d.name as ts.Node]
          : ts.isClassDeclaration(d) || ts.isFunctionDeclaration(d)
            ? [d]
            : [];
  try {
    const mutations = codeMutations(
      [...virtual.values()].filter((f) => !declarationFailures.has(f.fileName)),
      symbolAt,
      mutated,
      escaped,
      owners,
      (node) => {
        const type = checker.getTypeAtLocation(node);
        const scalar = (t: ts.Type): boolean =>
          t.isUnion()
            ? t.types.every(scalar)
            : !!(
                t.flags &
                (ts.TypeFlags.StringLike |
                  ts.TypeFlags.NumberLike |
                  ts.TypeFlags.BigIntLike |
                  ts.TypeFlags.BooleanLike |
                  ts.TypeFlags.Null |
                  ts.TypeFlags.Undefined |
                  ts.TypeFlags.Void |
                  ts.TypeFlags.Never)
              );
        return scalar(type);
      },
      (node) => {
        const seen = new Set<ts.Symbol>();
        const captured = (e: ts.Node): boolean => {
          const s = symbolAt(e);
          if (!s || seen.has(s)) return false;
          seen.add(s);
          return !!s.declarations?.some((d) => {
            const id = nodeIds.get(d);
            if (id && implemented.has(id) && !bindingIds.has(id))
              return !unboundThis(d);
            return (
              (ts.isPropertyAccessExpression(d) ||
                ts.isElementAccessExpression(d)) &&
              ts.isBinaryExpression(d.parent) &&
              commonjsName(d, unwrap(d.parent.right), true) !== null &&
              captured(d.parent.right)
            );
          });
        };
        return captured(node);
      },
      (node) => {
        const dynamic = dynamicImportTarget(node);
        if (dynamic) {
          const file = virtual.get(dynamic),
            module = file && checker.getSymbolAtLocation(file);
          return (module ? checker.getExportsOfModule(module) : []).flatMap(
            (member) => {
              const value =
                member.flags & ts.SymbolFlags.Alias
                  ? checker.getAliasedSymbol(member)
                  : member;
              return value.flags & ts.SymbolFlags.Value
                ? (value.declarations ?? []).flatMap(declarationValues)
                : [];
            },
          );
        }
        const type = checker.getTypeAtLocation(node),
          symbol = type.getSymbol() ?? symbolAt(node);
        if (
          !symbol?.declarations?.some(
            (d) => ts.isSourceFile(d) || ts.isModuleDeclaration(d),
          )
        )
          return [];
        return type.getProperties().flatMap((member) => {
          let value = member;
          if (value.flags & ts.SymbolFlags.Alias)
            value = checker.getAliasedSymbol(value);
          if (!(value.flags & ts.SymbolFlags.Value)) return [];
          return (value.declarations ?? []).flatMap(declarationValues);
        });
      },
      (node) => {
        const origins = requireOrigins(node);
        return origins.length > 0 && origins.every((o) => o.name === undefined);
      },
      (file) => {
        beginFile(file);
        fileVisits = mutationVisits.get(file) ?? 0;
        mutationFile = file;
      },
      () => {
        checkBudget();
        if (mutationFile) mutationVisits.set(mutationFile, fileVisits);
      },
    );
    mutationWrites = mutations.writes;
    escapeSites = mutations.escapes;
    for (const site of escapeSites)
      if (
        (ts.isIdentifier(site.target) &&
          ["exports", "module"].includes(site.target.text)) ||
        commonjsName(site.target, site.target, true) !== null
      )
        ambiguousExports.add(site.target.getSourceFile());
    for (const write of mutationWrites)
      for (const target of requiredWrites(write)) {
        const file = virtual.get("/" + target.file);
        if (file) ambiguousExports.add(file);
      }
    for (const site of escapeSites) {
      for (const target of requiredEscapes(site)) {
        const file = virtual.get("/" + target.file);
        if (
          file &&
          (target.moduleObject ||
            (file.isDeclarationFile &&
              target.memberObject &&
              sourceModule(file) &&
              checker
                .getExportsOfModule(sourceModule(file)!)
                .some(
                  (e) =>
                    e.name === target.name &&
                    e.declarations?.some(ts.isClassDeclaration),
                )))
        )
          ambiguousExports.add(file);
      }
      const imported = importedTarget(site.target, true);
      const file =
        imported?.name === "*" ? virtual.get("/" + imported.file) : undefined;
      if (file && exportWrites.has(file)) ambiguousExports.add(file);
    }
    // Uncertainty belongs to the shared object, not just the file that exposed
    // it: reflective writes and passing module.exports to a helper must qualify
    // direct consumers of any alias too.
    const pendingObjects = [...ambiguousExports]
      .map((file) => file.fileName)
      .filter((file) => exportObjectAliases.has(file));
    while (pendingObjects.length) {
      const file = pendingObjects.pop()!;
      if (escapedModuleObjects.has(file)) continue;
      escapedModuleObjects.add(file);
      const captured = virtual.get(file);
      if (captured) ambiguousExports.add(captured);
      pendingObjects.push(...(exportObjectAliases.get(file) ?? []));
    }
  } catch (error) {
    if (error !== budgetExceeded) throw error;
    mutationComplete = false;
    for (const file of virtual.values()) {
      relationshipFailures.add(file.fileName);
      budgetDiagnostic(file, "mutation analysis");
    }
  }
  const retainedIds = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const writePairs = new Map<string, string>(),
    writeOrdinals = new Map<string, number>();
  const writeOwners = new Map<(typeof mutationWrites)[number], string>();
  for (const write of mutationWrites) {
    const id = write.symbol?.declarations
      ?.map((d) => nodeIds.get(d))
      .find((id) => !!id && bindingIds.has(id) && retainedIds.has(id));
    const imported =
      requiredWrites(write)[0] ??
      (write.target ? importedTarget(write.target, true) : undefined);
    if ((!id && !imported) || !write.owner) continue;
    const identity = imported
      ? `import:${imported.file}:${imported.name}`
      : id!;
    const bindingName = imported ? imported.name : byId.get(id!)!.qualifiedName;
    const ownerNode = byId.get(write.owner);
    const key =
      identity +
      "\0" +
      write.owner +
      (ownerNode?.kind === "module" ? "\0" + write.site.pos : "");
    if (writePairs.has(key)) {
      writeOwners.set(write, writePairs.get(key)!);
      continue;
    }
    let writer = write.owner;
    if (ownerNode?.kind === "module") {
      if (nodes.length >= 99999 || edges.length >= 999999) {
        mutationComplete = false;
        relationshipFailures.add(write.site.getSourceFile().fileName);
        budgetDiagnostic(write.site.getSourceFile(), "binding writers");
        break;
      }
      const ordinal = writeOrdinals.get(identity) ?? 0;
      writeOrdinals.set(identity, ordinal + 1);
      writer = `${write.site.getSourceFile().fileName.slice(1)}#binding-write:${hash(identity).slice(0, 16)}@${ordinal}`;
      const signature = `write ${bindingName}`;
      const node = {
        id: writer,
        name: signature,
        qualifiedName: signature + " " + (ordinal + 1),
        kind: "binding" as const,
        span: span(write.site, write.site.getSourceFile()),
        signature,
        declarationHash: hash(signature),
        body: "present" as const,
        bodyHash: hash(print(write.site, write.site.getSourceFile())),
      };
      nodes.push(node);
      byId.set(writer, node);
      retainedIds.add(writer);
      bindingIds.add(writer);
      const via = write.via ? nodeIds.get(write.via) : undefined;
      if (via && retainedIds.has(via))
        edges.push({
          from: writer,
          to: via,
          targetName: byId.get(via)!.qualifiedName,
          kind: "references",
          resolution: "resolved",
          targetKind: "project",
          span: node.span,
        });
    }
    writePairs.set(key, writer);
    writeOwners.set(write, writer);
    if (id && writer !== id && retainedIds.has(writer))
      edges.push({
        from: id,
        to: writer,
        targetName: byId.get(writer)!.qualifiedName,
        kind: "written-by",
        resolution: "resolved",
        targetKind: "project",
        span: span(write.site, write.site.getSourceFile()),
      });
  }
  const referenceIds = new Set(
    nodes
      .filter((n) =>
        ["binding", "function", "method", "class"].includes(n.kind),
      )
      .map((n) => n.id),
  );
  // Methods depend on the decorator application as well as their own source.
  // Keep this edge even when dispatch is withheld; a decorator body change must
  // be reviewable through exact retained source, including imported decorators.
  for (const [declaration, id] of nodeIds) {
    if (
      !ts.isClassDeclaration(declaration) ||
      !(
        ts.getDecorators(declaration)?.length ||
        declaration.members.some(
          (member) =>
            ts.canHaveDecorators(member) && ts.getDecorators(member)?.length,
        )
      )
    )
      continue;
    for (const member of declaration.members) {
      const from = nodeIds.get(member);
      if (from && retainedIds.has(from) && retainedIds.has(id))
        edges.push({
          from,
          to: id,
          targetName: byId.get(id)!.qualifiedName,
          kind: "references",
          resolution: "resolved",
          targetKind: "project",
          span: span(declaration, declaration.getSourceFile()),
        });
      if (
        from &&
        retainedIds.has(from) &&
        ts.canHaveDecorators(member) &&
        ts.getDecorators(member)?.length
      )
        edges.push({
          from: id,
          to: from,
          targetName: byId.get(from)!.qualifiedName,
          kind: "references",
          resolution: "resolved",
          targetKind: "project",
          span: span(member, member.getSourceFile()),
        });
    }
  }
  const initializerBindings = new Map<ts.Node, string[]>();
  for (const [declaration, id] of nodeIds) {
    if (!ts.isBindingElement(declaration) || !bindingIds.has(id)) continue;
    let root: ts.Node = declaration.parent;
    while (
      ts.isBindingElement(root) ||
      ts.isObjectBindingPattern(root) ||
      ts.isArrayBindingPattern(root)
    )
      root = root.parent;
    if (!ts.isVariableDeclaration(root) || !root.initializer) continue;
    const bound = initializerBindings.get(root.initializer) ?? [];
    bound.push(id);
    initializerBindings.set(root.initializer, bound);
    for (const source of symbolAt(root.initializer)?.declarations ?? []) {
      const to = nodeIds.get(source);
      if (to && retainedIds.has(to) && to !== id)
        edges.push({
          from: id,
          to,
          targetName: byId.get(to)!.qualifiedName,
          kind: "references",
          resolution: "resolved",
          targetKind: "project",
          span: span(root.initializer, root.getSourceFile()),
        });
    }
  }
  const targetCache = new Map<ts.Symbol, string | null | undefined>();
  const receiverCaches = [
    new Map<ts.Symbol, boolean>(),
    new Map<ts.Symbol, boolean>(),
  ];
  type RequiredOrigin = {
    path: string;
    file?: ts.SourceFile;
    name?: string;
    nested?: true;
  };
  function requireOrigins(
    node: ts.Node,
    seen = new Set<ts.Symbol>(),
  ): RequiredOrigin[] {
    if (solvingOrigins) checkBudget();
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return requireOrigins(node.expression, seen);
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      const resolved = ts.resolveModuleName(
        node.arguments[0]!.text,
        node.getSourceFile().fileName,
        program.getCompilerOptions(),
        host,
      ).resolvedModule;
      if (!resolved) return [];
      const file = virtual.get(resolved.resolvedFileName);
      return [{ path: resolved.resolvedFileName, ...(file ? { file } : {}) }];
    }
    if (ts.isBinaryExpression(node)) {
      if (
        [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.CommaToken].includes(
          node.operatorToken.kind,
        )
      )
        return requireOrigins(node.right, seen);
      if (
        [
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.BarBarEqualsToken,
          ts.SyntaxKind.AmpersandAmpersandEqualsToken,
          ts.SyntaxKind.QuestionQuestionEqualsToken,
        ].includes(node.operatorToken.kind)
      )
        return [
          ...requireOrigins(node.left, new Set(seen)),
          ...requireOrigins(node.right, new Set(seen)),
        ];
    }
    if (ts.isConditionalExpression(node))
      return [
        ...requireOrigins(node.whenTrue, new Set(seen)),
        ...requireOrigins(node.whenFalse, new Set(seen)),
      ];
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const origins = requireOrigins(node.expression, seen);
      if (!origins.length) return [];
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : literalKey(node.argumentExpression);
      return origins.map((origin) => ({
        ...origin,
        ...(origin.name !== undefined
          ? { nested: true as const }
          : name !== undefined
            ? { name }
            : { nested: true as const }),
      }));
    }
    if (ts.isIdentifier(node)) {
      const symbol = requiredSymbolAt(node);
      return symbol ? (originValues.get(symbol) ?? []) : [];
    }
    return [];
  }
  function requireOrigin(node: ts.Node): RequiredOrigin | undefined {
    return requireOrigins(node)[0];
  }
  function requiredWrites(
    write: (typeof mutationWrites)[number],
  ): NonNullable<ObservedGraph["escapedImports"]> {
    if (!write.target || (ts.isIdentifier(write.target) && !write.receiver))
      return [];
    return requireOrigins(write.target).map((origin) => ({
      file: origin.path.slice(1),
      name: origin.name ?? "*",
      ...(origin.name === undefined
        ? { moduleObject: true as const }
        : origin.nested || write.receiver
          ? { memberObject: true as const }
          : {}),
    }));
  }
  function requiredEscapes(
    site: (typeof escapeSites)[number],
  ): NonNullable<ObservedGraph["escapedImports"]> {
    let value = site.site;
    // A receiver used to read/call a member is not an escape of its container.
    while (
      value.parent &&
      (((ts.isPropertyAccessExpression(value.parent) ||
        ts.isElementAccessExpression(value.parent)) &&
        value.parent.expression === value) ||
        ts.isParenthesizedExpression(value.parent) ||
        ts.isAsExpression(value.parent) ||
        ts.isTypeAssertionExpression(value.parent) ||
        ts.isNonNullExpression(value.parent) ||
        ts.isSatisfiesExpression(value.parent))
    )
      value = value.parent;
    const projected = requireOrigins(value);
    return (projected.length ? projected : requireOrigins(site.target)).map(
      (origin) => ({
        file: origin.path.slice(1),
        name: origin.name ?? "*",
        ...(origin.name === undefined
          ? { moduleObject: true as const }
          : { memberObject: true as const }),
      }),
    );
  }
  function stableCommonJS(node: ts.Node): boolean {
    const origin = requireOrigin(node);
    if (!origin) return true;
    if (!origin.file) return false;
    const pending = [origin.file],
      seen = new Set<ts.SourceFile>();
    while (pending.length) {
      checkBudget();
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      if (ambiguousExports.has(file)) return false;
      pending.push(...(exportForwards.get(file) ?? []));
    }
    // TypeScript can jump through a barrel or object export directly to a final
    // declaration. Check its captured source before any symbol-cache result.
    if (
      symbolAt(node)?.declarations?.some((d) =>
        ambiguousExports.has(d.getSourceFile()),
      )
    )
      return false;
    const writes = exportWrites.get(origin.file);
    return (
      !ambiguousExports.has(origin.file) &&
      (writes?.get("") ?? 0) <= 1 &&
      (origin.name === undefined || (writes?.get(origin.name) ?? 0) <= 1)
    );
  }
  function stableReceiver(
    expression: ts.Expression,
    callableIdentity = false,
  ): boolean {
    if (ts.isClassExpression(expression)) return false;
    if (!stableCommonJS(expression)) return false;
    const receiverCache = receiverCaches[callableIdentity ? 1 : 0]!;
    if (
      ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "require" &&
      expression.arguments.length === 1 &&
      ts.isStringLiteral(expression.arguments[0]!)
    ) {
      const resolved = ts.resolveModuleName(
        expression.arguments[0]!.text,
        expression.getSourceFile().fileName,
        program.getCompilerOptions(),
        host,
      ).resolvedModule;
      const file = resolved
        ? virtual.get(resolved.resolvedFileName)
        : undefined;
      if (file && ambiguousExports.has(file)) return false;
    }
    // Types/casts do not identify the runtime object or its overriding method.
    if (
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression)
    )
      return false;
    if (expression.kind === ts.SyntaxKind.ThisKeyword) {
      if (sourcePaths.size > virtual.size) return false;
      const owner = instanceClassForThis(expression);
      if (
        !owner ||
        !ts.isClassDeclaration(owner) ||
        owner.heritageClauses?.some(
          (c) => c.token === ts.SyntaxKind.ExtendsKeyword,
        )
      )
        return false;
      const symbol = symbolAt(owner.name ?? owner);
      if (
        symbol &&
        (extendedClasses.has(symbol) ||
          escaped.has(symbol) ||
          mutated.has(symbol))
      )
        return false;
    }

    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    )
      return stableReceiver(expression.expression, callableIdentity);
    if (
      ts.isObjectLiteralExpression(expression) &&
      expression.properties.some((p) =>
        ts.isSpreadAssignment(p)
          ? !stableReceiver(p.expression)
          : ts.isPropertyAssignment(p) &&
            p.name.getText() === "__proto__" &&
            !stableReceiver(p.initializer),
      )
    )
      return false;
    if (
      ts.isConditionalExpression(expression) ||
      ts.isBinaryExpression(expression)
    )
      return false;
    const symbol = symbolAt(expression);
    if (
      symbol &&
      ((!callableIdentity && escaped.has(symbol)) ||
        mutated.has(symbol) ||
        symbol.declarations?.some(ts.isParameter) ||
        (symbol.declarations?.filter(ts.isVariableDeclaration).length ?? 0) > 1)
    )
      return false;
    if (symbol?.declarations?.some(ts.isBindingElement)) {
      for (const declaration of symbol.declarations) {
        if (!ts.isBindingElement(declaration)) continue;
        let root: ts.Node = declaration.parent;
        while (
          ts.isBindingElement(root) ||
          ts.isObjectBindingPattern(root) ||
          ts.isArrayBindingPattern(root)
        )
          root = root.parent;
        if (
          !ts.isVariableDeclaration(root) ||
          !root.initializer ||
          !stableReceiver(root.initializer, callableIdentity)
        )
          return false;
      }
    }
    if (
      (ts.isPropertyAccessExpression(expression) ||
        ts.isElementAccessExpression(expression)) &&
      !stableReceiver(expression.expression)
    )
      return false;
    if (symbol) {
      if (receiverCache.has(symbol)) return receiverCache.get(symbol)!;
      receiverCache.set(symbol, false);
      const binding = symbol.declarations?.find(
        (
          d,
        ): d is
          | ts.VariableDeclaration
          | ts.PropertyAssignment
          | ts.PropertyDeclaration =>
          ts.isVariableDeclaration(d) ||
          ts.isPropertyAssignment(d) ||
          ts.isPropertyDeclaration(d),
      );
      const typedReceiver =
        binding &&
        "type" in binding &&
        binding.type &&
        !(
          binding.initializer &&
          (ts.isArrowFunction(binding.initializer) ||
            ts.isFunctionExpression(binding.initializer))
        );
      const stable =
        !typedReceiver &&
        (!binding?.initializer ||
          stableReceiver(binding.initializer, callableIdentity));
      receiverCache.set(symbol, stable);
      return stable;
    }
    if (ts.isNewExpression(expression)) {
      if (ts.isClassExpression(expression.expression)) return false;
      let symbol = symbolAt(expression.expression);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias)
        symbol = checker.getAliasedSymbol(symbol);
      if (
        symbol?.declarations?.some(
          (d) =>
            ts.isClassDeclaration(d) &&
            d.heritageClauses?.some(
              (c) => c.token === ts.SyntaxKind.ExtendsKeyword,
            ),
        )
      )
        return false;
      return stableReceiver(expression.expression);
    }
    if (ts.isCallExpression(expression))
      return (
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "require" &&
        expression.arguments.length === 1 &&
        ts.isStringLiteral(expression.arguments[0]!)
      );
    return true;
  }
  function staticProperty(
    value: ts.Expression,
    key: string,
    seen = new Set<ts.Symbol>(),
  ): string | undefined {
    if (
      ts.isParenthesizedExpression(value) ||
      ts.isAsExpression(value) ||
      ts.isNonNullExpression(value) ||
      ts.isSatisfiesExpression(value)
    )
      return staticProperty(value.expression, key, seen);
    if (ts.isIdentifier(value)) {
      let symbol = symbolAt(value);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias)
        symbol = checker.getAliasedSymbol(symbol);
      if (!symbol || seen.has(symbol) || mutated.has(symbol)) return undefined;
      seen.add(symbol);
      const declaration = symbol.declarations?.find(ts.isVariableDeclaration);
      return declaration?.initializer
        ? staticProperty(declaration.initializer, key, seen)
        : undefined;
    }
    if (
      !ts.isObjectLiteralExpression(value) ||
      value.properties.some(ts.isSpreadAssignment)
    )
      return undefined;
    const properties = value.properties.filter(
      (p) =>
        p.name &&
        (ts.isIdentifier(p.name) ||
          ts.isStringLiteral(p.name) ||
          ts.isNumericLiteral(p.name)) &&
        p.name.text === key,
    );
    if (properties.length !== 1) return undefined;
    const property = properties[0]!;
    if (
      ts.isGetAccessorDeclaration(property) ||
      ts.isSetAccessorDeclaration(property)
    )
      return undefined;
    const id = nodeIds.get(property);
    if (id && retainedIds.has(id) && !bindingIds.has(id)) return id;
    if (ts.isPropertyAssignment(property))
      return target(property.initializer) ?? undefined;
    if (ts.isShorthandPropertyAssignment(property)) {
      const symbol = checker.getShorthandAssignmentValueSymbol(property);
      const declaration = symbol?.declarations?.find(ts.isFunctionDeclaration);
      if (declaration && !mutated.has(symbol!)) return nodeIds.get(declaration);
    }
    return undefined;
  }
  function typeTarget(expression: ts.Node): string | null | undefined {
    // A type reference identifies a declaration, not a runtime dispatch value.
    // Mutating a class's static state cannot change that type identity.
    const symbol = symbolAt(expression);
    const ids = new Set(
      (symbol?.declarations ?? [])
        .filter(
          (declaration) =>
            ts.isClassDeclaration(declaration) ||
            ts.isInterfaceDeclaration(declaration) ||
            ts.isTypeAliasDeclaration(declaration) ||
            ts.isEnumDeclaration(declaration),
        )
        .map((declaration) => nodeIds.get(declaration))
        .filter((id): id is string => !!id && retainedIds.has(id)),
    );
    return ids.size === 1 ? [...ids][0] : ids.size ? undefined : null;
  }
  function target(expression: ts.Node): string | null | undefined {
    if (
      !mutationComplete ||
      declarationFailures.has(expression.getSourceFile().fileName)
    )
      return undefined;
    if (expression.kind === ts.SyntaxKind.SuperKeyword) {
      const owner = instanceClassForThis(expression);
      const symbol = owner && symbolAt(owner.name ?? owner);
      const base = owner?.heritageClauses?.find(
        (c) => c.token === ts.SyntaxKind.ExtendsKeyword,
      )?.types[0]?.expression;
      if (
        !owner ||
        !base ||
        (symbol && (mutated.has(symbol) || escaped.has(symbol))) ||
        !stableReceiver(base, true)
      )
        return undefined;
    }
    if (!stableCommonJS(expression)) return undefined;
    if (ts.isIdentifier(expression) && !stableReceiver(expression, true))
      return undefined;
    if (
      ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)
    ) {
      if (!stableReceiver(expression.expression)) return undefined;
      const key = ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : ts.isStringLiteral(expression.argumentExpression)
          ? expression.argumentExpression.text
          : null;
      const moduleDeclarations =
        checker.getTypeAtLocation(expression.expression).getSymbol()
          ?.declarations ?? [];
      for (const declaration of moduleDeclarations) {
        if (ambiguousExports.has(declaration.getSourceFile())) return undefined;
        if (ts.isSourceFile(declaration)) {
          if (ambiguousExports.has(declaration)) return undefined;
          const writes = exportWrites.get(declaration);
          if (
            (writes?.get("") ?? 0) > 1 ||
            (key !== null && (writes?.get(key) ?? 0) > 1)
          )
            return undefined;
        }
      }
    }
    if (ts.isElementAccessExpression(expression)) {
      const key = checker.getTypeAtLocation(expression.argumentExpression);
      if (
        !(
          key.flags &
          (ts.TypeFlags.StringLiteral |
            ts.TypeFlags.NumberLiteral |
            ts.TypeFlags.UniqueESSymbol)
        )
      )
        return undefined; // Do not fall back to an ambiguous computed signature.
    }
    let symbol = symbolAt(expression);
    if (
      !symbol &&
      ts.isElementAccessExpression(expression) &&
      (ts.isStringLiteral(expression.argumentExpression) ||
        ts.isNumericLiteral(expression.argumentExpression))
    )
      symbol = checker
        .getTypeAtLocation(expression.expression)
        .getProperty(expression.argumentExpression.text);

    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    if (!symbol) return null;
    const declarations = symbol?.declarations ?? [];
    if (
      declarations.some((d) =>
        declarationFailures.has(d.getSourceFile().fileName),
      )
    )
      return undefined;
    if (declarations.some((d) => writtenInstanceMembers.has(d)))
      return undefined;
    if (targetCache.has(symbol)) return targetCache.get(symbol);
    if (
      declarations.some(
        (d) => ts.isGetAccessorDeclaration(d) || ts.isSetAccessorDeclaration(d),
      )
    )
      return undefined;
    if (
      declarations.filter(
        (d) =>
          (ts.isPropertyAccessExpression(d) ||
            ts.isElementAccessExpression(d)) &&
          ts.isBinaryExpression(d.parent) &&
          d.parent.left === d &&
          commonjsName(d, unwrap(d.parent.right), true) !== null,
      ).length > 1
    )
      return undefined;
    if (
      mutated.has(symbol) ||
      declarations.some(ts.isParameter) ||
      declarations.filter(ts.isVariableDeclaration).length > 1 ||
      (declarations.some(ts.isBindingElement) &&
        !stableReceiver(expression as ts.Expression))
    )
      return undefined;
    const assignedExport = declarations.find(
      (d) =>
        (ts.isPropertyAccessExpression(d) || ts.isElementAccessExpression(d)) &&
        ts.isBinaryExpression(d.parent) &&
        d.parent.left === d &&
        commonjsName(d, unwrap(d.parent.right), true) !== null,
    );
    if (
      assignedExport &&
      ts.isBinaryExpression(assignedExport.parent) &&
      (ts.isIdentifier(assignedExport.parent.right) ||
        ts.isPropertyAccessExpression(assignedExport.parent.right))
    ) {
      targetCache.set(symbol, undefined);
      const resolved = target(assignedExport.parent.right);
      targetCache.set(symbol, resolved);
      return resolved;
    }
    const destructured = declarations.find(ts.isBindingElement);
    if (destructured) {
      targetCache.set(symbol, undefined);
      const pattern = destructured.parent,
        root = pattern.parent;
      const name = destructured.propertyName ?? destructured.name;
      const resolved =
        !destructured.initializer &&
        ts.isObjectBindingPattern(pattern) &&
        ts.isVariableDeclaration(root) &&
        root.initializer &&
        (ts.isIdentifier(name) || ts.isStringLiteral(name))
          ? staticProperty(root.initializer, name.text)
          : undefined;
      targetCache.set(symbol, resolved);
      return resolved;
    }
    const binding = declarations.find(ts.isVariableDeclaration);
    if (
      binding?.initializer &&
      (!nodeIds.has(binding) || bindingIds.has(nodeIds.get(binding)!))
    ) {
      let value = binding.initializer;
      while (
        ts.isParenthesizedExpression(value) ||
        ts.isAsExpression(value) ||
        ts.isNonNullExpression(value) ||
        ts.isSatisfiesExpression(value)
      )
        value = value.expression;
      // Follow actual static aliases, not a structurally compatible call signature.
      // TypeScript may collapse a choice of several functions into one signature.
      targetCache.set(symbol, undefined);
      if (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value)) {
        const resolved = target(value);
        targetCache.set(symbol, resolved);
        return resolved;
      }
      const require =
        ts.isCallExpression(value) &&
        ts.isIdentifier(value.expression) &&
        value.expression.text === "require" &&
        value.arguments.length === 1 &&
        ts.isStringLiteral(value.arguments[0]!);
      if (!require) return undefined;
    }
    const ids = [
      ...new Set(
        declarations
          .map((declaration) => nodeIds.get(declaration))
          .filter(
            (id): id is string =>
              !!id && retainedIds.has(id) && !bindingIds.has(id),
          ),
      ),
    ];
    const bodies = ids.filter((id) => implemented.has(id));
    const candidates = bodies.length ? bodies : ids;
    const resolved =
      candidates.length > 1 ? undefined : (candidates[0] ?? null);
    targetCache.set(symbol, resolved);
    return resolved;
  }
  const builtinNames = new Set([
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ReferenceError",
    "AggregateError",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Promise",
    "Array",
    "Object",
    "String",
    "Number",
    "Boolean",
    "BigInt",
    "Symbol",
    "RegExp",
    "Date",
    "Math",
    "JSON",
    "Reflect",
    "Proxy",
    "Intl",
    "console",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "encodeURIComponent",
    "decodeURIComponent",
    "undefined",
  ]);
  function targetLabel(node: ts.Node, file: ts.SourceFile): string {
    if (ts.isPropertyAccessExpression(node))
      return (
        targetLabel(node.expression, file) +
        (node.questionDotToken ? "?." : ".") +
        node.name.getText(file)
      );
    if (ts.isQualifiedName(node))
      return targetLabel(node.left, file) + "." + node.right.getText(file);
    return print(node, file)
      .replace(/\r?\n[ \t]*/g, " ")
      .trim();
  }
  function targetKind(
    expression: ts.Node,
    resolved: string | null,
  ): "project" | "builtin" | "external-package" | "local-binding" | "unknown" {
    if (resolved) return "project";
    let root = expression;
    while (
      ts.isPropertyAccessExpression(root) ||
      ts.isElementAccessExpression(root) ||
      ts.isQualifiedName(root)
    )
      root = ts.isQualifiedName(root) ? root.left : root.expression;
    const symbol = checker.getSymbolAtLocation(root);
    for (const declaration of symbol?.declarations ?? []) {
      let parent: ts.Node | undefined = declaration;
      while (
        parent &&
        !ts.isImportDeclaration(parent) &&
        !ts.isSourceFile(parent)
      )
        parent = parent.parent;
      if (
        parent &&
        ts.isImportDeclaration(parent) &&
        ts.isStringLiteral(parent.moduleSpecifier)
      )
        return parent.moduleSpecifier.text.startsWith(".")
          ? "unknown"
          : "external-package";
    }
    if (
      symbol?.declarations?.some((d) => virtual.has(d.getSourceFile().fileName))
    )
      return "local-binding";
    return ts.isIdentifier(root) && builtinNames.has(root.text)
      ? "builtin"
      : "unknown";
  }
  function importedTarget(
    expression: ts.Node,
    writing = false,
    importedSymbol?: ts.Symbol,
  ) {
    const dynamic = writing ? dynamicImportTarget(expression) : undefined;
    if (dynamic) return { file: dynamic.slice(1), name: "*" };
    let root = expression,
      name: string | undefined,
      defaultMember = false;
    if (
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression)
    ) {
      root = expression.expression;
      name = expression.name.text;
    } else if (
      ts.isQualifiedName(expression) &&
      ts.isIdentifier(expression.left)
    ) {
      root = expression.left;
      name = expression.right.text;
    }
    if (!ts.isIdentifier(root)) return undefined;
    const symbol = importedSymbol ?? checker.getSymbolAtLocation(root);
    if (!writing && symbol && mutated.has(symbol)) return undefined;
    let binding: ts.Node | undefined;
    for (const d of symbol?.declarations ?? []) {
      if (ts.isImportSpecifier(d) && name === undefined) {
        name = (d.propertyName ?? d.name).text;
        binding = d;
        break;
      }
      if (ts.isImportClause(d) && (name === undefined || writing) && d.name) {
        defaultMember = writing;
        name = "default";
        binding = d;
        break;
      }
      if (ts.isNamespaceImport(d) && (name !== undefined || writing)) {
        if (name === undefined) name = "*";
        binding = d;
        break;
      }
    }
    if (!binding || name === undefined) return undefined;
    while (binding && !ts.isImportDeclaration(binding))
      binding = binding.parent;
    if (!binding || !ts.isStringLiteral(binding.moduleSpecifier))
      return undefined;
    const resolved = ts.resolveModuleName(
      binding.moduleSpecifier.text,
      expression.getSourceFile().fileName,
      program.getCompilerOptions(),
      host,
    ).resolvedModule;
    return resolved
      ? {
          file: resolved.resolvedFileName.slice(1),
          name,
          ...(defaultMember ? { memberObject: true as const } : {}),
        }
      : undefined;
  }
  const referencePairs = new Set<string>();
  for (const file of virtual.values()) {
    if (declarationFailures.has(file.fileName)) continue;
    const visit = (node: ts.Node) => {
      checkBudget();
      if (
        ts.isCallExpression(node) ||
        ts.isNewExpression(node) ||
        ts.isTypeReferenceNode(node)
      ) {
        const expression = ts.isTypeReferenceNode(node)
          ? node.typeName
          : node.expression;
        const resolved = ts.isTypeReferenceNode(node)
          ? typeTarget(expression)
          : target(expression);
        const to = resolved ?? null;
        const imported = !to ? importedTarget(expression) : undefined;
        edges.push({
          ...(imported ? { importTarget: imported } : {}),
          from: owners.get(node)!,
          to,
          targetName: targetLabel(expression, file),
          kind: ts.isTypeReferenceNode(node) ? "uses-type" : "calls",
          resolution: to ? "resolved" : "unresolved",
          targetKind: targetKind(expression, to),
          span: span(node, file),
        });
        for (
          let ancestor: ts.Node | undefined = node;
          ancestor && !ts.isStatement(ancestor);
          ancestor = ancestor.parent
        ) {
          checkBudget();
          for (const from of initializerBindings.get(ancestor) ?? []) {
            checkBudget();
            edges.push({ ...edges.at(-1)!, from, span: span(node, file) });
          }
        }
      } else if (
        (ts.isIdentifier(node) ||
          ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)) &&
        !ts.isTypeNode(node.parent) &&
        !ts.isImportSpecifier(node.parent) &&
        !ts.isImportClause(node.parent) &&
        !ts.isNamespaceImport(node.parent) &&
        !(
          (ts.isCallExpression(node.parent) ||
            ts.isNewExpression(node.parent)) &&
          node.parent.expression === node
        ) &&
        !(
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node
        ) &&
        !("name" in node.parent && node.parent.name === node)
      ) {
        const property =
          ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node);
        const symbol = symbolAt(node);
        let declarations = symbol?.declarations ?? [];
        if (property)
          declarations = declarations.flatMap((d) =>
            ts.isEnumMember(d) ? [d.parent] : [d],
          );
        let ids = [
          ...new Set(
            declarations
              .map((d) => nodeIds.get(d))
              .filter(
                (id): id is string =>
                  !!id &&
                  referenceIds.has(id) &&
                  (!property ||
                    stableReceiver(node.expression) ||
                    (node.expression.kind === ts.SyntaxKind.ThisKeyword &&
                      declarations.some(ts.isPropertyDeclaration)) ||
                    (!!symbolAt(node.expression)?.declarations?.some(
                      ts.isClassDeclaration,
                    ) &&
                      declarations.some(
                        (d) =>
                          ts.isPropertyDeclaration(d) &&
                          d.modifiers?.some(
                            (m) => m.kind === ts.SyntaxKind.StaticKeyword,
                          ),
                      ))),
              ),
          ),
        ];
        if (property && !ids.length)
          ids = [
            ...new Set(
              (symbolAt(node.expression)?.declarations ?? [])
                .map((d) => nodeIds.get(d))
                .filter((id): id is string => !!id && bindingIds.has(id)),
            ),
          ];
        const imported =
          ids.length === 0
            ? property
              ? (importedTarget(node) ?? importedTarget(node.expression))
              : !symbol?.declarations?.length
                ? importedTarget(node)
                : undefined
            : undefined;
        const importPair = imported
          ? owners.get(node) + "\0" + imported.file + "\0" + imported.name
          : undefined;
        if (imported && importPair && !referencePairs.has(importPair)) {
          referencePairs.add(importPair);
          edges.push({
            from: owners.get(node)!,
            to: null,
            targetName: targetLabel(node, file),
            kind: "references",
            resolution: "unresolved",
            targetKind: "unknown",
            span: span(node, file),
            importTarget: imported,
          });
        }
        const pair = owners.get(node) + "\0" + ids[0];
        if (
          ids.length === 1 &&
          ids[0] !== owners.get(node) &&
          !referencePairs.has(pair)
        ) {
          referencePairs.add(pair);
          edges.push({
            from: owners.get(node)!,
            to: ids[0]!,
            targetName: targetLabel(node, file),
            kind: "references",
            resolution: "resolved",
            targetKind: "project",
            span: span(node, file),
          });
        }
      } else if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const resolved = ts.resolveModuleName(
          node.moduleSpecifier.text,
          file.fileName,
          program.getCompilerOptions(),
          host,
        ).resolvedModule;
        const to = resolved
          ? (nodeIds.get(virtual.get(resolved.resolvedFileName)!) ?? null)
          : null;
        edges.push({
          from: nodeIds.get(file)!,
          to,
          targetName: node.moduleSpecifier.text,
          kind: "imports",
          ...(!to && resolved
            ? {
                importTarget: {
                  file: resolved.resolvedFileName.slice(1),
                  name: "*module*",
                },
              }
            : {}),
          resolution: to ? "resolved" : "unresolved",
          targetKind: to
            ? "project"
            : node.moduleSpecifier.text.startsWith(".")
              ? "unknown"
              : "external-package",
          span: span(node, file),
        });
      }
      ts.forEachChild(node, visit);
    };
    beginFile(file);
    const firstEdge = edges.length;
    try {
      visit(file);
    } catch (error) {
      if (error !== budgetExceeded) throw error;
      edges.splice(firstEdge);
      relationshipFailures.add(file.fileName);
      budgetDiagnostic(file, "relationships");
    }
  }
  function literalExportObject(
    node: ts.Node,
    seen = new Set<ts.Node>(),
  ): ts.ObjectLiteralExpression | undefined {
    checkBudget();
    if (seen.has(node)) return;
    seen.add(node);
    if (ts.isExpression(node)) node = unwrap(node);
    if (ts.isObjectLiteralExpression(node)) return node;
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      ts.isBinaryExpression(node.parent) &&
      node.parent.left === node
    )
      return literalExportObject(node.parent.right, seen);
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) &&
      node.initializer
    )
      return literalExportObject(node.initializer, seen);
    if (ts.isExportAssignment(node))
      return literalExportObject(node.expression, seen);
    for (const d of symbolAt(node)?.declarations ?? []) {
      const object = literalExportObject(d, seen);
      if (object) return object;
    }
    return;
  }
  const opaqueExportFiles: string[] = [];
  const observedExports: NonNullable<ObservedGraph["exports"]> = [];
  function exportIds(node: ts.Node, seen = new Set<ts.Node>()): string[] {
    checkBudget();
    if (seen.has(node)) return [];
    seen.add(node);
    const direct = nodeIds.get(node);
    if (direct && retainedIds.has(direct)) return [direct];
    if (ts.isExpression(node)) node = unwrap(node);
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      ts.isBinaryExpression(node.parent) &&
      node.parent.left === node
    )
      return exportIds(node.parent.right, seen);
    if (
      (ts.isPropertyAssignment(node) || ts.isVariableDeclaration(node)) &&
      node.initializer
    )
      return exportIds(node.initializer, seen);
    if (ts.isExportAssignment(node)) return exportIds(node.expression, seen);
    const symbol = symbolAt(node);
    return [
      ...new Set(
        (symbol?.declarations ?? []).flatMap((d) => exportIds(d, seen)),
      ),
    ];
  }
  for (const file of virtual.values()) {
    if (
      declarationFailures.has(file.fileName) ||
      parseFailures.has(file.fileName)
    )
      continue;
    const module = sourceModule(file);
    if (!module) continue;
    const seenNames = new Set<string>();
    function retainExport(
      exported: ts.Symbol,
      name: string,
      depth = 0,
      ancestors = new Set<ts.Symbol>(),
    ) {
      checkBudget();
      if (seenNames.has(name) || depth > 8 || ancestors.has(exported)) return;
      seenNames.add(name);
      ancestors.add(exported);
      let symbol =
        exported.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exported)
          : exported;
      const declarations = symbol.declarations ?? [];
      const ids = [...new Set(declarations.flatMap((d) => exportIds(d)))];
      const bodies = ids.filter((id) => implemented.has(id)),
        candidates = bodies.length ? bodies : ids;
      const mutable =
        (exportWrites.get(file)?.get(name) ?? 0) > 1 ||
        (exportWrites.get(file)?.get("") ?? 0) > 1 ||
        mutated.has(symbol) ||
        (escaped.has(symbol) &&
          !declarations.some(
            (d) =>
              ts.isFunctionDeclaration(d) ||
              (ts.isVariableDeclaration(d) &&
                d.initializer &&
                (ts.isArrowFunction(d.initializer) ||
                  ts.isFunctionExpression(d.initializer))),
          ));
      observedExports.push({
        file: file.fileName.slice(1),
        name,
        nodeId: candidates.length === 1 ? candidates[0]! : nodeIds.get(file)!,
        ...(mutable || candidates.length !== 1
          ? {
              mutable: true,
              callableMutable:
                (exportWrites.get(file)?.get(name) ?? 0) > 1 ||
                (exportWrites.get(file)?.get("") ?? 0) > 1 ||
                mutated.has(symbol),
            }
          : {}),
      });
      const declaration = symbol.valueDeclaration ?? declarations[0];
      if (
        !declaration ||
        candidates.some((id) =>
          ["function", "method"].includes(byId.get(id)?.kind ?? ""),
        )
      )
        return;
      if (ts.isExternalModule(file)) return;
      const object = literalExportObject(declaration);
      if (!object) return;
      for (const property of object.properties) {
        checkBudget();
        if (
          !property.name ||
          (!ts.isIdentifier(property.name) &&
            !ts.isStringLiteralLike(property.name) &&
            !ts.isNumericLiteral(property.name))
        )
          continue;
        const member = symbolAt(property.name);
        if (member)
          retainExport(
            member,
            name + "." + property.name.text,
            depth + 1,
            new Set(ancestors),
          );
      }
    }
    beginFile(file);
    try {
      const values = ts.isExternalModule(file)
        ? checker.getExportsOfModule(module)
        : [...(module.exports?.values() ?? [])];
      for (const exported of values) {
        if (exported.name !== "export=") {
          retainExport(exported, exported.name);
          continue;
        }
        retainExport(exported, "default");
        for (const declaration of exported.declarations ?? []) {
          const object = literalExportObject(declaration);
          for (const property of object?.properties ?? []) {
            checkBudget();
            if (
              !property.name ||
              (!ts.isIdentifier(property.name) &&
                !ts.isStringLiteralLike(property.name) &&
                !ts.isNumericLiteral(property.name))
            )
              continue;
            const member = symbolAt(property.name);
            if (member) retainExport(member, property.name.text);
          }
        }
      }
    } catch (error) {
      if (error !== budgetExceeded) throw error;
      opaqueExportFiles.push(file.fileName.slice(1));
      relationshipFailures.add(file.fileName);
      budgetDiagnostic(file, "export metadata");
    }
  }
  if (!originsComplete)
    for (const edge of edges)
      if (
        edge.kind === "calls" &&
        edge.to &&
        !(
          originIndependentTargets.has(edge.to) &&
          byId.get(edge.to)?.span.file === edge.span.file &&
          edge.targetName === byId.get(edge.to)?.name
        )
      ) {
        edge.to = null;
        edge.resolution = "unresolved";
        edge.targetKind = "unknown";
      }
  const observedFiles = files.map((file) => ({
    path: file.path,
    hash: file.hash,
    bytes: Buffer.byteLength(file.text),
    text: file.text,
    coverage: {
      declarations:
        parseFailures.has("/" + file.path) ||
        declarationFailures.has("/" + file.path)
          ? ("partial" as const)
          : ("complete" as const),
      relationships:
        parseFailures.has("/" + file.path) ||
        relationshipFailures.has("/" + file.path) ||
        edges.some(
          (e) => e.span.file === file.path && e.resolution === "unresolved",
        )
          ? ("partial" as const)
          : ("complete" as const),
    },
  }));
  const importedWrites = [
    ...new Map(
      mutationWrites.flatMap((write) => {
        const targets = requiredWrites(write);
        const imported = write.target
          ? importedTarget(write.target, true)
          : undefined;
        if (imported) targets.push(imported);
        const writer = writeOwners.get(write) ?? write.owner;
        if (!retainedIds.has(writer)) return [];
        return targets.map((imported) => {
          const value = {
            ...imported,
            writer,
            span: span(write.site, write.site.getSourceFile()),
          };
          return [JSON.stringify(value), value] as const;
        });
      }),
    ).values(),
  ];
  const escapedImports = [
    ...new Map([
      ...escapeSites.flatMap((s) => {
        const targets = requiredEscapes(s);
        const imported = importedTarget(s.target, true);
        if (imported) targets.push(imported);
        return targets.map((value) => [JSON.stringify(value), value] as const);
      }),
      ...[...escapedModuleObjects].map((file) => {
        const imported = {
          file: file.slice(1),
          name: "*",
          moduleObject: true as const,
        };
        return [JSON.stringify(imported), imported] as const;
      }),
    ]).values(),
  ];
  const inheritanceOrigins: NonNullable<ObservedGraph["inheritanceOrigins"]> =
    [];
  const classIds = new Set(
    nodes.filter((n) => n.kind === "class").map((n) => n.id),
  );
  let inheritanceFile: ts.SourceFile | undefined;
  for (const family of inheritanceFamilies) {
    const file = family.owner.getSourceFile();
    if (declarationFailures.has(file.fileName)) continue;
    if (inheritanceFile !== file) {
      beginFile(file);
      inheritanceFile = file;
    }
    try {
      checkBudget();
      const symbol =
        symbolAt(family.owner.name ?? family.owner) ??
        checker.getTypeAtLocation(family.owner).getSymbol();
      const binding =
        ts.isClassExpression(family.owner) &&
        ts.isVariableDeclaration(family.owner.parent)
          ? symbolAt(family.owner.parent.name)
          : undefined;
      const uncertain = !!(
        (symbol && (mutated.has(symbol) || escaped.has(symbol))) ||
        (binding && (mutated.has(binding) || escaped.has(binding)))
      );
      const identity = nodeIds.get(family.owner);
      const owner =
        identity && (classIds.has(identity) || bindingIds.has(identity))
          ? identity
          : nodeIds.get(file)!;
      if (!retainedIds.has(owner)) continue;
      for (const base of family.bases) {
        checkBudget();
        const candidates = new Set<string>();
        const collect = (type: ts.Type) => {
          checkBudget();
          if (type.isUnionOrIntersection()) {
            for (const t of type.types) collect(t);
            return;
          }
          for (const d of type.getSymbol()?.declarations ?? []) {
            const id = nodeIds.get(d);
            if (id && classIds.has(id)) candidates.add(id);
          }
        };
        collect(checker.getTypeAtLocation(base));
        for (const d of symbolAt(base)?.declarations ?? []) {
          const id = nodeIds.get(d);
          if (id && classIds.has(id)) candidates.add(id);
        }
        const imported = importedTarget(base, true);
        for (const id of candidates)
          inheritanceOrigins.push({
            owner,
            base: id,
            ...(uncertain ? { uncertain: true as const } : {}),
          });
        if (imported && !candidates.size)
          inheritanceOrigins.push({
            owner,
            base: null,
            importTarget: { file: imported.file, name: imported.name },
            ...(uncertain ? { uncertain: true as const } : {}),
          });
      }
    } catch (error) {
      if (error !== budgetExceeded) throw error;
      relationshipFailures.add(file.fileName);
      originsComplete = false;
      budgetDiagnostic(file, "inheritance origins");
    }
  }
  const reader = {
    id: "typescript-ast/v21",
    version: `${identity.version}; TypeScript ${ts.version}`,
  };
  const identityHash = createHash("sha256").update(
    json({
      reader,
      projectId: options.projectId ?? null,
      resolutionScope: [...sourcePaths].sort(compareText),
    }),
  );
  for (const file of observedFiles)
    identityHash.update("\n").update(
      json({
        path: file.path,
        hash: file.hash,
        bytes: file.bytes,
        coverage: file.coverage,
      }),
    );
  return qualifyObservation({
    schema: "pymtheg.observed-graph/v1",
    snapshotId: identityHash.digest("hex"),
    projectId: options.projectId ?? null,
    version,
    reader,
    staleFiles: [],
    dependencyModel: "lexical-v2",
    moduleObjectAliases: [
      ...[...forwardedModuleObjects].flatMap((file) =>
        [...(exportObjectAliases.get(file) ?? [])].map((target) => ({
          file: file.slice(1),
          target: target.slice(1),
        })),
      ),
    ],
    opaqueExportFiles,
    originIndependentTargets: [...originIndependentTargets].filter((id) =>
      retainedIds.has(id),
    ),
    ...(!originsComplete ? { requireOriginsIncomplete: true as const } : {}),
    commonjsFiles: [...virtual.values()]
      .filter((file) => !!sourceModule(file) && !ts.isExternalModule(file))
      .map((file) => file.fileName.slice(1)),
    moduleMemberAliases,
    inheritanceOrigins,
    inheritanceForwards,
    importedWrites,
    escapedImports,
    exports: observedExports,
    scope: {
      files: files.map((file) => file.path),
      discoveryComplete: options.discoveryComplete ?? true,
    },
    files: observedFiles,
    nodes,
    edges,
    diagnostics,
    coverage: {
      declarations:
        diagnostics.length || options.discoveryComplete === false
          ? "partial"
          : "complete",
      relationships:
        diagnostics.length ||
        edges.some((edge) => edge.resolution === "unresolved") ||
        options.discoveryComplete === false
          ? "partial"
          : "complete",
    },
    completeness:
      diagnostics.length ||
      edges.some((edge) => edge.resolution === "unresolved") ||
      options.discoveryComplete === false
        ? "partial"
        : "complete",
    limitations: [
      ...(declarationFailures.size || relationshipFailures.size
        ? [
            `Observation budget omitted declarations in ${declarationFailures.size} of ${files.length} files and relationships in ${relationshipFailures.size} files (${bytes} source bytes; ${visits} visits, limit ${visitBudget}). Capture a narrower source scope. Affected files: ${[
              ...new Set([...declarationFailures, ...relationshipFailures]),
            ]
              .slice(0, 10)
              .map((f) => f.slice(1))
              .join(
                ", ",
              )}${new Set([...declarationFailures, ...relationshipFailures]).size > 10 ? "; additional affected files are listed in capture diagnostics" : ""}.`,
          ]
        : []),
      "Observed bodies and signatures do not prove implementation correctness.",
      "Dependency tracking covers captured lexical bindings and resolved calls/types only; dynamic, external and cross-partition dependencies remain unknown.",
      "External and dynamic call targets remain unresolved; their absence cannot establish a missing implementation.",
      "Lexical references retain the first source site per declaration/target pair; they are dependencies, not a count of all read sites.",
      "Anonymous callbacks are attributed to their containing named declaration.",
      "Overload declarations have distinct observation identities; matching across changes requires review.",
    ],
  });
}
