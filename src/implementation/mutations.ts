// SPDX-License-Identifier: MIT
import ts from "typescript";

/** The lexical instance owns this; nested ordinary functions and static members do not. */
export function instanceClassForThis(
  value: ts.Node,
): ts.ClassLikeDeclaration | undefined {
  for (let node = value.parent; node; node = node.parent) {
    if (ts.isClassStaticBlockDeclaration(node)) return undefined;
    if (ts.isArrowFunction(node)) continue;
    if (ts.isFunctionLike(node) || ts.isPropertyDeclaration(node)) {
      const owner = node.parent;
      return ts.isClassLike(owner) &&
        !(
          ts.getCombinedModifierFlags(node as ts.Declaration) &
          ts.ModifierFlags.Static
        )
        ? owner
        : undefined;
    }
    if (ts.isClassLike(node) || ts.isSourceFile(node)) return undefined;
  }
  return undefined;
}

export interface BindingWrite {
  symbol: ts.Symbol | undefined;
  site: ts.Node;
  owner: string;
  via?: ts.Node;
  receiver?: true;
  target?: ts.Expression;
}
/** An overapproximation of writes in this captured AST, not execution or a proof
 * about external callees. Alias identities and parameter forwarding share a worklist. */
export function codeMutations(
  files: readonly ts.SourceFile[],
  symbolAt: (node: ts.Node) => ts.Symbol | undefined,
  mutated: Set<ts.Symbol>,
  escaped: Set<ts.Symbol>,
  owners: Map<ts.Node, string>,
  scalar: (node: ts.Node) => boolean,
  capturedCallable: (node: ts.Expression) => boolean,
  containedValues: (node: ts.Node) => ts.Node[],
  forwardedNamespace: (node: ts.Node) => boolean,
  begin: (file: ts.SourceFile) => void,
  tick: () => void,
): {
  writes: BindingWrite[];
  escapes: { target: ts.Node; site: ts.Node; owner: string }[];
} {
  const writes: BindingWrite[] = [],
    assignments = new Map<ts.Symbol, ts.Expression[]>();
  const calls: ts.CallExpression[] = [];
  const flows = new Map<
    ts.Symbol,
    {
      argument: ts.Expression;
      site: ts.CallExpression;
      owner: string;
      via: ts.Node;
    }[]
  >();
  const queue: ts.Symbol[] = [],
    queued = new Set<ts.Symbol>();
  const unwrap = (value: ts.Expression): ts.Expression => {
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
  function mark(symbol: ts.Symbol) {
    mutated.add(symbol);
    if (!queued.has(symbol)) {
      queued.add(symbol);
      queue.push(symbol);
    }
  }
  function targets(
    value: ts.Expression,
    emit: (symbol: ts.Symbol | undefined, target: ts.Expression) => void,
  ) {
    value = unwrap(value);
    if (ts.isArrayLiteralExpression(value)) {
      for (const element of value.elements)
        if (!ts.isOmittedExpression(element))
          targets(
            ts.isSpreadElement(element) ? element.expression : element,
            emit,
          );
    } else if (ts.isObjectLiteralExpression(value)) {
      for (const property of value.properties) {
        if (ts.isPropertyAssignment(property))
          targets(property.initializer, emit);
        else if (ts.isShorthandPropertyAssignment(property)) {
          const symbol = symbolAt(property.name);
          emit(symbol, property.name);
        } else if (ts.isSpreadAssignment(property))
          targets(property.expression, emit);
      }
    } else if (
      ts.isBinaryExpression(value) &&
      value.operatorToken.kind === ts.SyntaxKind.EqualsToken
    )
      targets(value.left, emit);
    else {
      const symbol = symbolAt(value);
      emit(symbol, value);
    }
  }
  function exportTarget(value: ts.Expression) {
    const parts: string[] = [];
    value = unwrap(value);
    while (
      ts.isPropertyAccessExpression(value) ||
      ts.isElementAccessExpression(value)
    ) {
      if (ts.isPropertyAccessExpression(value)) parts.unshift(value.name.text);
      else if (ts.isStringLiteral(value.argumentExpression))
        parts.unshift(value.argumentExpression.text);
      else return false;
      value = unwrap(value.expression);
    }
    return (
      ts.isIdentifier(value) &&
      (value.text === "exports" ||
        (value.text === "module" && parts[0] === "exports"))
    );
  }
  const sites: { left: ts.Expression; site: ts.Node; owner: string }[] = [];
  const escapes: ts.Node[] = [];
  function safeUse(value: ts.Expression): boolean {
    const p = value.parent;
    if (!p) return false;
    if (ts.isExpressionStatement(p)) return true; // discarded value; children are classified separately
    if (ts.isShorthandPropertyAssignment(p) && p.name === value) return false;
    for (
      let node: ts.Node | undefined = p;
      node && !ts.isSourceFile(node);
      node = node.parent
    ) {
      if (
        ts.isTypeNode(node) ||
        ts.isImportDeclaration(node) ||
        ts.isExportDeclaration(node)
      )
        return true;
      if (ts.isStatement(node) || ts.isExpression(node)) break;
    }
    if (
      ("name" in p && p.name === value && !ts.isComputedPropertyName(p)) ||
      (ts.isBindingElement(p) && p.propertyName === value)
    )
      return true;
    if (ts.isVariableDeclaration(p) && p.initializer === value) return true; // tracked local alias
    if (
      ts.isBinaryExpression(p) &&
      p.right === value &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      exportTarget(p.left) &&
      forwardedNamespace(value)
    )
      return true;
    if (
      ts.isBinaryExpression(p) &&
      p.left === value &&
      p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      p.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      return true;
    if (
      ts.isBinaryExpression(p) &&
      p.right === value &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(p.left)
    )
      return true;
    if (
      (ts.isCallExpression(p) || ts.isNewExpression(p)) &&
      p.expression === value
    )
      return true; // callable identity, not object escape
    if (
      (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) &&
      p.expression === value
    ) {
      if (scalar(p)) return true;
      const call = p.parent;
      if (
        (ts.isCallExpression(call) || ts.isNewExpression(call)) &&
        call.expression === p
      )
        return capturedCallable(p);
      return safeUse(p);
    }
    if (
      ts.isParenthesizedExpression(p) ||
      ts.isAsExpression(p) ||
      ts.isTypeAssertionExpression(p) ||
      ts.isNonNullExpression(p) ||
      ts.isSatisfiesExpression(p)
    )
      return safeUse(p);
    if (ts.isIfStatement(p) && p.expression === value) return true;
    if (ts.isTypeOfExpression(p) || ts.isVoidExpression(p)) return true;
    if (
      ts.isPrefixUnaryExpression(p) &&
      p.operator === ts.SyntaxKind.ExclamationToken
    )
      return true;
    if (
      ts.isBinaryExpression(p) &&
      [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(p.operatorToken.kind)
    )
      return true;
    return false;
  }
  for (const file of files) {
    begin(file);
    const visit = (node: ts.Node) => {
      tick();
      const left =
        (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
        !ts.isVariableDeclarationList(node.initializer)
          ? node.initializer
          : ts.isBinaryExpression(node) &&
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
                : undefined;
      if (left && !exportTarget(left)) {
        sites.push({ left, site: node, owner: owners.get(node)! });
        targets(left, (symbol) => {
          if (!symbol) return;
          mark(symbol);
          if (ts.isBinaryExpression(node)) {
            const values = assignments.get(symbol) ?? [];
            values.push(node.right);
            assignments.set(symbol, values);
          }
        });
      }
      if (ts.isCallExpression(node)) calls.push(node);
      // Decorators receive values implicitly, outside the expression-use tree.
      // A class decorator can replace its constructor; member decorators can
      // replace the member and expose the containing prototype to arbitrary code.
      if (ts.canHaveDecorators(node) && ts.getDecorators(node)?.length) {
        const symbol = symbolAt(
          "name" in node && node.name ? (node.name as ts.Node) : node,
        );
        if (symbol) mark(symbol);
        if (ts.isClassDeclaration(node)) escapes.push(node.name ?? node);
        else {
          let owner: ts.Node | undefined = node.parent;
          while (owner && !ts.isClassLike(owner) && !ts.isSourceFile(owner))
            owner = owner.parent;
          if (owner && ts.isClassLike(owner)) escapes.push(owner.name ?? owner);
        }
      }
      // Promise types may be absent in this no-lib program. Resolve the literal
      // namespace explicitly in containedValues rather than relying on await's type.
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      )
        escapes.push(node);
      if (ts.isExpression(node) && !safeUse(node)) escapes.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  const escapedSites: {
    target: ts.Node;
    site: ts.Node;
    owner: string;
  }[] = [];
  const escapedSymbols = new Set<ts.Symbol>();
  const escapedExpressions = new Set<ts.Node>();
  function escape(
    value: ts.Node,
    site: ts.Node = value,
    owner = owners.get(site)!,
  ) {
    tick();
    if (ts.isExpression(value)) value = unwrap(value);
    if (scalar(value)) return;
    if (
      ts.isPropertyAccessExpression(value) ||
      ts.isElementAccessExpression(value)
    ) {
      const key = ts.isPropertyAccessExpression(value)
        ? value.name.text
        : ts.isStringLiteralLike(value.argumentExpression)
          ? value.argumentExpression.text
          : undefined;
      if (key && ["constructor", "prototype", "__proto__"].includes(key))
        escape(value.expression, site, owner);
    }
    if (ts.isNewExpression(value)) {
      // An escaped/patched instance invalidates virtual dispatch inside its
      // constructor's class, even when the constructor binding itself is local.
      escape(value.expression, site, owner);
      return;
    }
    if (
      ts.isBinaryExpression(value) ||
      ts.isAwaitExpression(value) ||
      ts.isYieldExpression(value)
    ) {
      if (ts.isBinaryExpression(value)) {
        if (
          !(
            value.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            value.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          )
        )
          escape(value.left, site, owner);
        escape(value.right, site, owner);
      } else if (value.expression) escape(value.expression, site, owner);
      return;
    }
    if (ts.isArrayLiteralExpression(value)) {
      for (const e of value.elements)
        if (!ts.isOmittedExpression(e))
          escape(ts.isSpreadElement(e) ? e.expression : e, site, owner);
      return;
    }
    if (ts.isObjectLiteralExpression(value)) {
      for (const p of value.properties) {
        if (ts.isPropertyAssignment(p)) escape(p.initializer, site, owner);
        else if (ts.isShorthandPropertyAssignment(p))
          escape(p.name, site, owner);
        else if (ts.isSpreadAssignment(p)) escape(p.expression, site, owner);
      }
      return;
    }
    if (ts.isConditionalExpression(value)) {
      escape(value.whenTrue, site, owner);
      escape(value.whenFalse, site, owner);
      return;
    }
    if (value.kind === ts.SyntaxKind.ThisKeyword) {
      let parent: ts.Node | undefined = value.parent;
      while (parent) {
        if (ts.isClassDeclaration(parent)) break;
        if (ts.isFunctionLike(parent) && !ts.isArrowFunction(parent)) {
          const owner = parent.parent;
          parent =
            ts.isClassDeclaration(owner) || ts.isObjectLiteralExpression(owner)
              ? owner
              : ts.isFunctionExpression(parent) &&
                  ts.isPropertyAssignment(owner) &&
                  ts.isObjectLiteralExpression(owner.parent)
                ? owner.parent
                : undefined;
          break;
        }
        parent = parent.parent;
      }
      if (parent && ts.isClassDeclaration(parent)) {
        const s = symbolAt(parent.name ?? parent);
        if (s) escaped.add(s);
      }
      if (parent && ts.isObjectLiteralExpression(parent)) {
        let binding: ts.Node | undefined = parent.parent;
        if (
          binding &&
          (ts.isPropertyDeclaration(binding) ||
            ts.isPropertyAssignment(binding))
        ) {
          const symbol = symbolAt(binding.name);
          if (symbol) escaped.add(symbol);
        }
        while (
          binding &&
          (ts.isPropertyAssignment(binding) ||
            ts.isObjectLiteralExpression(binding) ||
            ts.isParenthesizedExpression(binding))
        )
          binding = binding.parent;
        if (
          binding &&
          ts.isVariableDeclaration(binding) &&
          ts.isIdentifier(binding.name)
        )
          escape(binding.name, site, owner);
      }
      return;
    }
    const symbol = symbolAt(value);
    escapedSites.push({ target: value, site, owner });
    if (symbol) {
      escaped.add(symbol);
      if (escapedSymbols.has(symbol)) return;
      escapedSymbols.add(symbol);
    } else {
      if (escapedExpressions.has(value)) return;
      escapedExpressions.add(value);
    }
    for (const member of containedValues(value)) escape(member, site, owner);
    if (!symbol) return;
    for (const d of symbol.declarations ?? []) {
      if (ts.isExportAssignment(d)) escape(d.expression, site, owner);
      if (
        ts.isVariableDeclaration(d) &&
        d.initializer &&
        !ts.isObjectLiteralExpression(unwrap(d.initializer)) &&
        !ts.isArrayLiteralExpression(unwrap(d.initializer))
      )
        escape(d.initializer, site, owner);
      if (ts.isBindingElement(d)) {
        let root: ts.Node = d.parent;
        while (!ts.isVariableDeclaration(root) && !ts.isSourceFile(root))
          root = root.parent;
        if (ts.isVariableDeclaration(root) && root.initializer)
          escape(root.initializer, site, owner);
      }
    }
    for (const assigned of assignments.get(symbol) ?? [])
      escape(assigned, site, owner);
  }
  for (const value of escapes) {
    begin(value.getSourceFile());
    escape(value);
  }
  function receiver(
    value: ts.Expression,
    site: ts.Node,
    owner: string,
    via?: ts.Node,
    seen = new Set<ts.Symbol>(),
    destructured = false,
    containerOnly = false,
  ) {
    tick();
    value = unwrap(value);
    if (value.kind === ts.SyntaxKind.ThisKeyword) {
      if (instanceClassForThis(value)) {
        if (!containerOnly) escape(value, site, owner);
        return;
      }
      escape(value, site, owner);
    }
    if (ts.isNewExpression(value)) escape(value, site, owner);
    if (destructured && ts.isArrayLiteralExpression(value)) {
      for (const element of value.elements)
        if (!ts.isOmittedExpression(element))
          receiver(
            ts.isSpreadElement(element) ? element.expression : element,
            site,
            owner,
            via,
            seen,
            true,
          );
      return;
    }
    if (destructured && ts.isObjectLiteralExpression(value)) {
      for (const property of value.properties) {
        if (ts.isPropertyAssignment(property))
          receiver(property.initializer, site, owner, via, seen, true);
        else if (ts.isShorthandPropertyAssignment(property))
          receiver(property.name, site, owner, via, seen, true);
        else if (ts.isSpreadAssignment(property))
          receiver(property.expression, site, owner, via, seen, true);
      }
      return;
    }
    if (ts.isConditionalExpression(value)) {
      receiver(value.whenTrue, site, owner, via, seen, destructured);
      receiver(value.whenFalse, site, owner, via, seen, destructured);
      return;
    }
    if (
      ts.isPropertyAccessExpression(value) ||
      ts.isElementAccessExpression(value)
    ) {
      if (!symbolAt(value.expression)?.declarations?.some(ts.isSourceFile))
        receiver(
          value.expression,
          site,
          owner,
          via,
          seen,
          false,
          !(ts.isPropertyAccessExpression(value)
            ? ["constructor", "prototype", "__proto__"].includes(
                value.name.text,
              )
            : true),
        );
    }
    const symbol = symbolAt(value);
    if (!containerOnly)
      writes.push({
        symbol,
        receiver: true,
        site,
        owner,
        target: value,
        ...(via ? { via } : {}),
      });
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    mark(symbol);
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isBindingElement(declaration)) {
        let root: ts.Node = declaration;
        while (!ts.isVariableDeclaration(root) && !ts.isSourceFile(root))
          root = root.parent;
        if (ts.isVariableDeclaration(root) && root.initializer)
          receiver(root.initializer, site, owner, via, seen, true, false);
      }
      if (ts.isVariableDeclaration(declaration) && declaration.initializer)
        receiver(
          declaration.initializer,
          site,
          owner,
          via,
          seen,
          false,
          containerOnly,
        );
    }
    for (const assigned of assignments.get(symbol) ?? [])
      receiver(assigned, site, owner, via, seen, true, containerOnly);
  }
  for (const item of sites) {
    begin(item.site.getSourceFile());
    const left = unwrap(item.left);
    targets(left, (symbol, target) =>
      writes.push({ symbol, target, site: item.site, owner: item.owner }),
    );
    function properties(value: ts.Expression) {
      value = unwrap(value);
      if (
        ts.isPropertyAccessExpression(value) ||
        ts.isElementAccessExpression(value)
      ) {
        receiver(
          value.expression,
          item.site,
          item.owner,
          undefined,
          new Set(),
          false,
          !!symbolAt(value),
        );
      } else if (ts.isArrayLiteralExpression(value)) {
        for (const element of value.elements)
          if (!ts.isOmittedExpression(element))
            properties(
              ts.isSpreadElement(element) ? element.expression : element,
            );
      } else if (ts.isObjectLiteralExpression(value)) {
        for (const property of value.properties) {
          if (ts.isPropertyAssignment(property))
            properties(property.initializer);
          else if (ts.isSpreadAssignment(property))
            properties(property.expression);
        }
      }
    }
    properties(left);
  }
  function callable(
    expression: ts.Expression,
    seen = new Set<ts.Symbol>(),
  ): ts.SignatureDeclaration | undefined {
    expression = unwrap(expression);
    if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression))
      return expression;
    const symbol = symbolAt(expression);
    if (!symbol || seen.has(symbol)) return undefined;
    seen.add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      if (
        (ts.isFunctionDeclaration(declaration) ||
          ts.isMethodDeclaration(declaration)) &&
        declaration.body
      )
        return declaration;
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const fn = callable(declaration.initializer, seen);
        if (fn) return fn;
      }
    }
    return undefined;
  }
  function reflective(
    expression: ts.Expression,
    seen = new Set<ts.Symbol>(),
  ): boolean {
    expression = unwrap(expression);
    if (ts.isIdentifier(expression)) {
      const symbol = symbolAt(expression);
      if (!symbol || seen.has(symbol)) return false;
      seen.add(symbol);
      return (
        symbol.declarations?.some(
          (d) =>
            ts.isVariableDeclaration(d) &&
            !!d.initializer &&
            reflective(d.initializer, seen),
        ) ?? false
      );
    }
    if (
      !ts.isPropertyAccessExpression(expression) &&
      !ts.isElementAccessExpression(expression)
    )
      return false;
    const root = unwrap(expression.expression),
      key = ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : ts.isStringLiteral(expression.argumentExpression)
          ? expression.argumentExpression.text
          : "";
    return (
      ts.isIdentifier(root) &&
      ["Object", "Reflect"].includes(root.text) &&
      [
        "assign",
        "defineProperty",
        "defineProperties",
        "setPrototypeOf",
        "set",
        "deleteProperty",
      ].includes(key)
    );
  }
  for (const call of calls) {
    begin(call.getSourceFile());
    const owner = owners.get(call)!;
    if (reflective(call.expression) && call.arguments[0])
      receiver(call.arguments[0], call, owner);
    const fn = callable(call.expression);
    if (!fn) continue;
    for (const [index, parameter] of fn.parameters.entries()) {
      if (!ts.isIdentifier(parameter.name) || !call.arguments[index]) continue;
      const symbol = symbolAt(parameter.name);
      if (!symbol) continue;
      const consumers = flows.get(symbol) ?? [];
      consumers.push({
        argument: call.arguments[index]!,
        site: call,
        owner,
        via: fn,
      });
      flows.set(symbol, consumers);
    }
  }
  for (const symbol of mutated) mark(symbol);
  for (let index = 0; index < queue.length; index++)
    for (const consumer of flows.get(queue[index]!) ?? []) {
      begin(consumer.site.getSourceFile());
      receiver(consumer.argument, consumer.site, consumer.owner, consumer.via);
    }
  return { writes, escapes: escapedSites };
}
