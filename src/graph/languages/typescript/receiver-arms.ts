// SPDX-License-Identifier: MIT
/**
 * C-41: whether the checker's declaration for a member call `receiver.name()`
 * can have come from a union it reduced.
 *
 * When a value is computed from several producers (`pick ? one : two`,
 * `a ?? b`, an array literal's element, an inferred return with several
 * `return`s), the checker forms a union of their types with subtype
 * reduction. Structurally identical object types reduce to one of them, and
 * the member's declaration list then names that arm's member only: a wrong
 * definite link when the other arm was chosen. This applies to interface,
 * type-literal, class and object-literal members alike.
 *
 * So the receiver's chain is walked to its producers, step by step. Each
 * value resolves to its arms: the types of the producers it can come from.
 * A value with one producer has one arm. A step whose type is written (a
 * declaration with a type annotation, a call whose signature writes its
 * return type, an assertion) is one arm, the checker's type there: written
 * types are never reduced. A step the walk cannot follow makes the whole
 * receiver unknown.
 *
 * The member is then looked up on each arm. If the arms' members are the
 * checker's member, its answer stands. If not, the arms' members replace it:
 * a candidate set when there are several, the right single member when the
 * checker picked a wrong one (`formats[1].format()` with
 * `formats = [csv, tsv]`). An unknown receiver, or an arm without the
 * member, leaves the call unresolved (`reduced-receiver`).
 *
 * Only declarations reached through the checker's symbols are read, so the
 * walk depends on no file outside the importing file's type-checking
 * inputs: the files that declare what the receiver's chain names.
 */
import ts from "typescript";
import { staticName } from "./object-producers.js";

interface Arm {
  readonly type: ts.Type;
  /** An array literal producer, whose elements an element access walks. */
  readonly array?: ts.ArrayLiteralExpression;
}
type Arms = readonly Arm[] | undefined;
/** The declaration's type is written (or otherwise never reduced). */
const WRITTEN = Symbol("written");
type DeclarationArms = Arms | typeof WRITTEN;

const MAX_ARMS = 16;
/**
 * Steps followed before giving up (unresolved). Chains of inferred returns
 * are followed through, as the checker itself does; a deeper one, or a
 * stack overflow, leaves the call unresolved.
 */
const MAX_DEPTH = 2000;

/** Array methods whose callback's first parameter is an element. */
const ELEMENT_CALLBACKS = new Set([
  "forEach",
  "map",
  "filter",
  "find",
  "findLast",
  "findIndex",
  "findLastIndex",
  "some",
  "every",
  "flatMap",
]);

type Callable =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration;

const hasBody = (node: ts.Node): node is Callable =>
  (ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node)) &&
  !!node.body;

/** Parentheses, `satisfies` and `!` keep the value; an assertion writes a type. */
function skipValue(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  )
    current = current.expression;
  return current;
}

const NO_ARMS: readonly Arm[] = [];

export type ReceiverVerdict =
  /** The checker's member stands. */
  | undefined
  /** The receiver could not be followed: unresolved. */
  | "unverified"
  /** The arms' members, in place of the checker's. */
  | readonly ts.Symbol[];

