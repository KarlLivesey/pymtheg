// SPDX-License-Identifier: MIT
import ts from "typescript";
import { unwrap } from "./symbols.js";

type Callable =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;
const SHORT_CIRCUIT = Symbol("optional chain short circuit");
type AsyncResult = { readonly kind: "promise"; readonly values: Values };
type Producer =
  | ts.ObjectLiteralExpression
  | Callable
  | ts.SourceFile
  | AsyncResult
  | null
  | undefined
  | typeof SHORT_CIRCUIT;
type Values = readonly Producer[];
type ReturnValues = readonly (ts.Expression | undefined)[];

const isAsyncResult = (value: Producer): value is AsyncResult =>
  typeof value === "object" && value?.kind === "promise";

const isCallable = (node: ts.Node): node is Callable =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);

export function staticName(node: ts.Node): string | undefined {
  if (ts.isComputedPropertyName(node)) return literalKey(node.expression);
  return ts.isIdentifier(node) ||
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node)
    ? node.text
    : undefined;
}

const literalKey = (node: ts.Expression): string | undefined =>
  ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)
    ? node.text
    : undefined;

function ownMember(
  object: ts.ObjectLiteralExpression,
  name: string,
):
  | Exclude<ts.ObjectLiteralElementLike, ts.SpreadAssignment>
  | null
  | undefined {
  let customPrototype = false;
  for (let index = object.properties.length - 1; index >= 0; index--) {
    const property = object.properties[index]!;
    if (ts.isSpreadAssignment(property)) return undefined;
    const key = staticName(property.name);
    if (key === undefined) return undefined;
    if (
      key === "__proto__" &&
      ts.isPropertyAssignment(property) &&
      !ts.isComputedPropertyName(property.name)
    ) {
      customPrototype = true;
      continue;
    }
    if (key === name) return property;
  }
  // A missing own key supplies undefined only for a plain property's lookup.
  return customPrototype || Object.hasOwn(Object.prototype, name)
    ? undefined
    : null;
}

const MAX_PRODUCERS = 32;
const MAX_DEPTH = 32;

interface PropertyWrite {
  receivers: readonly ts.Expression[];
  key: string | undefined;
  /** Literal Object.assign sources may establish exactly which keys are written. */
  assigned?: readonly ts.Expression[];
}

export function propertyWrite(
  node: ts.Node,
  isWrite: (node: ts.Node) => number,
  writtenKey: (node: ts.Expression) => string | undefined = literalKey,
): PropertyWrite | undefined {
  if (
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node)
  ) {
    if (!isWrite(node) && !ts.isDeleteExpression(node.parent)) return undefined;
    return {
      receivers: [node.expression],
      key: ts.isPropertyAccessExpression(node)
        ? node.name.text
        : literalKey(node.argumentExpression),
    };
  }
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression)
  )
    return undefined;
  const { expression, name } = node.expression;
  const target = node.arguments[0];
  if (!target || !ts.isIdentifier(expression)) return undefined;
  const reflectSet = expression.text === "Reflect" && name.text === "set";
  if (
    reflectSet ||
    (expression.text === "Object" && name.text === "defineProperty")
  ) {
    const key = node.arguments[1] && writtenKey(node.arguments[1]);
    const receiver = reflectSet && node.arguments[3];
    return { receivers: receiver ? [target, receiver] : [target], key };
  }
  if (expression.text !== "Object") return undefined;
  if (name.text === "assign")
    return {
      receivers: [target],
      key: undefined,
      assigned: node.arguments.slice(1),
    };
  if (name.text === "defineProperties" || name.text === "setPrototypeOf")
    return { receivers: [target], key: undefined };
  return undefined;
}

export function propertyWriteKeys(
  write: PropertyWrite,
): (string | undefined)[] {
  if (!write.assigned) return [write.key];
  const keys: (string | undefined)[] = [];
  for (const source of write.assigned) {
    const value = unwrap(source);
    if (!ts.isObjectLiteralExpression(value)) return [undefined];
    for (const property of value.properties)
      keys.push(
        ts.isSpreadAssignment(property) ? undefined : staticName(property.name),
      );
  }
  return keys;
}

