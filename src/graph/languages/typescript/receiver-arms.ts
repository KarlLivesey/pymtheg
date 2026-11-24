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
  /**
   * An array derived from another whose elements have several producers
   * (`list.filter(…)`, `list.slice(1)`): those producers' arms, which any
   * element of it can be (C-41 review 2).
   */
  readonly items?: readonly Arm[];
  /** An object literal producer, whose properties and spreads a member read walks. */
  readonly literal?: ts.ObjectLiteralExpression;
  /**
   * A generic call's result whose type arguments the walk could not prove
   * unreduced: `type` is its instantiated type, `generic` the same type as
   * declared, type parameters left open. A member is taken from such an arm
   * only when the declared type has it with the same declarations: then it
   * is the container's own member (`Assertion<T>.toBe`), whatever arm the
   * checker reduced `T` to. A member reached through `T` itself is not.
   */
  readonly generic?: ts.Type;
}
type Arms = readonly Arm[] | undefined;
/** The declaration's type is written (or otherwise never reduced). */
const WRITTEN = Symbol("written");
type DeclarationArms = Arms | typeof WRITTEN;

const MAX_ARMS = 16;
/**
 * Nested steps followed before giving up (unresolved). Low enough that the
 * walk's own recursion cannot exhaust the stack at the limit, so the
 * outcome depends on this count, not on how deep the process already is
 * (C-41 review 3). A stack overflow inside the walk is the checker's limit
 * (extract.ts: CheckerLimit, the program is rebuilt), never an answer.
 */
export const MAX_DEPTH = 200;
/**
 * Expressions a member call's walk may compute, a cached result counted at
 * what it cost when computed, so the count does not depend on what earlier
 * walks cached (C-41 review 3: results touched by a cycle are not cached,
 * so a self-assigned `let` under nested choices grows exponentially). A
 * walk that reaches it leaves the call unresolved.
 */
export const MAX_STEPS = 20_000;

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

