// SPDX-License-Identifier: MIT
import ts from "typescript";
import { unwrap } from "./symbols.js";

type Callable =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;
type Producer = ts.ObjectLiteralExpression | Callable | ts.SourceFile | null;
type Values = readonly Producer[];

const isCallable = (node: ts.Node): node is Callable =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);

function staticName(node: ts.Node): string | undefined {
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
): Exclude<ts.ObjectLiteralElementLike, ts.SpreadAssignment> | undefined {
  for (let index = object.properties.length - 1; index >= 0; index--) {
    const property = object.properties[index]!;
    if (ts.isSpreadAssignment(property)) return undefined;
    const key = staticName(property.name);
    if (key === undefined) return undefined;
    if (key === name) return property;
  }
  return undefined;
}

const MAX_PRODUCERS = 32;
const MAX_DEPTH = 32;

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
  const returns = new WeakMap<Callable, readonly ts.Expression[]>();
  let writes:
    | {
        bindings: Map<ts.Symbol, (ts.Expression | null)[]>;
        properties: Set<string>;
      }
    | undefined;

  function knownWrites() {
    if (writes) return writes;
    const bindings = new Map<ts.Symbol, (ts.Expression | null)[]>();
    const properties = new Set<string>();
    const addProperties = (target: ts.Expression) => {
      for (const member of checker.getPropertiesOfType(
        checker.getTypeAtLocation(target),
      ))
        properties.add(member.getName());
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
      } else if (
        ts.isPropertyAccessExpression(node) &&
        (isWrite(node) || ts.isDeleteExpression(node.parent))
      )
        properties.add(node.name.text);
      else if (
        ts.isElementAccessExpression(node) &&
        (isWrite(node) || ts.isDeleteExpression(node.parent))
      ) {
        const key = literalKey(node.argumentExpression);
        if (key === undefined) addProperties(node.expression);
        else properties.add(key);
      } else if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const { expression, name } = node.expression;
        const target = node.arguments[0];
        if (
          target &&
          ts.isIdentifier(expression) &&
          ((expression.text === "Object" &&
            [
              "assign",
              "defineProperty",
              "defineProperties",
              "setPrototypeOf",
            ].includes(name.text)) ||
            (expression.text === "Reflect" && name.text === "set"))
        )
          addProperties(target);
      }
      ts.forEachChild(node, scan);
    };
    for (const file of program.getSourceFiles())
      if (!file.isDeclarationFile) scan(file);
    return (writes = { bindings, properties });
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

  function returned(fn: Callable): readonly ts.Expression[] {
    const known = returns.get(fn);
    if (known) return known;
    const body = fn.body;
    const values: ts.Expression[] = [];
    let missing = !body || ("asteriskToken" in fn && !!fn.asteriskToken);
    if (body && ts.isBlock(body)) {
      const visit = (node: ts.Node) => {
        if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
        if (ts.isReturnStatement(node)) {
          if (node.expression) values.push(node.expression);
          else missing = true;
        } else ts.forEachChild(node, visit);
      };
      ts.forEachChild(body, visit);
    } else if (body) values.push(body);
    const result = missing ? [] : values;
    returns.set(fn, result);
    return result;
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
    if (ts.isVariableDeclaration(declaration)) {
      const values = declaration.initializer
        ? [declaration.initializer, ...mutations]
        : mutations;
      return combine(values, (value) =>
        value ? read(value, depth) : undefined,
      );
    }
    return undefined;
  }

  function read(node: ts.Node, depth: number): Values | undefined {
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
    if (node.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(node))
      return [null];
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (
        node.text === "undefined" &&
        !symbol?.declarations?.length &&
        checker.getTypeAtLocation(node) === checker.getUndefinedType()
      )
        return [null];
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
          (value !== null) === and ? read(node.right, depth) : [value],
        )
      );
    }
    if (ts.isCallExpression(node)) {
      const callees = read(node.expression, depth);
      return (
        callees &&
        combine(callees, (callee) =>
          callee && isCallable(callee)
            ? combine(returned(callee), (value) => read(value, depth))
            : undefined,
        )
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
      const values = read(receiver, depth);
      return (
        values &&
        combine(values, (value) => {
          if (!value) return [null];
          if (ts.isSourceFile(value))
            return binding(checker.getSymbolAtLocation(at), depth);
          if (
            !ts.isObjectLiteralExpression(value) ||
            knownWrites().properties.has(name)
          )
            return undefined;
          const member = ownMember(value, name);
          if (!member) return undefined;
          if (ts.isPropertyAssignment(member))
            return read(member.initializer, depth);
          if (ts.isShorthandPropertyAssignment(member))
            return binding(
              checker.getShorthandAssignmentValueSymbol(member),
              depth,
            );
          if (ts.isMethodDeclaration(member)) return [member];
          return undefined;
        })
      );
    }

    if (ts.isAwaitExpression(node)) return read(node.expression, depth);
    const expression = unwrap(node as ts.Expression);
    return expression !== node ? read(expression, depth) : undefined;
  }

  return (
    receiver: ts.Node,
    name: string,
  ): readonly ts.Declaration[] | undefined => {
    if (knownWrites().properties.has(name)) return undefined;
    const values = read(receiver, 0);
    if (!values) return undefined;
    const declarations: ts.Declaration[] = [];
    for (const value of values) {
      if (!value) continue;
      if (!ts.isObjectLiteralExpression(value)) return undefined;
      const member = ownMember(value, name);
      if (!member || ts.isSetAccessorDeclaration(member)) return undefined;
      declarations.push(member);
    }
    return declarations.length ? declarations : undefined;
  };
}