export function receiverArms(
  checker: ts.TypeChecker,
  isWrite: (node: ts.Node) => number,
) {
  const values = new WeakMap<ts.Node, Arms | null>();
  const declared = new WeakMap<ts.Node, DeclarationArms | null>();
  const unreducedCache = new WeakMap<ts.Node, boolean>();
  const active = new Set<ts.Node>();
  const returnLists = new WeakMap<ts.Node, readonly ts.Expression[]>();
  const checking = new Set<ts.Node>();
  const fileWrites = new WeakMap<
    ts.SourceFile,
    Map<ts.Symbol, (ts.Expression | undefined)[]>
  >();
  let depth = 0;

  const typeAt = (node: ts.Node) =>
    checker.getNonNullableType(checker.getTypeAtLocation(node));
  const leaf = (node: ts.Node): Arms => [{ type: typeAt(node) }];
  const nullish = (type: ts.Type) =>
    !!(
      type.flags &
      (ts.TypeFlags.Undefined |
        ts.TypeFlags.Null |
        ts.TypeFlags.Void |
        ts.TypeFlags.Never)
    );

  function merge(lists: readonly Arms[]): Arms {
    const arms: Arm[] = [];
    for (const list of lists) {
      if (!list) return undefined;
      for (const arm of list) {
        if (!arm.array && nullish(arm.type)) continue;
        if (
          arms.some((known) =>
            arm.array ? known.array === arm.array : known.type === arm.type,
          )
        )
          continue;
        arms.push(arm);
        if (arms.length > MAX_ARMS) return undefined;
      }
    }
    return arms;
  }

  /** Guarded, cached recursion over a node. */
  function guarded<T>(
    cache: WeakMap<ts.Node, T | null>,
    node: ts.Node,
    compute: () => T,
  ): T | undefined {
    const known = cache.get(node);
    if (known !== undefined) return known === null ? undefined : known;
    if (active.has(node) || depth >= MAX_DEPTH) return undefined;
    active.add(node);
    depth++;
    try {
      const result = compute();
      cache.set(node, result === undefined ? null : result);
      return result;
    } finally {
      depth--;
      active.delete(node);
    }
  }

  /** The arms of the value `expression` evaluates to. */
  function arms(expression: ts.Expression): Arms {
    return guarded(values, expression, () => compute(expression));
  }

  function compute(node: ts.Expression): Arms {
    const value = skipValue(node);
    if (value !== node) return arms(value);
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
      return leaf(node);
    if (ts.isConditionalExpression(node))
      return merge([arms(node.whenTrue), arms(node.whenFalse)]);
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (
        operator === ts.SyntaxKind.QuestionQuestionToken ||
        operator === ts.SyntaxKind.BarBarToken
      ) {
        // A left side that is never nullish (`??`) or never falsy (`||`,
        // only objects) is the value.
        const left = checker.getTypeAtLocation(node.left);
        const parts = left.isUnion() ? left.types : [left];
        const always = parts.every((part) =>
          operator === ts.SyntaxKind.QuestionQuestionToken
            ? !(
                part.flags &
                (ts.TypeFlags.Undefined |
                  ts.TypeFlags.Null |
                  ts.TypeFlags.Void |
                  ts.TypeFlags.Any |
                  ts.TypeFlags.Unknown)
              )
            : !!(part.flags & ts.TypeFlags.Object),
        );
        return always
          ? arms(node.left)
          : merge([arms(node.left), arms(node.right)]);
      }
      if (
        operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.CommaToken ||
        operator === ts.SyntaxKind.EqualsToken
      )
        return arms(node.right);
      // Arithmetic, comparison, `in`, `instanceof`: a primitive.
      return leaf(node);
    }
    if (ts.isArrayLiteralExpression(node))
      return [{ type: typeAt(node), array: node }];
    if (
      ts.isObjectLiteralExpression(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isClassExpression(node) ||
      ts.isLiteralExpression(node) ||
      ts.isTemplateExpression(node) ||
      ts.isPrefixUnaryExpression(node) ||
      ts.isPostfixUnaryExpression(node) ||
      ts.isTypeOfExpression(node) ||
      ts.isDeleteExpression(node) ||
      ts.isMetaProperty(node) ||
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node) ||
      node.kind === ts.SyntaxKind.ThisKeyword ||
      node.kind === ts.SyntaxKind.SuperKeyword ||
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword ||
      node.kind === ts.SyntaxKind.NullKeyword
    )
      return leaf(node);
    if (ts.isVoidExpression(node)) return NO_ARMS;
    if (ts.isAwaitExpression(node)) {
      const inner = arms(node.expression);
      return inner && inner.length <= 1 ? leaf(node) : undefined;
    }
    if (ts.isIdentifier(node)) return identifier(node);
    if (ts.isPropertyAccessExpression(node))
      return property(
        arms(node.expression),
        node.name.text,
        node,
        node.expression,
      );
    if (ts.isElementAccessExpression(node)) {
      const key = node.argumentExpression;
      if (ts.isStringLiteralLike(key) && !ts.isNumericLiteral(key))
        return property(arms(node.expression), key.text, node, node.expression);
      const index = ts.isNumericLiteral(key) ? Number(key.text) : undefined;
      return element(arms(node.expression), index, node, node.expression);
    }
    if (ts.isCallExpression(node)) return call(node);
    if (ts.isNewExpression(node)) {
      const signature = checker.getResolvedSignature(node);
      const declaration = signature?.declaration;
      const generic =
        !node.typeArguments &&
        !!(
          declaration &&
          !ts.isJSDocSignature(declaration) &&
          (declaration.typeParameters?.length ||
            (ts.isClassLike(declaration.parent) &&
              declaration.parent.typeParameters?.length))
        );
      if (generic && !argumentsUnreduced(node)) return undefined;
      const callee = arms(node.expression);
      return callee && callee.length <= 1 ? leaf(node) : undefined;
    }
    return undefined;
  }

  function identifier(node: ts.Identifier): Arms {
    if (node.text === "undefined") return NO_ARMS;
    let symbol = ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    // A global without a declaration (`arguments`, an unchecked name).
    if (!symbol?.declarations?.length) return leaf(node);
    const result = symbolArms(symbol);
    return result === WRITTEN ? leaf(node) : result;
  }

  function symbolArms(symbol: ts.Symbol): DeclarationArms {
    const declarations = symbol.declarations ?? [];
    if (declarations.length === 1) return declarationArms(declarations[0]!);
    // Overloads, declaration merging (a class and an interface, a function
    // and a namespace): declared, not computed.
    return declarations.every(
      (declaration) =>
        !ts.isVariableDeclaration(declaration) &&
        !ts.isPropertyAssignment(declaration) &&
        !ts.isShorthandPropertyAssignment(declaration) &&
        !ts.isBindingElement(declaration) &&
        !ts.isBinaryExpression(declaration),
    )
      ? WRITTEN
      : undefined;
  }

  function declarationArms(declaration: ts.Declaration): DeclarationArms {
    return guarded(declared, declaration, () =>
      computeDeclaration(declaration),
    );
  }

  function computeDeclaration(declaration: ts.Declaration): DeclarationArms {
    if (
      ts.isSourceFile(declaration) ||
      ts.isModuleDeclaration(declaration) ||
      ts.isClassDeclaration(declaration) ||
      ts.isClassExpression(declaration) ||
      ts.isFunctionDeclaration(declaration) ||
      ts.isFunctionExpression(declaration) ||
      ts.isArrowFunction(declaration) ||
      ts.isEnumDeclaration(declaration) ||
      ts.isEnumMember(declaration) ||
      ts.isInterfaceDeclaration(declaration) ||
      ts.isTypeAliasDeclaration(declaration) ||
      ts.isMethodDeclaration(declaration) ||
      ts.isMethodSignature(declaration) ||
      ts.isSetAccessorDeclaration(declaration) ||
      ts.isPropertySignature(declaration) ||
      ts.isImportEqualsDeclaration(declaration) ||
      ts.isNamespaceImport(declaration) ||
      ts.isImportClause(declaration) ||
      ts.isImportSpecifier(declaration) ||
      ts.isExportSpecifier(declaration) ||
      ts.isTypeParameterDeclaration(declaration) ||
      ts.isJsxAttribute(declaration)
    )
      return WRITTEN;
    if (ts.isGetAccessorDeclaration(declaration))
      return declaration.type ? WRITTEN : returned(declaration);
    if (ts.isPropertyDeclaration(declaration)) {
      if (declaration.type || !declaration.initializer) return WRITTEN;
      return arms(declaration.initializer);
    }
    if (ts.isPropertyAssignment(declaration))
      return arms(declaration.initializer);
    if (ts.isShorthandPropertyAssignment(declaration)) {
      let value = checker.getShorthandAssignmentValueSymbol(declaration);
      if (value && value.flags & ts.SymbolFlags.Alias)
        value = checker.getAliasedSymbol(value);
      return value ? symbolArms(value) : undefined;
    }
    if (ts.isExportAssignment(declaration)) return arms(declaration.expression);
    // A JavaScript assignment declaration (`x = value`, `exports.x = value`).
    if (
      ts.isBinaryExpression(declaration) &&
      declaration.operatorToken.kind === ts.SyntaxKind.EqualsToken
    )
      return arms(declaration.right);
    if (ts.isVariableDeclaration(declaration)) return variable(declaration);
    if (ts.isParameter(declaration)) return parameter(declaration);
    if (ts.isBindingElement(declaration)) return binding(declaration);
    return undefined;
  }

  function variable(declaration: ts.VariableDeclaration): DeclarationArms {
    if (declaration.type) return WRITTEN;
    const list = declaration.parent;
    if (ts.isCatchClause(list)) return WRITTEN;
    if (!ts.isVariableDeclarationList(list)) return undefined;
    const statement = list.parent;
    if (ts.isForInStatement(statement)) return WRITTEN;
    if (ts.isForOfStatement(statement))
      return element(
        arms(statement.expression),
        undefined,
        declaration.name,
        statement.expression,
      );
    const values: (ts.Expression | undefined)[] = [];
    if (declaration.initializer) values.push(declaration.initializer);
    // A pattern's bindings are assigned one by one (see binding).
    if (
      !(list.flags & ts.NodeFlags.Const) &&
      ts.isIdentifier(declaration.name)
    ) {
      const writes = assignments(declaration);
      if (!writes) return undefined;
      values.push(...writes);
    }
    // No producer at all: an implicit `any`.
    if (!values.length) return WRITTEN;
    return merge(values.map((value) => (value ? arms(value) : undefined)));
  }

  /** Every value assigned to the `let` or `var` `declaration`, if knowable. */
  function assignments(
    declaration: ts.VariableDeclaration | ts.BindingElement,
  ): (ts.Expression | undefined)[] | undefined {
    if (!ts.isIdentifier(declaration.name)) return undefined;
    const file = declaration.getSourceFile();
    // A script's top-level `var` can be assigned from any file.
    if (
      !ts.isExternalModule(file) &&
      !(file as { commonJsModuleIndicator?: ts.Node })
        .commonJsModuleIndicator &&
      !ts.findAncestor(declaration, (node) => ts.isFunctionLike(node))
    )
      return undefined;
    const symbol = checker.getSymbolAtLocation(declaration.name);
    if (!symbol) return undefined;
    let writes = fileWrites.get(file);
    if (!writes) {
      const found = new Map<ts.Symbol, (ts.Expression | undefined)[]>();
      const scan = (node: ts.Node): void => {
        if (
          ts.isIdentifier(node) &&
          isWrite(node) &&
          // A declaration's own name is its initializer, read already.
          !(
            (ts.isBindingElement(node.parent) ||
              ts.isVariableDeclaration(node.parent)) &&
            node.parent.name === node
          )
        ) {
          const written = ts.isShorthandPropertyAssignment(node.parent)
            ? checker.getShorthandAssignmentValueSymbol(node.parent)
            : checker.getSymbolAtLocation(node);
          if (written) {
            const parent = node.parent;
            // `x = v`, `x ??= v`, `x ||= v`, `x &&= v` assign `v`; any other
            // write (a destructuring target, `++`, a `for…of` head) is not
            // followed.
            const value =
              ts.isBinaryExpression(parent) &&
              parent.left === node &&
              (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
                parent.operatorToken.kind ===
                  ts.SyntaxKind.QuestionQuestionEqualsToken ||
                parent.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken ||
                parent.operatorToken.kind ===
                  ts.SyntaxKind.AmpersandAmpersandEqualsToken)
                ? parent.right
                : undefined;
            const list = found.get(written);
            if (list) list.push(value);
            else found.set(written, [value]);
          }
        }
        ts.forEachChild(node, scan);
      };
      scan(file);
      writes = found;
      fileWrites.set(file, writes);
    }
    const list = writes.get(symbol) ?? [];
    return list.every((value) => value !== undefined) ? list : undefined;
  }

  function parameter(declaration: ts.ParameterDeclaration): DeclarationArms {
    if (declaration.type || declaration.dotDotDotToken) return WRITTEN;
    const fn = declaration.parent;
    const contextual =
      ts.isFunctionExpression(fn) ||
      ts.isArrowFunction(fn) ||
      (ts.isMethodDeclaration(fn) && ts.isObjectLiteralExpression(fn.parent));
    if (!contextual)
      return declaration.initializer ? arms(declaration.initializer) : WRITTEN;
    const own = callbackElement(declaration);
    if (own !== null) return own;
    return contextOf(fn) ? WRITTEN : undefined;
  }

  /**
   * The element arms for the first parameter of an array method's callback
   * (`list.forEach((item) => …)`), or null when it is not one.
   */
  function callbackElement(declaration: ts.ParameterDeclaration): Arms | null {
    const fn = declaration.parent;
    if (fn.parameters[0] !== declaration) return null;
    let at: ts.Node = fn;
    while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
    const call = at.parent;
    if (
      !ts.isCallExpression(call) ||
      call.arguments[0] !== at ||
      !ts.isPropertyAccessExpression(call.expression) ||
      !ELEMENT_CALLBACKS.has(call.expression.name.text)
    )
      return null;
    const receiver = call.expression.expression;
    const owner = checker.getTypeAtLocation(receiver);
    if (!checker.isArrayLikeType(owner)) return null;
    return element(arms(receiver), undefined, declaration.name, receiver);
  }

  /**
   * Whether the function or object literal `node` gets its contextual type
   * from a written type or from a call whose instantiation the walk accepts.
   */
  function contextOf(node: ts.Node): boolean {
    let at = node;
    while (
      ts.isParenthesizedExpression(at.parent) ||
      ts.isSatisfiesExpression(at.parent)
    )
      at = at.parent;
    const parent = at.parent;
    if (ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent))
      return true;
    if (
      (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      parent.arguments?.includes(at as ts.Expression)
    )
      return callAccepted(parent);
    if (
      (ts.isVariableDeclaration(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isParameter(parent)) &&
      parent.initializer === at
    )
      return !!parent.type;
    if (ts.isPropertyAssignment(parent) && parent.initializer === at)
      return contextOf(parent.parent);
    if (ts.isMethodDeclaration(at) && ts.isObjectLiteralExpression(parent))
      return contextOf(parent);
    if (ts.isShorthandPropertyAssignment(parent)) return false;
    if (ts.isArrayLiteralExpression(parent)) return contextOf(parent);
    if (ts.isJsxExpression(parent) || ts.isJsxAttribute(parent)) return true;
    if (
      ts.isBinaryExpression(parent) &&
      parent.right === at &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    )
      return true;
    if (ts.isReturnStatement(parent)) {
      const owner = ts.findAncestor(parent, ts.isFunctionLike);
      return !!owner?.type;
    }
    if (ts.isArrowFunction(parent) && parent.body === at) return !!parent.type;
    return false;
  }

  /** A call's callee is one value and its type arguments are not reduced. */
  function callAccepted(call: ts.CallExpression | ts.NewExpression): boolean {
    const callee = arms(call.expression);
    if (!callee || callee.length > 1) return false;
    if (call.typeArguments?.length) return true;
    const declaration = checker.getResolvedSignature(call)?.declaration;
    if (!declaration || ts.isJSDocSignature(declaration)) return true;
    const generic =
      !!declaration.typeParameters?.length ||
      (ts.isConstructorDeclaration(declaration) &&
        !!declaration.parent.typeParameters?.length);
    return !generic || argumentsUnreduced(call, true);
  }

  /** No argument of a generic call is a reduced value (its type arguments). */
  function argumentsUnreduced(
    call: ts.CallExpression | ts.NewExpression,
    skipFunctions = false,
  ): boolean {
    for (const argument of call.arguments ?? []) {
      const value = skipValue(argument);
      if (
        skipFunctions &&
        (ts.isFunctionExpression(value) || ts.isArrowFunction(value))
      )
        continue;
      if (!unreduced(ts.isSpreadElement(value) ? value.expression : value))
        return false;
    }
    return true;
  }

  /** Whether the value of `expression` (and what a generic infers from it) is one arm. */
  function unreduced(expression: ts.Expression): boolean {
    const known = unreducedCache.get(expression);
    if (known !== undefined) return known;
    if (checking.has(expression) || depth >= MAX_DEPTH) return false;
    checking.add(expression);
    depth++;
    let result: boolean;
    try {
      const value = skipValue(expression);
      if (ts.isObjectLiteralExpression(value))
        result = value.properties.every((property) =>
          ts.isPropertyAssignment(property)
            ? unreduced(property.initializer)
            : ts.isSpreadAssignment(property)
              ? unreduced(property.expression)
              : ts.isShorthandPropertyAssignment(property)
                ? unreduced(property.name)
                : true,
        );
      else if (ts.isArrayLiteralExpression(value)) {
        const elements = merge(
          value.elements.map((item) =>
            ts.isSpreadElement(item)
              ? element(arms(item.expression), undefined, item, item.expression)
              : arms(item),
          ),
        );
        result = !!elements && elements.length <= 1;
      } else if (ts.isFunctionExpression(value) || ts.isArrowFunction(value)) {
        if (value.type) result = true;
        else {
          const out = returned(value);
          result = !!out && out.length <= 1;
        }
      } else {
        const out = arms(value);
        result = !!out && out.length <= 1;
      }
    } finally {
      depth--;
      checking.delete(expression);
    }
    unreducedCache.set(expression, result);
    return result;
  }

  function binding(declaration: ts.BindingElement): DeclarationArms {
    const pattern = declaration.parent;
    const owner = pattern.parent;
    let source: DeclarationArms;
    if (ts.isBindingElement(owner)) source = binding(owner);
    else if (ts.isVariableDeclaration(owner)) source = variable(owner);
    else if (ts.isParameter(owner)) source = parameter(owner);
    else return undefined;
    if (source === WRITTEN) return WRITTEN;
    if (!source) return undefined;
    let result: Arms;
    // A default applies only where the value can be `undefined`.
    let defaults = true;
    if (ts.isObjectBindingPattern(pattern)) {
      if (declaration.dotDotDotToken)
        return source.length <= 1 ? WRITTEN : undefined;
      const key = staticName(declaration.propertyName ?? declaration.name);
      if (key === undefined) return undefined;
      result = property(source, key, declaration.name);
      defaults = source.some((arm) => {
        const member = checker.getPropertyOfType(
          checker.getApparentType(arm.type),
          key,
        );
        if (!member || member.flags & ts.SymbolFlags.Optional) return true;
        const type = checker.getTypeOfSymbol(member);
        return (type.isUnion() ? type.types : [type]).some(
          (part) =>
            !!(
              part.flags &
              (ts.TypeFlags.Undefined |
                ts.TypeFlags.Void |
                ts.TypeFlags.Any |
                ts.TypeFlags.Unknown)
            ),
        );
      });
    } else {
      if (declaration.dotDotDotToken)
        return source.length <= 1 ? WRITTEN : undefined;
      result = element(
        source,
        pattern.elements.indexOf(declaration),
        declaration.name,
      );
    }
    if (declaration.initializer && defaults)
      result = merge([result, arms(declaration.initializer)]);
    // A `let` or `var` binding can be assigned again.
    const list = ts.findAncestor(declaration, ts.isVariableDeclarationList);
    if (
      list &&
      !(list.flags & ts.NodeFlags.Const) &&
      ts.isIdentifier(declaration.name)
    ) {
      const writes = assignments(declaration);
      if (!writes) return undefined;
      result = merge([
        result,
        ...writes.map((value) => (value ? arms(value) : undefined)),
      ]);
    }
    return result;
  }

  /** The value returned by calling the body `fn`, as arms. */
  /** The expressions `fn` returns, or undefined for a generator. */
  function returnExpressions(
    fn: Callable,
  ): readonly ts.Expression[] | undefined {
    if (!fn.body) return undefined;
    if ("asteriskToken" in fn && fn.asteriskToken) return undefined;
    const known = returnLists.get(fn);
    if (known) return known;
    const outs: ts.Expression[] = [];
    if (ts.isBlock(fn.body)) {
      const visit = (node: ts.Node) => {
        if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
        if (ts.isReturnStatement(node)) {
          if (node.expression) outs.push(node.expression);
        } else ts.forEachChild(node, visit);
      };
      ts.forEachChild(fn.body, visit);
    } else outs.push(fn.body);
    returnLists.set(fn, outs);
    return outs;
  }

  function returned(fn: Callable): Arms {
    const outs = returnExpressions(fn);
    return outs && merge(outs.map(arms));
  }

  /**
   * For a call to a plain function with one `return` and an inferred
   * return type (`function f2() { return f1(); }`), that returned
   * expression: the call's value is its value.
   */
  function onlyReturn(node: ts.CallExpression): ts.Expression | undefined {
    if (!ts.isIdentifier(node.expression) || node.typeArguments)
      return undefined;
    let symbol = checker.getSymbolAtLocation(node.expression);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const declarations = symbol?.declarations ?? [];
    const fn = declarations.length === 1 ? declarations[0]! : undefined;
    if (
      !fn ||
      !ts.isFunctionDeclaration(fn) ||
      fn.type ||
      fn.typeParameters?.length ||
      isAsync(fn)
    )
      return undefined;
    const outs = returnExpressions(fn);
    return outs?.length === 1 ? skipValue(outs[0]!) : undefined;
  }

  const isAsync = (fn: Callable) =>
    !!(ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Async);

  function call(start: ts.CallExpression): Arms {
    // A chain of such calls, followed without recursion: the checker infers
    // each return type from the next one's.
    let node = start;
    for (let steps = 0; ; steps++) {
      const next = steps < 100_000 ? onlyReturn(node) : undefined;
      if (!next) break;
      if (!ts.isCallExpression(next)) return arms(next);
      node = next;
    }
    if (node !== start) return arms(node);
    const callee = node.expression;
    // A module's value.
    if (
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) &&
        callee.text === "require" &&
        node.arguments.length === 1 &&
        ts.isStringLiteralLike(node.arguments[0]!))
    )
      return leaf(node);
    const callees = arms(callee);
    if (!callees) return undefined;
    if (callees.length > 1)
      // Several callees: each one's written return type.
      return merge(
        callees.map((arm) => {
          const signatures = checker.getSignaturesOfType(
            arm.type,
            ts.SignatureKind.Call,
          );
          const declaration =
            signatures.length === 1 ? signatures[0]!.declaration : undefined;
          return declaration &&
            !ts.isJSDocSignature(declaration) &&
            declaration.type &&
            !declaration.typeParameters?.length
            ? [
                {
                  type: checker.getNonNullableType(
                    signatures[0]!.getReturnType(),
                  ),
                },
              ]
            : undefined;
        }),
      );
    const declaration = checker.getResolvedSignature(node)?.declaration;
    // No declaration (`require` in JavaScript, an untyped callee) or a JSDoc
    // signature: the type is not inferred from returns.
    if (!declaration || ts.isJSDocSignature(declaration)) return leaf(node);
    const generic = !node.typeArguments && !!declaration.typeParameters?.length;
    if (generic && !argumentsUnreduced(node)) return undefined;
    if (declaration.type) return leaf(node);
    if (!hasBody(declaration)) return undefined;
    const out = returned(declaration);
    // A generic body's arms are uninstantiated and an async body's are a
    // promise's: one arm is the call's own type.
    if (generic || isAsync(declaration))
      return out && out.length <= 1 ? leaf(node) : undefined;
    return out;
  }

  /**
   * Whether the walk's single arm for the value at `owner` is the checker's
   * own type there: then the checker's type at the next step (narrowed by
   * control flow) is that arm's, not a reduced union's.
   */
  function agrees(owners: readonly Arm[], owner: ts.Expression | undefined) {
    return (
      owners.length === 1 &&
      !!owner &&
      !owners[0]!.array &&
      owners[0]!.type === typeAt(owner)
    );
  }

  /** The arms of `name` read from each of `owners` (the value at `owner`). */
  function property(
    owners: Arms,
    name: string,
    at: ts.Node,
    owner?: ts.Expression,
  ): Arms {
    if (!owners) return undefined;
    if (!owners.length) return NO_ARMS;
    const checked = agrees(owners, owner);
    return merge(
      owners.map((arm) => {
        const type = checker.getApparentType(arm.type);
        const member = checker.getPropertyOfType(type, name);
        // An index signature, `any`: the checker's type, if it is the only arm.
        if (!member) {
          if (checked) return leaf(at);
          // An object literal without the key: `undefined`.
          return arm.type.symbol?.flags & ts.SymbolFlags.ObjectLiteral &&
            !checker.getIndexInfosOfType(type).length
            ? NO_ARMS
            : undefined;
        }
        const declarations = member.declarations ?? [];
        const result =
          declarations.length === 1
            ? declarationArms(declarations[0]!)
            : symbolArms(member);
        if (result !== WRITTEN) return result;
        return [
          {
            type: checker.getNonNullableType(
              checked
                ? checker.getTypeAtLocation(at)
                : checker.getTypeOfSymbol(member),
            ),
          },
        ];
      }),
    );
  }

  /** The arms of an element (index `index` if known) of each of `owners`. */
  function element(
    owners: Arms,
    index: number | undefined,
    at: ts.Node,
    owner?: ts.Expression,
  ): Arms {
    if (!owners) return undefined;
    if (!owners.length) return NO_ARMS;
    const checked = agrees(owners, owner);
    return merge(
      owners.map((arm): Arms => {
        const array = arm.array;
        if (array) {
          if (
            index !== undefined &&
            index < array.elements.length &&
            !array.elements.slice(0, index + 1).some(ts.isSpreadElement)
          ) {
            const item = array.elements[index]!;
            return ts.isOmittedExpression(item) ? NO_ARMS : arms(item);
          }
          return merge(
            array.elements.map((item) =>
              ts.isSpreadElement(item)
                ? element(
                    arms(item.expression),
                    undefined,
                    item,
                    item.expression,
                  )
                : ts.isOmittedExpression(item)
                  ? NO_ARMS
                  : arms(item),
            ),
          );
        }
        // A written array, tuple or iterable: the checker's element type.
        if (checked) return leaf(at);
        const type = arm.type;
        const tupleMember =
          index !== undefined
            ? checker.getPropertyOfType(type, String(index))
            : undefined;
        const elementType = tupleMember
          ? checker.getTypeOfSymbol(tupleMember)
          : checker.isArrayLikeType(type)
            ? checker.getIndexTypeOfType(type, ts.IndexKind.Number)
            : undefined;
        return elementType
          ? [{ type: checker.getNonNullableType(elementType) }]
          : undefined;
      }),
    );
  }

  /**
   * Whether the checker's `symbol` for `receiver.name` stands, and if not,
   * the members that replace it.
   */
  return (
    receiver: ts.Expression,
    name: string,
    symbol: ts.Symbol,
  ): ReceiverVerdict => {
    if (name.startsWith("#")) return undefined;
    let found: Arms;
    try {
      found = arms(receiver);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      active.clear();
      checking.clear();
      depth = 0;
      return "unverified";
    }
    if (!found) return "unverified";
    if (!found.length) return undefined;
    const members: ts.Symbol[] = [];
    for (const arm of found) {
      const member = checker.getPropertyOfType(
        checker.getApparentType(arm.type),
        name,
      );
      if (!member) {
        // One arm without a named member (an index signature): the checker's
        // own lookup decides, as before.
        if (found.length === 1) return undefined;
        return "unverified";
      }
      if (!members.includes(member)) members.push(member);
    }
    const expected = new Set(
      members.flatMap((member) => member.declarations ?? []),
    );
    const actual = symbol.declarations ?? [];
    if (
      actual.length === expected.size &&
      actual.every((declaration) => expected.has(declaration))
    )
      return undefined;
    return members;
  };
}
