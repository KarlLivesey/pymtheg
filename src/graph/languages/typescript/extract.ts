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
import { bindingSpecifier, type Provenance } from "./provenance.js";
import {
  anchorOf,
  containerOf,
  identityOf,
  isEntityName,
  isCommonJsRequire,
  isJsFile,
  isModuleGlobal,
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
  provenance: Provenance,
  incompleteConfig: boolean,
): ParseResult {
  const path = file.fileName.slice(1);
  const symbols: SymbolDraft[] = [];
  const links: LinkDraft[] = [];
  const keys = new Set<string>();
  const moduleKey = keyOf(file);
  const range = (node: ts.Node) => ({
    start: node.getStart(file),
    end: node.end,
  });

  function targetsOf(
    query: Lookup | ts.Symbol | undefined,
    meaning: Meaning,
  ): Targets {
    const found: Lookup =
      query && "flags" in query ? { symbol: query } : (query ?? {});
    const receiver = found.receiver;
    if (found.reason) return { targets: [], reason: found.reason, receiver };
    if (!found.symbol) return { targets: [], reason: "no-symbol", receiver };
    const facts = new Map<string, TargetFact>();
    let external = 0;
    let local = 0;
    let shadowed = 0;
    let viaAlias = false;
    let firstAlias: ts.Symbol | undefined;
    const record = (declaration: ts.Declaration): boolean => {
      const target = fromVirtual(declaration.getSourceFile().fileName);
      if (target === undefined || !captured.has(target)) return false;
      const anchor = anchorOf(declaration);
      if (!anchor) return false;
      const key = keyOf(anchor);
      facts.set(`${target}\0${key}`, { file: target, key });
      return true;
    };
    const visit = (value: ts.Symbol, depth: number) => {
      // Follow aliases one step at a time; a step whose declaration carries a
      // shadowed-require value ends the walk there (at that declaration if it
      // is a graph symbol), never in the module the compiler misbound it to.
      let current = value;
      for (const step of provenance.aliasSteps(value)) {
        current = step;
        if (provenance.declares(step)) {
          const anchored = (step.declarations ?? []).filter(record);
          if (!anchored.length) shadowed++;
          return;
        }
        if (step.flags & ts.SymbolFlags.Alias) {
          viaAlias = true;
          firstAlias ??= step;
        }
      }
      if (current.flags & ts.SymbolFlags.Alias)
        current = checker.getAliasedSymbol(current);
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
    if (!external && !local && !shadowed)
      return { targets, viaAlias, receiver };
    // An alias whose module did not resolve keeps that module's reason.
    const moduleFailure =
      external && !targets.length && firstAlias && bindingReason(firstAlias);
    return {
      targets,
      reason: shadowed
        ? "shadowed-require"
        : local
          ? "local"
          : moduleFailure || "external",
      viaAlias,
      receiver,
    };
  }
  function bindingReason(symbol: ts.Symbol): string | undefined {
    const specifier = bindingSpecifier(symbol);
    return specifier && moduleReason(specifier);
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
    if (
      incompleteConfig &&
      reason !== "shadowed-require" &&
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
    if (checker.getSymbolAtLocation(specifier)) return undefined;
    const text = specifier.text;
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
    const found = reason
      ? { targets: [], reason }
      : targetsOf(checker.getSymbolAtLocation(specifier), "any");
    link(owner, "imports", specifier.text, specifier, found, {
      specifier: specifier.text,
      ...extra,
    });
  }
  const symbolOf = (node: ts.Node) => checker.getSymbolAtLocation(node);

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
  /** The checker's symbol for a name, judged by the provenance of its receiver. */
  function lookup(node: ts.Node): Lookup {
    const receiver = receiverOf(node);
    if (receiver) {
      if (
        ts.isQualifiedName(receiver as ts.Node)
          ? (() => {
              const root = rootOf(receiver);
              const symbol = root && symbolOf(root);
              return !!symbol && provenance.symbol(symbol);
            })()
          : provenance.expression(receiver)
      )
        return { reason: "shadowed-require", receiver };
    }
    const symbol = symbolOf(node);
    if (!symbol && receiver) {
      // A member of a binding whose module did not resolve keeps that reason.
      const root = rootOf(receiver);
      const rootSymbol = root && symbolOf(root);
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
    const reason = specifier && moduleReason(specifier);
    link(
      owner,
      kind,
      importedName,
      at,
      reason
        ? { targets: [], reason }
        : targetsOf(symbolOf(name), extra.typeOnly ? "type" : "any"),
      extra,
    );
  }

  function visit(node: ts.Node, owner: string) {
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
      return;
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
            : checker.getExportSpecifierLocalTargetSymbol(element);
          const only = typeOnly || element.isTypeOnly;
          const reason = specifier && moduleReason(specifier);
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
      return;
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
      return;
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
      return;
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
        node.expression.text === "require" &&
        node.arguments.length === 1 &&
        !ts.isStringLiteralLike(node.arguments[0]!) &&
        isJsFile(file) &&
        isModuleGlobal(node.expression)
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
        moduleLink(owner, node.arguments[0] as ts.StringLiteralLike, {
          require: true,
        });
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
              { require: true },
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
                  { require: true },
                  node.arguments[0],
                );
        }
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
      link(
        owner,
        kind,
        isEntityChain(expression) ? expression.getText(file) : "(expression)",
        node.expression,
        targetsOf(
          lookup(at),
          ts.isInterfaceDeclaration(node.parent.parent) || kind === "implements"
            ? "type"
            : "value",
        ),
      );
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (
        ts.isLiteralTypeNode(argument) &&
        ts.isStringLiteralLike(argument.literal)
      )
        moduleLink(owner, argument.literal, { typeOnly: true });
    }
    ts.forEachChild(node, (child) => visit(child, owner));
  }
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
  return {
    status: diagnostics.length ? "partial" : "clean",
    diagnostics,
    symbols,
    links,
    data,
  };
}