/**
 * Follow only captured, explicit value producers for newly accepted literal
 * members. The checker binds names, but its structural type can merge distinct
 * objects. It cannot tell us which literal supplied a value.
 */
export function objectProducers(
  program: ts.Program,
  checker: ts.TypeChecker,
  isWrite: (node: ts.Node) => number,
) {
  const cache = new WeakMap<ts.Node, Values>();
  const active = new Set<ts.Node>();
  const returns = new WeakMap<Callable, ReturnValues>();
  let writes:
    | {
        bindings: Map<ts.Symbol, (ts.Expression | null)[]>;
        properties: Map<string, Set<ts.Expression>>;
        openProperties: Set<ts.Expression>;
      }
    | undefined;

  function writtenKey(expression: ts.Expression): string | undefined {
    const key = unwrap(expression);
    if (!ts.isIdentifier(key)) return literalKey(key);
    let symbol = checker.getSymbolAtLocation(key);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    if (
      declaration &&
      symbol?.declarations?.length === 1 &&
      ts.isVariableDeclaration(declaration) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      declaration.parent.flags & ts.NodeFlags.Const &&
      declaration.initializer
    )
      return literalKey(unwrap(declaration.initializer));
    return undefined;
  }

  function knownWrites() {
    if (writes) return writes;
    const bindings = new Map<ts.Symbol, (ts.Expression | null)[]>();
    const properties = new Map<string, Set<ts.Expression>>();
    const openProperties = new Set<ts.Expression>();
    const addProperty = (name: string, target: ts.Expression) => {
      const previous = properties.get(name);
      if (previous) previous.add(target);
      else properties.set(name, new Set([target]));
    };
    const addProperties = (target: ts.Expression) => {
      openProperties.add(target);
      for (const member of checker.getPropertiesOfType(
        checker.getTypeAtLocation(target),
      ))
        addProperty(member.getName(), target);
    };
    const scan = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && isWrite(node)) {
        const symbol = ts.isShorthandPropertyAssignment(node.parent)
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
        if (symbol) {
          const assignment = node.parent;
          const value =
            ts.isBinaryExpression(assignment) &&
            assignment.left === node &&
            assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken
              ? assignment.right
              : null;
          const previous = bindings.get(symbol);
          if (previous) previous.push(value);
          else bindings.set(symbol, [value]);
        }
      } else {
        const write = propertyWrite(node, isWrite, writtenKey);
        if (write)
          for (const written of write.receivers) {
            if (write.key === undefined) addProperties(written);
            else addProperty(write.key, written);
          }
      }
      ts.forEachChild(node, scan);
    };
    for (const file of program.getSourceFiles())
      if (!file.isDeclarationFile) scan(file);
    return (writes = { bindings, properties, openProperties });
  }

  function combine<T>(
    inputs: readonly T[],
    get: (input: T) => Values | undefined,
  ): Values | undefined {
    const values = new Set<Producer>();
    for (const input of inputs) {
      const supplied = get(input);
      if (!supplied?.length) return undefined;
      for (const item of supplied) values.add(item);
      if (values.size > MAX_PRODUCERS) return undefined;
    }
    return values.size ? [...values] : undefined;
  }

  function awaited(values: Values): Values | undefined {
    return combine(values, (value) =>
      isAsyncResult(value) ? value.values : [value],
    );
  }

  function returned(fn: Callable): ReturnValues {
    const known = returns.get(fn);
    if (known) return known;
    const body = fn.body;
    if (!body || ("asteriskToken" in fn && fn.asteriskToken)) return [];
    const values: (ts.Expression | undefined)[] = [];
    if (ts.isBlock(body)) {
      // The pinned compiler's binder marks a reachable end of the body,
      // including for async functions and with strictNullChecks disabled.
      if (fn.flags & ts.NodeFlags.HasImplicitReturn) values.push(undefined);
      const visit = (node: ts.Node) => {
        if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
        if (ts.isReturnStatement(node)) values.push(node.expression);
        else ts.forEachChild(node, visit);
      };
      ts.forEachChild(body, visit);
    } else values.push(body);
    returns.set(fn, values);
    return values;
  }

  function binding(
    symbol: ts.Symbol | undefined,
    depth: number,
  ): Values | undefined {
    if (!symbol) return undefined;
    if (symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const mutations = knownWrites().bindings.get(symbol) ?? [];
    const declarations = symbol.declarations ?? [];
    const bodies = declarations.filter(
      (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) && !!node.body,
    );
    if (
      bodies.length === 1 &&
      !mutations.length &&
      declarations.every(ts.isFunctionDeclaration)
    )
      return bodies;
    if (declarations.length !== 1) return undefined;
    const declaration = declarations[0]!;
    if (ts.isSourceFile(declaration)) return [declaration];
    if (ts.isExportAssignment(declaration))
      return read(declaration.expression, depth);
    const initializer = ts.isBindingElement(declaration)
      ? declaration
      : ts.isVariableDeclaration(declaration)
        ? declaration.initializer
        : undefined;
    if (!initializer && !ts.isVariableDeclaration(declaration))
      return undefined;
    const values = initializer ? [initializer, ...mutations] : mutations;
    return combine(values, (value) => (value ? read(value, depth) : undefined));
  }

  function propertyValue(
    object: ts.ObjectLiteralExpression,
    name: string,
    depth: number,
  ): Values | undefined {
    if (mayWrite(object, name, depth)) return undefined;
    const member = ownMember(object, name);
    if (member === null) return [undefined];
    if (!member) return undefined;
    if (ts.isPropertyAssignment(member)) return read(member.initializer, depth);
    if (ts.isShorthandPropertyAssignment(member))
      return binding(checker.getShorthandAssignmentValueSymbol(member), depth);
    if (ts.isMethodDeclaration(member)) return [member];
    return undefined;
  }

  function mayWrite(
    object: ts.ObjectLiteralExpression,
    name: string,
    depth: number,
  ): boolean {
    // A write to the same key matters if it can reach this literal or the
    // receiver is opaque. A different proven literal does not alias it.
    const { properties, openProperties } = knownWrites();
    for (const target of properties.get(name) ?? []) {
      const objects = read(target, depth);
      if (!objects || objects.includes(object)) return true;
    }
    // A direct dynamic write can also add a key absent from the target's type.
    for (const target of openProperties)
      if (read(target, depth)?.includes(object)) return true;
    return false;
  }

  function read(
    node: ts.Node,
    depth: number,
    continueChain = false,
  ): Values | undefined {
    const result = readRaw(node, depth);
    // An optional access skips the rest of the chain. At its boundary, the
    // short circuit becomes a regular undefined value (e.g. for `??`).
    return continueChain || !result?.includes(SHORT_CIRCUIT)
      ? result
      : result.map((value) => (value === SHORT_CIRCUIT ? undefined : value));
  }

  function readRaw(node: ts.Node, depth: number): Values | undefined {
    if (depth >= MAX_DEPTH || active.has(node)) return undefined;
    const previous = cache.get(node);
    if (previous) return previous;
    active.add(node);
    try {
      const result = collect(node, depth + 1);
      if (result) cache.set(node, result);
      return result;
    } finally {
      active.delete(node);
    }
  }

  function collect(node: ts.Node, depth: number): Values | undefined {
    if (ts.isObjectLiteralExpression(node) || isCallable(node)) return [node];
    if (node.kind === ts.SyntaxKind.NullKeyword) return [null];
    if (ts.isVoidExpression(node)) return [undefined];
    if (ts.isBindingElement(node)) {
      const { parent, propertyName, name, initializer } = node;
      if (!ts.isObjectBindingPattern(parent) || node.dotDotDotToken)
        return undefined;
      const key = staticName(propertyName ?? name);
      if (key === undefined) return undefined;
      const owner = parent.parent;
      const input = ts.isBindingElement(owner)
        ? owner
        : ts.isVariableDeclaration(owner)
          ? owner.initializer
          : undefined;
      const objects = input && read(input, depth);
      const selected =
        objects &&
        combine(objects, (value) =>
          value &&
          value !== SHORT_CIRCUIT &&
          !isAsyncResult(value) &&
          ts.isObjectLiteralExpression(value)
            ? propertyValue(value, key, depth)
            : undefined,
        );
      return selected && initializer
        ? combine(selected, (value) =>
            value === undefined ? read(initializer, depth) : [value],
          )
        : selected;
    }
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (
        node.text === "undefined" &&
        !symbol?.declarations?.length &&
        checker.getTypeAtLocation(node) === checker.getUndefinedType()
      )
        return [undefined];
      return binding(symbol, depth);
    }
    if (ts.isConditionalExpression(node))
      return combine([node.whenTrue, node.whenFalse], (branch) =>
        read(branch, depth),
      );
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
    ) {
      const left = read(node.left, depth);
      const and =
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
      return (
        left &&
        combine(left, (value) =>
          (value != null) === and ? read(node.right, depth) : [value],
        )
      );
    }
    if (ts.isCallExpression(node)) {
      const callees = read(node.expression, depth, ts.isCallChain(node));
      return (
        callees &&
        combine(callees, (callee) => {
          if (callee === SHORT_CIRCUIT) return [callee];
          if (callee == null)
            return node.questionDotToken ? [SHORT_CIRCUIT] : undefined;
          if (isAsyncResult(callee) || !isCallable(callee)) return undefined;
          const values = combine(returned(callee), (value) =>
            value ? read(value, depth) : [undefined],
          );
          if (
            !values ||
            !(ts.getCombinedModifierFlags(callee) & ts.ModifierFlags.Async)
          )
            return values;
          // `??` before the await sees the promise, even if it fulfills with undefined.
          const results = awaited(values);
          return results && [{ kind: "promise", values: results }];
        })
      );
    }

    const selector =
      ts.isQualifiedName(node) || ts.isPropertyAccessExpression(node)
        ? {
            at: ts.isQualifiedName(node) ? node.right : node.name,
            receiver: ts.isQualifiedName(node) ? node.left : node.expression,
            name: ts.isQualifiedName(node) ? node.right.text : node.name.text,
          }
        : ts.isElementAccessExpression(node)
          ? {
              at: node.argumentExpression,
              receiver: node.expression,
              name: literalKey(node.argumentExpression),
            }
          : undefined;
    if (selector) {
      const { at, receiver, name } = selector;
      if (name === undefined) return undefined;
      const chain = ts.isOptionalChain(node) ? node : undefined;
      const optional =
        chain && "questionDotToken" in chain && chain.questionDotToken;
      const values = read(receiver, depth, !!chain);
      return (
        values &&
        combine(values, (value) => {
          if (value === SHORT_CIRCUIT) return [value];
          if (value == null) return optional ? [SHORT_CIRCUIT] : undefined;
          if (isAsyncResult(value)) return undefined;
          if (ts.isSourceFile(value))
            return binding(checker.getSymbolAtLocation(at), depth);
          return ts.isObjectLiteralExpression(value)
            ? propertyValue(value, name, depth)
            : undefined;
        })
      );
    }

    if (ts.isAwaitExpression(node)) {
      const values = read(node.expression, depth);
      return values && awaited(values);
    }
    if (ts.isNonNullChain(node)) return read(node.expression, depth, true);
    const expression = unwrap(node as ts.Expression);
    return expression !== node ? read(expression, depth) : undefined;
  }

  return (
    receiver: ts.Node,
    name: string,
  ): readonly ts.Declaration[] | undefined => {
    const values = read(receiver, 0);
    if (!values) return undefined;
    const declarations: ts.Declaration[] = [];
    for (const value of values) {
      if (!value) continue;
      if (
        value === SHORT_CIRCUIT ||
        isAsyncResult(value) ||
        !ts.isObjectLiteralExpression(value)
      )
        return undefined;
      const member = ownMember(value, name);
      if (
        !member ||
        ts.isSetAccessorDeclaration(member) ||
        mayWrite(value, name, 0)
      )
        return undefined;
      declarations.push(member);
    }
    return declarations.length ? declarations : undefined;
  };
}