/** Array methods that return one of the array's elements. */
const ELEMENT_RESULTS = new Set(["find", "findLast", "at", "pop", "shift"]);
/** Array methods that return an array of (some of) its elements. */
const ARRAY_RESULTS = new Set([
  "filter",
  "slice",
  "sort",
  "reverse",
  "toSorted",
  "toReversed",
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

/** Primitive types, literals included: no member of theirs differs. */
const PRIMITIVE_FLAGS =
  ts.TypeFlags.StringLike |
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.BigIntLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.ESSymbolLike |
  ts.TypeFlags.Void |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Null;

/** Observation counters (C-41 review 2): member calls walked, expressions computed. */
export const receiverStatistics = {
  calls: 0,
  expressions: 0,
  /** The largest step count and nesting depth one call reached. */
  maxSteps: 0,
  maxDepth: 0,
  /** Calls that reached MAX_STEPS or MAX_DEPTH. */
  budgetCuts: 0,
  depthCuts: 0,
};

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
  program?: ts.Program,
) {
  const values = new WeakMap<ts.Node, Arms | null>();
  const declared = new WeakMap<ts.Node, DeclarationArms | null>();
  const unreducedCache = new WeakMap<ts.Node, boolean>();
  const active = new Set<ts.Node>();
  const returnLists = new WeakMap<ts.Node, readonly ts.Expression[]>();
  const mutationCache = new WeakMap<ts.Node, ts.Expression[] | null>();
  const checking = new Set<ts.Node>();
  const fileWrites = new WeakMap<
    ts.SourceFile,
    Map<ts.Symbol, (ts.Expression | undefined)[]>
  >();
  let depth = 0;
  /** This call's step count (MAX_STEPS) and deepest nesting. */
  let steps = 0;
  let deepest = 0;
  let overBudget = false;
  let overDepth = false;
  /** What each cached result cost when computed, in steps. */
  const valueCosts = new WeakMap<ts.Node, number>();
  const declaredCosts = new WeakMap<ts.Node, number>();
  const unreducedCosts = new WeakMap<ts.Node, number>();
  const costsOf = new WeakMap<object, WeakMap<ts.Node, number>>([
    [values, valueCosts],
    [declared, declaredCosts],
  ]);
  /** Charges `cost` steps; false (a cut) once the budget is spent. */
  const charge = (cost: number) => {
    steps += cost;
    if (steps <= MAX_STEPS) return true;
    overBudget = true;
    cuts++;
    return false;
  };
  /** Enters one nested step; false (a cut) at the depth limit. */
  const enter = () => {
    if (depth >= MAX_DEPTH) {
      overDepth = true;
      cuts++;
      return false;
    }
    depth++;
    if (depth > deepest) deepest = depth;
    return true;
  };
  const options: ts.CompilerOptions = program?.getCompilerOptions() ?? {};
  /**
   * Failures caused by the depth limit or a cycle: a result computed while
   * one happened depends on where the walk started, so it is not cached
   * (C-41 review 2).
   */
  let cuts = 0;
  /** Every property write in the program, by property name (lazily). */
  let propertyWrites:
    | Map<string, { target: ts.Node; value: ts.Expression | undefined }[]>
    | undefined;

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
      for (const found of list) {
        if (!found.array && !found.items && nullish(found.type)) continue;
        // A primitive literal is its primitive: no member differs.
        const arm =
          !found.array &&
          !found.items &&
          found.type.flags & ts.TypeFlags.Literal
            ? { type: checker.getBaseTypeOfLiteralType(found.type) }
            : found;
        if (
          arms.some((known) =>
            arm.array
              ? known.array === arm.array
              : arm.items
                ? known === arm
                : arm.literal
                  ? known.literal === arm.literal
                  : !known.array &&
                    !known.items &&
                    !known.literal &&
                    known.type === arm.type &&
                    known.generic === arm.generic,
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
    const costs = costsOf.get(cache);
    const known = cache.get(node);
    if (known !== undefined) {
      if (!charge(costs?.get(node) ?? 0)) return undefined;
      return known === null ? undefined : known;
    }
    if (active.has(node)) {
      cuts++;
      return undefined;
    }
    if (!charge(1) || !enter()) return undefined;
    active.add(node);
    const before = cuts;
    const start = steps - 1;
    try {
      const result = compute();
      if (result !== undefined || cuts === before) {
        cache.set(node, result === undefined ? null : result);
        costs?.set(node, steps - start);
      }
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
    receiverStatistics.expressions++;
    const value = skipValue(node);
    if (value !== node) return arms(value);
    // `x as const` keeps the value (`[pick ? one : two] as const`); any
    // other assertion writes a type.
    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      ts.isConstTypeReference(node.type)
    )
      return arms(node.expression);
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
      return leaf(node);
    if (ts.isConditionalExpression(node))
      return merge([arms(node.whenTrue), arms(node.whenFalse)]);
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      // `x ??= y` and `x ||= y` are `x ?? y` and `x || y` (C-41 review 3).
      if (
        operator === ts.SyntaxKind.QuestionQuestionToken ||
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionEqualsToken ||
        operator === ts.SyntaxKind.BarBarEqualsToken
      ) {
        // A left side that is never nullish (`??`) or never falsy (`||`,
        // only objects) is the value.
        const left = checker.getTypeAtLocation(node.left);
        const parts = left.isUnion() ? left.types : [left];
        // Without strictNullChecks a type never shows `null` or `undefined`,
        // so neither operator can rule out the right side.
        const strict = !!(
          options.strictNullChecks ??
          (options.strict && options.strictNullChecks !== false)
        );
        const nullish =
          operator === ts.SyntaxKind.QuestionQuestionToken ||
          operator === ts.SyntaxKind.QuestionQuestionEqualsToken;
        const always =
          strict &&
          parts.every((part) =>
            nullish
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
      // `x &&= y` is `x && y`.
      if (
        operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
        operator === ts.SyntaxKind.CommaToken ||
        operator === ts.SyntaxKind.EqualsToken
      )
        return arms(node.right);
      // Arithmetic, comparison, `in`, `instanceof`: a primitive. Any other
      // operator whose value is not a primitive is not followed.
      return typeAt(node).flags & PRIMITIVE_FLAGS ? leaf(node) : undefined;
    }
    if (ts.isArrayLiteralExpression(node))
      return [{ type: typeAt(node), array: node }];
    if (ts.isObjectLiteralExpression(node))
      return [{ type: typeAt(node), literal: node }];
    if (
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
    // A tagged template is a call; `yield` takes the generator's next value,
    // a type its signature writes.
    if (ts.isTaggedTemplateExpression(node)) {
      const declaration = checker.getResolvedSignature(node)?.declaration;
      return !declaration ||
        ts.isJSDocSignature(declaration) ||
        declaration.type
        ? leaf(node)
        : undefined;
    }
    if (ts.isYieldExpression(node)) return leaf(node);
    if (ts.isAwaitExpression(node)) {
      const inner = arms(node.expression);
      if (!inner || inner.length > 1) return undefined;
      // A generic result stays one (`await load(pick ? a : b)`).
      const generic = inner[0]?.generic;
      if (generic) {
        const awaited = checker.getAwaitedType(generic);
        return awaited ? [{ type: typeAt(node), generic: awaited }] : undefined;
      }
      if (inner[0] && (inner[0].array || inner[0].items)) return inner;
      return leaf(node);
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
      // Generic when the constructed class itself has type parameters
      // inferred here; a constructor inherited from a generic base class has
      // them fixed by the `extends` clause.
      const generic = !node.typeArguments && constructsGeneric(node);
      const callee = arms(node.expression);
      if (!callee || callee.length > 1) return undefined;
      if (generic && !argumentsUnreduced(node)) {
        const declared = constructedType(node);
        return declared
          ? [{ type: typeAt(node), generic: declared }]
          : undefined;
      }
      return leaf(node);
    }
    return undefined;
  }

  /** The constructed class's type as declared, type parameters open. */
  function constructedType(node: ts.NewExpression): ts.Type | undefined {
    let symbol = checker.getSymbolAtLocation(node.expression);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    return symbol?.declarations?.some(ts.isClassLike)
      ? checker.getDeclaredTypeOfSymbol(symbol)
      : undefined;
  }

  /** Whether `member` is an instantiation, not its declaration's own symbol. */
  function instantiatedMember(member: ts.Symbol): boolean {
    const declaration = member.declarations?.[0];
    if (!declaration) return false;
    // A shorthand property's name resolves to its value, not the member: a
    // transient member is the checker's (instantiated) copy (C-41 review 3,
    // `return { current }` in a generic helper).
    if (ts.isShorthandPropertyAssignment(declaration))
      return !!(member.flags & ts.SymbolFlags.Transient);
    const name = (declaration as ts.NamedDeclaration).name;
    const own = name && checker.getSymbolAtLocation(name);
    return !!own && own !== member;
  }

  function sameDeclarations(one: ts.Symbol, other: ts.Symbol): boolean {
    const a = one.declarations ?? [];
    const b = new Set(other.declarations ?? []);
    return a.length === b.size && a.every((declaration) => b.has(declaration));
  }

  function constructsGeneric(node: ts.NewExpression): boolean {
    let symbol = checker.getSymbolAtLocation(node.expression);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const declarations = symbol?.declarations ?? [];
    const known = declarations.filter(
      (declaration) =>
        ts.isClassLike(declaration) || ts.isInterfaceDeclaration(declaration),
    );
    // An unknown constructor (a value of a constructor type): its resolved
    // signature decides.
    if (!known.length) {
      const declaration = checker.getResolvedSignature(node)?.declaration;
      return (
        !!declaration &&
        !ts.isJSDocSignature(declaration) &&
        !!(
          declaration.typeParameters?.length ||
          (ts.isClassLike(declaration.parent) &&
            declaration.parent.typeParameters?.length)
        )
      );
    }
    return known.some((declaration) => !!declaration.typeParameters?.length);
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
    // A value and a type of one name (`const t = …; type t = …`): the value.
    const declarations = (symbol.declarations ?? []).filter(
      (declaration) =>
        !ts.isTypeAliasDeclaration(declaration) &&
        !(
          ts.isInterfaceDeclaration(declaration) &&
          symbol.flags & ts.SymbolFlags.Variable
        ),
    );
    if (declarations.length === 1) return declarationArms(declarations[0]!);
    // A getter and a setter: the getter's returns (C-41 review 3).
    const getter = declarations.find(ts.isGetAccessorDeclaration);
    if (getter) return declarationArms(getter);
    if (declarations.some(ts.isSetAccessorDeclaration)) return undefined;
    // Overloads, declaration merging (a class and an interface, a function
    // and a namespace): declared, not computed.
    return declarations.every(
      (declaration) =>
        // An ambient declaration (`interface Date` and `declare var Date`)
        // is written.
        declaration.getSourceFile().isDeclarationFile ||
        (!ts.isVariableDeclaration(declaration) &&
          !ts.isPropertyAssignment(declaration) &&
          !ts.isShorthandPropertyAssignment(declaration) &&
          !ts.isBindingElement(declaration) &&
          !ts.isBinaryExpression(declaration)),
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
      ts.isNamespaceExport(declaration) ||
      ts.isNamespaceExportDeclaration(declaration) ||
      ts.isExportDeclaration(declaration) ||
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
      if (declaration.type) return WRITTEN;
      // Its initializer and every write to it anywhere in the program
      // (`this.h = b` in another method, a constructor's branches).
      const writes = memberWrites(declaration);
      if (!writes) return undefined;
      const values = declaration.initializer
        ? [declaration.initializer, ...writes]
        : writes;
      if (!values.length) return WRITTEN;
      return merge(values.map(arms));
    }
    if (ts.isPropertyAssignment(declaration)) {
      const writes = memberWrites(declaration);
      if (!writes) return undefined;
      return merge([declaration.initializer, ...writes].map(arms));
    }
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

  /**
   * The values written to the member `declaration` declares, anywhere in
   * the program (`state.h = b`, `this.h = b`): undefined when one is not a
   * plain assignment, or the program is not known.
   */
  function memberWrites(
    declaration: ts.PropertyDeclaration | ts.PropertyAssignment,
  ): ts.Expression[] | undefined {
    const name = staticName(declaration.name);
    if (name === undefined || !program) return undefined;
    const own = checker.getSymbolAtLocation(declaration.name);
    if (!own) return undefined;
    if (!propertyWrites) {
      const found = new Map<
        string,
        { target: ts.Node; value: ts.Expression | undefined }[]
      >();
      const scan = (node: ts.Node): void => {
        if (
          (ts.isPropertyAccessExpression(node) ||
            ts.isElementAccessExpression(node)) &&
          isWrite(node)
        ) {
          const key = ts.isPropertyAccessExpression(node)
            ? node.name.text
            : ts.isStringLiteralLike(node.argumentExpression) ||
                ts.isNumericLiteral(node.argumentExpression)
              ? node.argumentExpression.text
              : undefined;
          const parent = node.parent;
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
          // A computed key: kept with its receiver, which decides below
          // whether the member could be the one written.
          const list = found.get(key ?? "\0") ?? [];
          list.push({
            target:
              key === undefined
                ? node.expression
                : ts.isPropertyAccessExpression(node)
                  ? node.name
                  : node.argumentExpression,
            value,
          });
          found.set(key ?? "\0", list);
        }
        // `Object.assign(target, …)` writes any member of its target, as a
        // computed key does (C-41 review 3).
        if (
          ts.isCallExpression(node) &&
          node.arguments.length &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "assign" &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "Object"
        ) {
          const list = found.get("\0") ?? [];
          list.push({ target: node.arguments[0]!, value: undefined });
          found.set("\0", list);
        }
        ts.forEachChild(node, scan);
      };
      for (const file of program.getSourceFiles())
        if (!file.isDeclarationFile) scan(file);
      propertyWrites = found;
    }
    // A write through a computed key, or `Object.assign`, to an object
    // that has this member: by declaration, since an object literal's or a
    // class's property symbol differs from the declaration's own (C-41
    // review 3).
    for (const { target } of propertyWrites.get("\0") ?? []) {
      const member = checker.getPropertyOfType(
        checker.getApparentType(checker.getTypeAtLocation(target)),
        name,
      );
      if (member === own || member?.declarations?.includes(declaration))
        return undefined;
    }
    const values: ts.Expression[] = [];
    for (const { target, value } of propertyWrites.get(name) ?? []) {
      let written = checker.getSymbolAtLocation(target);
      if (written && written.flags & ts.SymbolFlags.Alias)
        written = checker.getAliasedSymbol(written);
      // The same member: its symbol, or (widened, instantiated) one that
      // names this declaration.
      if (written !== own && !written?.declarations?.includes(declaration))
        continue;
      if (!value) return undefined;
      values.push(value);
    }
    return values;
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
    if (!contextual) {
      if (!declaration.initializer) return WRITTEN;
      // A default is one producer; every call site's argument is another.
      return callSiteArms(declaration);
    }
    const own = callbackElement(declaration);
    if (own !== null) return own;
    if (contextOf(fn)) return WRITTEN;
    // Typed by a generic call whose instantiation the walk cannot prove
    // unreduced: the parameter keeps its type as the signature declares it.
    const declared = contextualDeclared(fn, fn.parameters.indexOf(declaration));
    return declared
      ? [{ type: typeAt(declaration.name), generic: declared }]
      : undefined;
  }

  /**
   * The values a defaulted parameter of a plain, unexported function can
   * hold: its default where a call omits it, and each call's argument. A
   * method, a constructor, an exported function or one used other than by
   * direct calls in its file has call sites the walk cannot enumerate:
   * unresolved (C-41 review 2).
   */
  function callSiteArms(declaration: ts.ParameterDeclaration): Arms {
    const fn = declaration.parent;
    if (
      !ts.isFunctionDeclaration(fn) ||
      !fn.name ||
      ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Export
    )
      return undefined;
    const index = fn.parameters.indexOf(declaration);
    const own = checker.getSymbolAtLocation(fn.name);
    if (!own) return undefined;
    const file = fn.getSourceFile();
    const values: ts.Expression[] = [];
    let omitted = false;
    let escapes = false;
    const visit = (node: ts.Node): void => {
      if (escapes) return;
      if (
        ts.isIdentifier(node) &&
        node !== fn.name &&
        node.text === fn.name!.text
      ) {
        // Every reference counts, through `export { f }` and `{ f }` too; one
        // the checker cannot place is taken as an escape (C-41 review 3).
        const parent = node.parent;
        let symbol = ts.isExportSpecifier(parent)
          ? checker.getExportSpecifierLocalTargetSymbol(parent)
          : ts.isShorthandPropertyAssignment(parent) && parent.name === node
            ? checker.getShorthandAssignmentValueSymbol(parent)
            : checker.getSymbolAtLocation(node);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias)
          symbol = checker.getAliasedSymbol(symbol);
        if (!symbol) {
          escapes = true;
          return;
        }
        if (symbol !== own) {
          ts.forEachChild(node, visit);
          return;
        }
        const call = node.parent;
        if (
          !ts.isCallExpression(call) ||
          call.expression !== node ||
          call.arguments.some(ts.isSpreadElement)
        ) {
          escapes = true;
          return;
        }
        const argument = call.arguments[index];
        if (argument) values.push(argument);
        else omitted = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    // `export { f }` or `export default f` are references too.
    if (escapes) return undefined;
    if (omitted || !values.length) values.push(declaration.initializer!);
    return merge(values.map(arms));
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

  /**
   * The declared type of parameter `index` of the function `fn`, from the
   * uninstantiated signature of the call it is passed to: through object
   * literal properties (`{ middleware: (gDM) => … }`) and returned
   * functions (`() => (next) => …`) on the way.
   */
  function contextualDeclared(
    fn: ts.SignatureDeclaration,
    index: number,
  ): ts.Type | undefined {
    if (index < 0) return undefined;
    const path: (string | null)[] = [];
    let at: ts.Node = fn;
    for (let step = 0; step < 16; step++) {
      while (
        ts.isParenthesizedExpression(at.parent) ||
        ts.isSatisfiesExpression(at.parent)
      )
        at = at.parent;
      const parent = at.parent;
      if (ts.isPropertyAssignment(parent) && parent.initializer === at) {
        const key = staticName(parent.name);
        if (key === undefined) return undefined;
        path.unshift(key);
        at = parent.parent;
        continue;
      }
      if (ts.isMethodDeclaration(at) && ts.isObjectLiteralExpression(parent)) {
        const key = staticName(at.name);
        if (key === undefined) return undefined;
        path.unshift(key);
        at = parent;
        continue;
      }
      // Returned by a function: `null` marks the step through its return.
      if (ts.isArrowFunction(parent) && parent.body === at) {
        path.unshift(null);
        at = parent;
        continue;
      }
      if (ts.isReturnStatement(parent)) {
        const owner = ts.findAncestor(parent, ts.isFunctionLike);
        if (
          !owner ||
          !(ts.isFunctionExpression(owner) || ts.isArrowFunction(owner))
        )
          return undefined;
        path.unshift(null);
        at = owner;
        continue;
      }
      if (
        !(ts.isCallExpression(parent) || ts.isNewExpression(parent)) ||
        !parent.arguments?.includes(at as ts.Expression)
      )
        return undefined;
      const callee = arms(parent.expression);
      if (!callee || callee.length > 1) return undefined;
      const declaration = checker.getResolvedSignature(parent)?.declaration;
      if (!declaration || ts.isJSDocSignature(declaration)) return undefined;
      const signature = checker.getSignatureFromDeclaration(declaration);
      if (!signature?.parameters.length) return undefined;
      const position = parent.arguments.indexOf(at as ts.Expression);
      const parameter =
        signature.parameters[
          Math.min(position, signature.parameters.length - 1)
        ]!;
      let type: ts.Type | undefined = checker.getTypeOfSymbol(parameter);
      for (const key of path) {
        const plain = checker.getNonNullableType(type);
        if (key === null) {
          const signatures = checker.getSignaturesOfType(
            plain,
            ts.SignatureKind.Call,
          );
          if (signatures.length !== 1) return undefined;
          type = signatures[0]!.getReturnType();
        } else {
          const member = checker.getPropertyOfType(
            checker.getApparentType(plain),
            key,
          );
          if (!member) return undefined;
          type = checker.getTypeOfSymbol(member);
        }
      }
      const signatures = checker.getSignaturesOfType(
        checker.getNonNullableType(type),
        ts.SignatureKind.Call,
      );
      if (signatures.length !== 1) return undefined;
      const own = signatures[0]!.parameters[index];
      return own && checker.getTypeOfSymbol(own);
    }
    return undefined;
  }

  /** A call's callee is one value and its type arguments are not reduced. */
  function callAccepted(call: ts.CallExpression | ts.NewExpression): boolean {
    const callee = arms(call.expression);
    if (!callee || callee.length > 1) return false;
    // A method of a generic result (`load(…).then(v => …)`) or of an array
    // whose elements have several producers: its callback's parameters
    // are typed from the reduced type argument (C-41 review 2).
    if (callee[0]?.generic) return false;
    if (ts.isPropertyAccessExpression(call.expression)) {
      const owners = arms(call.expression.expression);
      if (!owners) return false;
      if (owners.some((arm) => arm.generic)) return false;
      const elements = elementsOf(owners);
      if (elements === undefined) return false;
      if (elements.length > 1 && reducible(elements)) return false;
    }
    if (call.typeArguments?.length) return true;
    const declaration = checker.getResolvedSignature(call)?.declaration;
    if (!declaration || ts.isJSDocSignature(declaration)) return true;
    const generic =
      !!declaration.typeParameters?.length ||
      (ts.isConstructorDeclaration(declaration) &&
        !!declaration.parent.typeParameters?.length);
    return !generic || argumentsUnreduced(call, true);
  }

  /**
   * Whether the checker's union of these arms can have dropped one: subtype
   * reduction removes an arm assignable to another, so arms none of which is
   * assignable to another are all kept. (Assignability is wider than the
   * subtype relation the reduction uses, so this errs towards "reducible".)
   */
  function reducible(found: readonly Arm[]): boolean {
    for (const one of found)
      for (const other of found)
        if (one !== other && checker.isTypeAssignableTo(one.type, other.type))
          return true;
    return false;
  }

  /** No argument of a generic call is a reduced value (its type arguments). */
  function argumentsUnreduced(
    call: ts.CallExpression | ts.NewExpression,
    skipFunctions = false,
  ): boolean {
    // Inference unions what several arguments give one type parameter
    // (`either(a, b)`): their arms together must not be reducible.
    const together: Arms[] = [];
    for (const argument of call.arguments ?? []) {
      const value = skipValue(argument);
      const fn = ts.isFunctionExpression(value) || ts.isArrowFunction(value);
      if (skipFunctions && fn) continue;
      const inner = ts.isSpreadElement(value) ? value.expression : value;
      if (!unreduced(inner)) return false;
      if (fn) {
        if (!value.type) together.push(returned(value));
      } else if (ts.isSpreadElement(value)) {
        const spread = arms(inner);
        together.push(spread && elementsOf(spread));
      } else if (!ts.isObjectLiteralExpression(inner))
        together.push(expandArrays(arms(inner)));
    }
    const all = merge(together);
    return !!all && !reducible(all);
  }

  /** Whether the value of `expression` (and what a generic infers from it) is one arm. */
  function unreduced(expression: ts.Expression): boolean {
    const known = unreducedCache.get(expression);
    if (known !== undefined)
      return charge(unreducedCosts.get(expression) ?? 0) && known;
    if (checking.has(expression)) {
      cuts++;
      return false;
    }
    if (!charge(1) || !enter()) return false;
    checking.add(expression);
    const before = cuts;
    const start = steps - 1;
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
        result = !!elements && !reducible(elements);
      } else if (ts.isFunctionExpression(value) || ts.isArrowFunction(value)) {
        if (value.type) result = true;
        else {
          const out = returned(value);
          result = !!out && !reducible(out);
        }
      } else {
        // An array value counts by its elements (`head(list)`).
        const out = expandArrays(arms(value));
        result = !!out && !reducible(out);
      }
    } finally {
      depth--;
      checking.delete(expression);
    }
    if (result || cuts === before) {
      unreducedCache.set(expression, result);
      unreducedCosts.set(expression, steps - start);
    }
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

  /** The element producers' arms of array arms; undefined if any is not one. */
  function elementsOf(owners: readonly Arm[]): Arms {
    if (!owners.some((arm) => arm.array || arm.items)) return [];
    return merge(
      owners.map((arm): Arms => {
        if (arm.items) return arm.items;
        if (arm.array) return element([arm], undefined, arm.array);
        return undefined;
      }),
    );
  }

  /** Arms with every array arm replaced by its elements' arms. */
  function expandArrays(found: Arms): Arms {
    if (!found) return undefined;
    return merge(
      found.map((arm): Arms =>
        arm.array || arm.items ? elementsOf([arm]) : [arm],
      ),
    );
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
    // A method of an array whose elements have several producers: an
    // element-returning method gives those producers, an array-returning one
    // an array of them, any other is not followed (C-41 review 2).
    if (ts.isPropertyAccessExpression(callee)) {
      const owners = arms(callee.expression);
      if (!owners) return undefined;
      const elements = elementsOf(owners);
      if (elements === undefined) return undefined;
      if (elements.length > 1 && reducible(elements)) {
        const method = callee.name.text;
        if (ELEMENT_RESULTS.has(method)) return elements;
        if (ARRAY_RESULTS.has(method))
          return [{ type: typeAt(node), items: elements }];
        return undefined;
      }
    }
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
    // Through a generic container, or with type arguments the walk cannot
    // prove unreduced: the result keeps its declared type beside it.
    if (callees[0]?.generic || (generic && !argumentsUnreduced(node))) {
      if (declaration.type)
        return [
          {
            type: typeAt(node),
            generic: checker.getTypeFromTypeNode(declaration.type),
          },
        ];
      // An inferred return: its declared form is the signature's, if the
      // body's returns are not themselves a reduced union.
      if (!hasBody(declaration)) return undefined;
      const out = returned(declaration);
      if (!out || reducible(out)) return undefined;
      const signature = checker.getSignatureFromDeclaration(declaration);
      return signature
        ? [
            {
              type: typeAt(node),
              generic: checker.getReturnTypeOfSignature(signature),
            },
          ]
        : undefined;
    }
    if (declaration.type) return leaf(node);
    if (!hasBody(declaration)) return undefined;
    const out = returned(declaration);
    // A generic body's arms are uninstantiated (also a method of an
    // instantiated generic class: its signature is not the declared one)
    // and an async body's are a promise's: unreduced, the call's own type.
    const signature = checker.getResolvedSignature(node);
    if (
      generic ||
      isAsync(declaration) ||
      signature !== checker.getSignatureFromDeclaration(declaration)
    )
      return out && !reducible(out) ? leaf(node) : undefined;
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
      !owners[0]!.items &&
      !owners[0]!.literal &&
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
        if (arm.literal) return literalMember(arm.literal, name, at);
        const type = checker.getApparentType(arm.type);
        const member = checker.getPropertyOfType(type, name);
        if (arm.generic) {
          const counterpart = checker.getPropertyOfType(
            checker.getApparentType(arm.generic),
            name,
          );
          if (!member || !counterpart || !sameDeclarations(member, counterpart))
            return undefined;
          const declaration = counterpart.declarations?.[0];
          const written =
            declaration &&
            (ts.isPropertySignature(declaration) ||
              ts.isPropertyDeclaration(declaration) ||
              ts.isGetAccessorDeclaration(declaration))
              ? declaration.type
              : undefined;
          if (
            !written &&
            !(
              declaration &&
              (ts.isMethodSignature(declaration) ||
                ts.isMethodDeclaration(declaration))
            )
          )
            return undefined;
          return [
            {
              type: checker.getNonNullableType(
                checked
                  ? checker.getTypeAtLocation(at)
                  : checker.getTypeOfSymbol(member),
              ),
              generic: written
                ? checker.getTypeFromTypeNode(written)
                : checker.getTypeOfSymbol(counterpart),
            },
          ];
        }
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
        // A member of an instantiated generic type (`ZodObject<…>.shape`):
        // its declaration's initialiser or body is in the generic's terms,
        // so it only says whether a union forms there; the value is the
        // instantiated member's.
        if (result !== WRITTEN && instantiatedMember(member)) {
          if (!result || reducible(result)) return undefined;
        } else if (result !== WRITTEN) return result;
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

  /**
   * The value of `name` on the object literal `node`: its last own
   * property of that name, or what the spreads after it supply
   * (`{ ...defaultHooks, ...opts }`, `{ ...(pick ? { r: one } : { r: two }) }`).
   * A spread that may lack the member lets an earlier one supply it too.
   */
  function literalMember(
    node: ts.ObjectLiteralExpression,
    name: string,
    at: ts.Node,
  ): Arms {
    const collected: Arms[] = [];
    for (let index = node.properties.length - 1; index >= 0; index--) {
      const property = node.properties[index]!;
      if (ts.isSpreadAssignment(property)) {
        const spread = arms(property.expression);
        if (!spread) return undefined;
        let always = spread.length > 0;
        for (const arm of spread) {
          const member = arm.literal
            ? undefined
            : checker.getPropertyOfType(
                checker.getApparentType(arm.type),
                name,
              );
          if (arm.literal) {
            const inner = literalMember(arm.literal, name, at);
            if (!inner) return undefined;
            collected.push(inner);
            // Whether this literal always has the member: unknown, so earlier
            // properties count too unless it is its own property.
            always &&= arm.literal.properties.some(
              (item) =>
                !ts.isSpreadAssignment(item) &&
                item.name !== undefined &&
                staticName(item.name) === name,
            );
            continue;
          }
          if (!member) {
            always = false;
            continue;
          }
          if (member.flags & ts.SymbolFlags.Optional) always = false;
          collected.push(property_(arm, name, at));
        }
        if (always) return merge(collected);
        continue;
      }
      const key = property.name && staticName(property.name);
      if (key === undefined) return undefined;
      if (key !== name) continue;
      // A setter's value is what its getter returns (C-41 review 3).
      if (ts.isSetAccessorDeclaration(property)) {
        const getter = node.properties.find(
          (item): item is ts.GetAccessorDeclaration =>
            ts.isGetAccessorDeclaration(item) && staticName(item.name) === name,
        );
        if (!getter) return undefined;
        const value = declarationArms(getter);
        collected.push(
          value === WRITTEN ? [{ type: typeAt(getter.name) }] : value,
        );
        return merge(collected);
      }
      let own = checker.getSymbolAtLocation(property.name!);
      if (ts.isShorthandPropertyAssignment(property))
        own = checker.getShorthandAssignmentValueSymbol(property) ?? own;
      if (
        ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property) ||
        // A getter without a written type: its returns.
        (ts.isGetAccessorDeclaration(property) && !property.type)
      ) {
        const value = declarationArms(property);
        collected.push(
          value === WRITTEN ? [{ type: typeAt(property.name!) }] : value,
        );
      } else
        collected.push([
          {
            type: checker.getNonNullableType(
              own ? checker.getTypeOfSymbol(own) : typeAt(property),
            ),
          },
        ]);
      return merge(collected);
    }
    return merge(collected);
  }

  /** A member of one (non-literal) arm, as `property` reads it. */
  function property_(arm: Arm, name: string, at: ts.Node): Arms {
    const { literal: _literal, ...plain } = arm;
    return property([plain], name, at);
  }

  /**
   * Values an array literal bound to a name gets after it is created, in its
   * file (`plugins.push(extra)`, `plugins[0] = x`): undefined when one is
   * not followed (C-41 review 2).
   */
  function arrayMutations(
    node: ts.ArrayLiteralExpression,
  ): ts.Expression[] | undefined {
    const known = mutationCache.get(node);
    if (known !== undefined) return known ?? undefined;
    let at: ts.Node = node;
    while (
      ts.isParenthesizedExpression(at.parent) ||
      ts.isSatisfiesExpression(at.parent) ||
      (ts.isAsExpression(at.parent) && ts.isConstTypeReference(at.parent.type))
    )
      at = at.parent;
    const holder = at.parent;
    if (
      !ts.isVariableDeclaration(holder) ||
      holder.initializer !== at ||
      !ts.isIdentifier(holder.name)
    ) {
      mutationCache.set(node, []);
      return [];
    }
    const own = checker.getSymbolAtLocation(holder.name);
    const values: ts.Expression[] = [];
    let unknown = false;
    const visit = (child: ts.Node): void => {
      if (unknown) return;
      if (
        ts.isIdentifier(child) &&
        child !== holder.name &&
        child.text === (holder.name as ts.Identifier).text &&
        checker.getSymbolAtLocation(child) === own
      ) {
        const parent = child.parent;
        if (
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === child
        ) {
          const call = parent.parent;
          const method = parent.name.text;
          if (ts.isCallExpression(call) && call.expression === parent) {
            const added =
              method === "push" || method === "unshift"
                ? call.arguments
                : method === "splice"
                  ? call.arguments.slice(2)
                  : method === "fill"
                    ? call.arguments.slice(0, 1)
                    : method === "copyWithin"
                      ? []
                      : undefined;
            if (added) {
              if (added.some(ts.isSpreadElement)) unknown = true;
              else values.push(...added);
            }
          }
        } else if (
          ts.isElementAccessExpression(parent) &&
          parent.expression === child &&
          isWrite(parent)
        ) {
          const assignment = parent.parent;
          if (
            ts.isBinaryExpression(assignment) &&
            assignment.left === parent &&
            assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken
          )
            values.push(assignment.right);
          else unknown = true;
        }
      }
      ts.forEachChild(child, visit);
    };
    visit(holder.getSourceFile());
    mutationCache.set(node, unknown ? null : values);
    return unknown ? undefined : values;
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
        if (arm.generic) return undefined;
        if (arm.items) return merge([arm.items]);
        const array = arm.array;
        if (array) {
          const added = arrayMutations(array);
          if (!added) return undefined;
          if (added.length)
            return merge([
              ...array.elements.map((item) =>
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
              ...added.map(arms),
            ]);
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
    receiverStatistics.calls++;
    steps = 0;
    deepest = 0;
    overBudget = false;
    overDepth = false;
    let found: Arms;
    try {
      found = arms(receiver);
    } catch (error) {
      // A stack overflow (in the walk or the checker it asks) is not an
      // answer: it reaches extract.ts, which rebuilds the program (CheckerLimit).
      active.clear();
      checking.clear();
      depth = 0;
      throw error;
    } finally {
      if (steps > receiverStatistics.maxSteps)
        receiverStatistics.maxSteps = steps;
      if (deepest > receiverStatistics.maxDepth)
        receiverStatistics.maxDepth = deepest;
      if (overBudget) receiverStatistics.budgetCuts++;
      if (overDepth) receiverStatistics.depthCuts++;
    }
    // The budget or the depth limit was reached: whatever was found is not
    // all the walk would follow.
    if (overBudget || overDepth) return "unverified";
    if (!found) return "unverified";
    if (!found.length) return undefined;
    // Control flow narrows the value at the receiver (`typeof r === "string"
    // ? r : r.toString()`, `instanceof`): the arms the checker's own type
    // there can hold. A reduction keeps both arms (each is assignable to the
    // reduced one); narrowing drops the parts it excludes.
    const at = checker.getNonNullableType(checker.getTypeAtLocation(receiver));
    const parts = (type: ts.Type) => (type.isUnion() ? type.types : [type]);
    const own = new Set(parts(at));
    const split: Arm[] = found.flatMap((arm) =>
      arm.generic || arm.array || arm.items
        ? [arm]
        : parts(arm.type)
            .filter((part) => !nullish(part))
            .map((part) => ({ type: part })),
    );
    // A primitive part is held only by a primitive of its kind (`string` is
    // structurally assignable to a class with only `toString`).
    const PRIMITIVE =
      ts.TypeFlags.StringLike |
      ts.TypeFlags.NumberLike |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.BooleanLike |
      ts.TypeFlags.ESSymbolLike;
    const held = split.filter((arm) => {
      if (arm.generic || arm.array || arm.items) return true;
      const primitive = arm.type.flags & PRIMITIVE;
      if (primitive) return [...own].some((part) => part.flags & primitive);
      return checker.isTypeAssignableTo(arm.type, at);
    });
    // Nothing the checker's type holds: it is not one of the arms, so not a
    // union the checker reduced (a reduction keeps an arm, and every arm is
    // assignable to it). A narrowing the walk does not see: its answer stands.
    if (!held.length) return undefined;
    const kept = held;
    // An open type parameter (from a generic body walked from outside) never
    // supplies a member, unless it is the checker's own type here (inside
    // that generic body, where its constraint is the answer).
    if (
      kept.some(
        (arm) =>
          !arm.generic &&
          !own.has(arm.type) &&
          !!(
            arm.type.flags &
            (ts.TypeFlags.TypeParameter | ts.TypeFlags.IndexedAccess)
          ) &&
          !(arm.type as { isThisType?: boolean }).isThisType,
      )
    )
      return "unverified";
    // The checker's own type, part for part: its answer stands.
    if (
      kept.length === own.size &&
      kept.every(
        (arm) => !arm.generic && !arm.array && !arm.items && own.has(arm.type),
      )
    )
      return undefined;
    const members: ts.Symbol[] = [];
    for (const arm of kept) {
      const member = checker.getPropertyOfType(
        checker.getApparentType(arm.type),
        name,
      );
      if (!member) {
        // One arm without a named member (an index signature): the checker's
        // own lookup decides, as before.
        if (kept.length === 1) return undefined;
        return "unverified";
      }
      if (arm.generic) {
        const counterpart = checker.getPropertyOfType(
          checker.getApparentType(arm.generic),
          name,
        );
        if (!counterpart || !sameDeclarations(member, counterpart))
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
