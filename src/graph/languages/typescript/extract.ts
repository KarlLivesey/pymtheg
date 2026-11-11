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
  anchorOf,
  containerOf,
  identityOf,
  isEntityName,
  isJsFile,
  isRequireCall,
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
type Meaning = "value" | "type" | "any";
interface Targets {
  targets: TargetFact[];
  /** Why there is no complete target set: external, local, no-symbol, missing-module, external-package. */
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
const TYPE_ONLY = new Set([
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.TypeParameter,
]);
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

  function targetsOf(symbol: ts.Symbol | undefined, meaning: Meaning): Targets {
    if (!symbol) return { targets: [], reason: "no-symbol" };
    const facts = new Map<string, TargetFact>();
    let external = 0;
    let local = 0;
    const visit = (value: ts.Symbol, depth: number) => {
      let current = value;
      if (current.flags & ts.SymbolFlags.Alias)
        current = checker.getAliasedSymbol(current);
      let declarations = current.declarations ?? [];
      if (meaning !== "any" && declarations.length > 1) {
        const filtered = declarations.filter((declaration) =>
          meaning === "type"
            ? TYPE_DECLARATIONS.has(declaration.kind)
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
        const anchor = anchorOf(declaration);
        if (!anchor) {
          local++;
          continue;
        }
        const key = keyOf(anchor);
        facts.set(`${target}\0${key}`, { file: target, key });
      }
    };
    visit(symbol, 0);
    const targets = [...facts.values()];
    if (!external && !local) return { targets };
    return {
      targets,
      reason: local ? "local" : "external",
    };
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
    if (found.targets.length)
      facts.targets = found.targets.map((target) => ({ ...target }));
    if (found.reason) facts.reason = found.reason;
    links.push({
      sourceKey,
      kind,
      targetName: clip(targetName) || "(expression)",
      range: range(at),
      data: facts,
    });
  }
  function moduleLink(
    owner: string,
    specifier: ts.StringLiteralLike,
    extra: { [key: string]: Json },
  ) {
    const symbol = checker.getSymbolAtLocation(specifier);
    const relative =
      /^\.\.?(\/|$)/.test(specifier.text) || specifier.text.startsWith("/");
    const found = symbol
      ? targetsOf(symbol, "any")
      : {
          targets: [],
          reason: relative ? "missing-module" : "external-package",
        };
    link(owner, "imports", specifier.text, specifier, found, {
      specifier: specifier.text,
      ...extra,
    });
  }
  const symbolOf = (node: ts.Node) => checker.getSymbolAtLocation(node);
  function calleeTarget(callee: ts.Expression): {
    at: ts.Node;
    symbol: ts.Symbol | undefined;
  } {
    const expression = unwrap(callee);
    if (ts.isPropertyAccessExpression(expression))
      return { at: expression.name, symbol: symbolOf(expression.name) };
    if (ts.isElementAccessExpression(expression))
      return {
        at: expression,
        symbol: ts.isStringLiteralLike(expression.argumentExpression)
          ? symbolOf(expression.argumentExpression)
          : undefined,
      };
    if (
      ts.isIdentifier(expression) ||
      expression.kind === ts.SyntaxKind.SuperKeyword
    )
      return { at: expression, symbol: symbolOf(expression) };
    return { at: callee, symbol: undefined };
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
    link(owner, "calls", name, at, targetsOf(symbol, "value"), extra);
  }
  function binding(
    owner: string,
    importedName: string,
    at: ts.Node,
    name: ts.Node,
    kind: string,
    extra: { [key: string]: Json },
  ) {
    link(
      owner,
      kind,
      importedName,
      at,
      targetsOf(symbolOf(name), "any"),
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
        binding(moduleKey, "*", clause, clause.name, "exports", {});
      else if (clause)
        for (const element of clause.elements) {
          const local = specifier
            ? symbolOf(element.name)
            : checker.getExportSpecifierLocalTargetSymbol(element);
          link(
            moduleKey,
            "exports",
            (element.propertyName ?? element.name).text,
            element,
            targetsOf(local, "any"),
            typeOnly || element.isTypeOnly ? { typeOnly: true } : {},
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
        targetsOf(symbolOf(at), "any"),
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
        binding(moduleKey, "*", node.name, node.name, "imports", {});
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
      } else if (isRequireCall(node) && isJsFile(file)) {
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
            binding(owner, "*", declaration.name, declaration.name, "imports", {
              require: true,
            });
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
          targetsOf(symbolOf(at), "value"),
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
        targetsOf(symbolOf(at), "type"),
      );
    } else if (ts.isTypeQueryNode(node)) {
      const name = node.exprName;
      const at = ts.isQualifiedName(name) ? name.right : name;
      link(
        owner,
        "references",
        name.getText(file),
        name,
        targetsOf(symbolOf(at), "value"),
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
          symbolOf(at),
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
