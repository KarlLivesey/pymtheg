// SPDX-License-Identifier: MIT
import ts from "typescript";
import { rootDeclaration } from "./symbols.js";

/**
 * Same-length renaming of locally bound module-system names in JavaScript.
 *
 * The compiler treats `require("x")`, `module.exports` and `exports.x` in a JS
 * file as CommonJS by name alone, even where the name is bound to the file's
 * own declaration. Instead of chasing values afterwards, every occurrence of
 * `require`/`module`/`exports` is classified with JavaScript's scoping rules
 * (checked against Node itself by test/graph-typescript-scope-oracle.test.mjs):
 *
 * - `real`: the module system's binding: the CommonJS wrapper parameter, a
 *   free name in an ES module, or `const require = createRequire(...)` whose
 *   `createRequire` provably comes from Node's `module`. Left unchanged.
 * - `local`: bound to the file's own declaration. Renamed, in the text handed
 *   to the compiler, to a fresh identifier of the same length.
 * - `uncertain`: decided only at run time (`with`, direct `eval`, or a
 *   reassigned CommonJS wrapper parameter). Renamed to a second fresh name that
 *   is never declared, so the compiler infers nothing through it; the module
 *   reports such calls as unresolved `dynamic-scope`.
 *
 * Offsets are unchanged, so positions stay valid. Fresh names are chosen once
 * per program from all captured texts, so files that import and export a
 * renamed name agree and nothing can collide. Facts restore the original names.
 */
export const NAMES = ["require", "module", "exports"] as const;
export type Name = (typeof NAMES)[number];
export type Classification = "real" | "local" | "uncertain";
export interface Occurrence {
  name: Name;
  start: number;
  end: number;
  classification: Classification;
  /** Why an `uncertain` occurrence is uncertain (default `dynamic-scope`). */
  reason?: string;
  /** A `real` free `require` in an ES module: a bundler assumption, not Node. */
  assumed?: boolean;
}
/** Program-wide replacement names. */
export interface FreshNames {
  local: Record<Name, string>;
  uncertain: Record<Name, string>;
}
export interface Renamed {
  text: string;
  /** Original names renamed in this file. */
  renamed: Name[];
  /** Start offsets of `uncertain` occurrences. */
  uncertain: number[];
  /** Reason per uncertain offset (`dynamic-scope` or `createrequire-base`). */
  reasons: Record<string, string>;
  /** Start offsets of free `require` in ES modules (bundler assumption). */
  assumed: number[];
  /** Set when the file must fail rather than be misread. */
  error?: string;
}

const isJs = (path: string) => /\.(c|m)?jsx?$/.test(path);
const isName = (value: string): value is Name =>
  (NAMES as readonly string[]).includes(value);
/** All parameters of Node's CommonJS wrapper function that matter here. */
const WRAPPER_PARAMS = new Set<string>([...NAMES, "__filename", "__dirname"]);
const LETTERS = "fghjkqvwxzbcdpuyamnorstlei";
const LEXICAL = ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.Using;

/** Fresh same-length names that occur in none of the given texts. */
export function freshNames(texts: readonly string[]): FreshNames {
  const used = new Set<string>();
  const free = (candidate: string) =>
    !used.has(candidate) && !texts.some((text) => text.includes(candidate));
  const swap = (value: string, at: number, letter: string) =>
    value.slice(0, at) + letter + value.slice(at + 1);
  const pick = (name: string): string => {
    for (let first = name.length - 1; first > 0; first--)
      for (const a of LETTERS) {
        const one = swap(name, first, a);
        if (one !== name && free(one)) return (used.add(one), one);
      }
    for (let first = name.length - 1; first > 0; first--)
      for (let second = first - 1; second > 0; second--)
        for (const a of LETTERS)
          for (const b of LETTERS) {
            const two = swap(swap(name, first, a), second, b);
            if (two !== name && free(two)) return (used.add(two), two);
          }
    throw Error(`No fresh identifier of the same length as "${name}"`);
  };
  const local = {} as Record<Name, string>;
  const uncertain = {} as Record<Name, string>;
  for (const name of NAMES) {
    local[name] = pick(name);
    uncertain[name] = pick(name);
  }
  return { local, uncertain };
}

/** Raw prefilter, aware of escaped spellings. */
export const mayMention = (path: string, text: string) =>
  isJs(path) && /require|module|exports|\\u/.test(text);

interface Binding {
  /** The declaring node; absent for the module system's own binding. */
  declaration?: ts.Node;
  /** The node whose environment holds the binding. */
  scope: ts.Node;
  /** CommonJS wrapper parameter (possibly re-declared by a top-level `var`). */
  wrapper?: boolean;
  /** A name with no declaration in an ES module. */
  free?: boolean;
  /** Whether the binding can be assigned (direct `eval` can then reassign it). */
  mutable: boolean;
}

const isFunctionScope = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionLike(node) && !!(node as ts.FunctionLikeDeclaration).body;
const bindingNames = (name: ts.BindingName): ts.Identifier[] =>
  ts.isIdentifier(name)
    ? [name]
    : name.elements.flatMap((element) =>
        ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
      );
const unlabel = (statement: ts.Statement): ts.Statement => {
  let current = statement;
  while (ts.isLabeledStatement(current)) current = current.statement;
  return current;
};
/** The declaration list a variable binding (simple or destructured) belongs to. */
const listOf = (node: ts.Node): ts.VariableDeclarationList | undefined => {
  let current: ts.Node = node;
  while (
    ts.isBindingElement(current) ||
    ts.isObjectBindingPattern(current) ||
    ts.isArrayBindingPattern(current)
  )
    current = current.parent;
  return ts.isVariableDeclaration(current) &&
    ts.isVariableDeclarationList(current.parent)
    ? current.parent
    : undefined;
};
const isConstBinding = (node: ts.Node) =>
  !!((listOf(node)?.flags ?? 0) & ts.NodeFlags.Const);
const contains = (outer: ts.Node, inner: ts.Node) =>
  inner.pos >= outer.pos && inner.end <= outer.end;

/** Classifies every occurrence of the three names in one JS file. */
export function classify(
  path: string,
  text: string,
  options: { esm?: boolean } = {},
): Occurrence[] {
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.JS,
  );
  const esm =
    options.esm ??
    (path.endsWith(".mjs") ||
      (!path.endsWith(".cjs") &&
        file.statements.some(
          (statement) =>
            ts.isImportDeclaration(statement) ||
            ts.isExportDeclaration(statement) ||
            ts.isExportAssignment(statement) ||
            (ts.canHaveModifiers(statement) &&
              !!ts
                .getModifiers(statement)
                ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)),
        )));

  // ----- strictness -----
  const useStrict = (statements: readonly ts.Statement[]) => {
    for (const statement of statements) {
      if (
        !ts.isExpressionStatement(statement) ||
        !ts.isStringLiteral(statement.expression)
      )
        return false;
      if (statement.expression.getText(file).slice(1, -1) === "use strict")
        return true;
    }
    return false;
  };
  const strictMemo = new Map<ts.Node, boolean>();
  const isStrict = (node: ts.Node): boolean => {
    if (esm) return true;
    const known = strictMemo.get(node);
    if (known !== undefined) return known;
    let result: boolean;
    if (ts.isSourceFile(node)) result = useStrict(node.statements);
    else if (ts.isClassLike(node)) result = true;
    else if (
      isFunctionScope(node) &&
      node.body &&
      ts.isBlock(node.body) &&
      useStrict(node.body.statements)
    )
      result = true;
    else result = isStrict(node.parent);
    strictMemo.set(node, result);
    return result;
  };

  // ----- declarations -----
  /** let/const/class (and, when asked, function) declarations directly in a statement list. */
  const lexicalIn = (
    statements: readonly ts.Statement[],
    name: string,
    functions: boolean,
  ): ts.Node | undefined => {
    for (const raw of statements) {
      const statement = unlabel(raw);
      if (
        ts.isVariableStatement(statement) &&
        statement.declarationList.flags & LEXICAL
      )
        for (const declaration of statement.declarationList.declarations)
          for (const id of bindingNames(declaration.name))
            if (id.text === name) return id.parent;
      if (ts.isClassDeclaration(statement) && statement.name?.text === name)
        return statement;
      if (
        functions &&
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === name
      )
        return statement;
    }
    return undefined;
  };
  /** `var` bindings anywhere in a var scope, not crossing nested functions or static blocks. */
  const varIn = (root: ts.Node, name: string): ts.Node | undefined => {
    let found: ts.Node | undefined;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (
        node !== root &&
        (isFunctionScope(node) || ts.isClassStaticBlockDeclaration(node))
      )
        return;
      if (ts.isClassLike(node) && node !== root) {
        // Heritage and computed keys run in the enclosing scope; members do not.
        node.heritageClauses?.forEach(visit);
        for (const member of node.members)
          if (member.name && ts.isComputedPropertyName(member.name))
            visit(member.name);
        return;
      }
      if (ts.isVariableDeclarationList(node) && !(node.flags & LEXICAL))
        for (const declaration of node.declarations)
          for (const id of bindingNames(declaration.name))
            if (id.text === name && !found) found = id.parent;
      ts.forEachChild(node, visit);
    };
    visit(root);
    return found;
  };
  const topFunction = (statements: readonly ts.Statement[], name: string) =>
    statements
      .map(unlabel)
      .find(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) && statement.name?.text === name,
      );
  const parameterNamed = (fn: ts.SignatureDeclaration, name: string) =>
    fn.parameters.find((parameter) =>
      bindingNames(parameter.name).some((id) => id.text === name),
    );

  /**
   * Annex B.3.2.1: in sloppy function code a function declaration directly in
   * a block or case clause also binds a `var` in the function scope, unless
   * the name is a parameter or replacing it with `var` would conflict with an
   * enclosing lexical declaration of the same name.
   */
  const annexB = (fn: ts.FunctionLikeDeclaration, name: string) => {
    const body = fn.body;
    if (!body || !ts.isBlock(body) || isStrict(fn) || parameterNamed(fn, name))
      return undefined;
    let hoisted: ts.Node | undefined;
    const visit = (node: ts.Node): void => {
      if (hoisted || isFunctionScope(node) || ts.isClassLike(node)) {
        if (
          !hoisted &&
          ts.isFunctionDeclaration(node) &&
          node.name?.text === name &&
          node.body &&
          !node.asteriskToken &&
          !ts
            .getModifiers(node)
            ?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
        ) {
          let holder: ts.Node = node.parent;
          while (ts.isLabeledStatement(holder)) holder = holder.parent;
          if (
            holder !== body &&
            (ts.isBlock(holder) ||
              ts.isCaseClause(holder) ||
              ts.isDefaultClause(holder) ||
              // B.3.4: a function declaration as an `if` branch (no braces)
              // behaves as if it were in a block of its own.
              (ts.isIfStatement(holder) &&
                (holder.thenStatement === node ||
                  holder.elseStatement === node))) &&
            !conflicts(node, holder, body, name)
          )
            hoisted = node;
        }
        return;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(body, visit);
    return hoisted;
  };
  /** Would `var name` here conflict with a lexical `name` up to the function body? */
  const conflicts = (
    declaration: ts.Node,
    holder: ts.Node,
    body: ts.Block,
    name: string,
  ) => {
    for (let scope: ts.Node = holder; ; scope = scope.parent) {
      const statements = ts.isBlock(scope)
        ? scope.statements
        : ts.isCaseClause(scope) || ts.isDefaultClause(scope)
          ? scope.parent.clauses.flatMap((clause) => [...clause.statements])
          : ts.isCaseBlock(scope)
            ? scope.clauses.flatMap((clause) => [...clause.statements])
            : undefined;
      // The function itself is a lexical declaration of its own block: ignore it.
      if (statements) {
        const lexical = lexicalIn(statements, name, false);
        if (lexical) return true;
        // Another block-level function of the same name in an enclosing
        // block is a lexical declaration there (the function body's own
        // top-level functions are var-scoped and do not conflict).
        const sibling = statements
          .map(unlabel)
          .some(
            (s) =>
              s !== declaration &&
              ts.isFunctionDeclaration(s) &&
              s.name?.text === name,
          );
        // Duplicates in the declaration's own list (the block, or for a case
        // clause the whole case block) are allowed in sloppy code.
        const ownList =
          scope === holder ||
          ((ts.isCaseClause(holder) || ts.isDefaultClause(holder)) &&
            scope === holder.parent);
        if (sibling && scope !== body && !ownList) return true;
      }
      if (
        (ts.isForStatement(scope) ||
          ts.isForInStatement(scope) ||
          ts.isForOfStatement(scope)) &&
        scope.initializer &&
        ts.isVariableDeclarationList(scope.initializer) &&
        scope.initializer.flags & LEXICAL &&
        scope.initializer.declarations.some((d) =>
          bindingNames(d.name).some((id) => id.text === name),
        )
      )
        return true;
      if (
        ts.isCatchClause(scope) &&
        scope.variableDeclaration &&
        !ts.isIdentifier(scope.variableDeclaration.name) &&
        bindingNames(scope.variableDeclaration.name).some(
          (id) => id.text === name,
        )
      )
        return true;
      if (scope === body) return false;
    }
  };

  // ----- resolution -----
  const resolve = (occurrence: ts.Identifier, name: string): Binding => {
    const wrapperName = WRAPPER_PARAMS.has(name);
    let child: ts.Node = occurrence;
    for (let node = occurrence.parent; node; child = node, node = node.parent) {
      if (ts.isBlock(node) || ts.isModuleBlock(node)) {
        // A function body's own top-level functions are var-scoped (below).
        const isBody =
          (isFunctionScope(node.parent) && node.parent.body === node) ||
          ts.isClassStaticBlockDeclaration(node.parent);
        const lexical = lexicalIn(node.statements, name, !isBody);
        if (lexical)
          return {
            declaration: lexical,
            scope: node,
            mutable:
              !isConstBinding(lexical) && !ts.isClassDeclaration(lexical),
          };
      } else if (
        ts.isIfStatement(node) &&
        (child === node.thenStatement || child === node.elseStatement) &&
        ts.isFunctionDeclaration(child) &&
        child.name?.text === name &&
        occurrence !== child.name
      ) {
        // B.3.4: the branch function's implicit block binds its name.
        return { declaration: child, scope: child, mutable: true };
      } else if (ts.isCaseBlock(node)) {
        const lexical = lexicalIn(
          node.clauses.flatMap((clause) => [...clause.statements]),
          name,
          true,
        );
        if (lexical)
          return {
            declaration: lexical,
            scope: node,
            mutable:
              !isConstBinding(lexical) && !ts.isClassDeclaration(lexical),
          };
      } else if (ts.isCatchClause(node)) {
        const variable = node.variableDeclaration;
        if (variable && child === node.block)
          for (const id of bindingNames(variable.name))
            if (id.text === name)
              return { declaration: id.parent, scope: node, mutable: true };
      } else if (
        ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node)
      ) {
        const initializer = node.initializer;
        if (
          initializer &&
          ts.isVariableDeclarationList(initializer) &&
          initializer.flags & LEXICAL
        )
          for (const declaration of initializer.declarations)
            for (const id of bindingNames(declaration.name))
              if (id.text === name)
                return {
                  declaration: id.parent,
                  scope: node,
                  mutable: !(initializer.flags & ts.NodeFlags.Const),
                };
      } else if (ts.isClassStaticBlockDeclaration(node)) {
        const declared =
          topFunction(node.body.statements, name) ?? varIn(node, name);
        if (declared)
          return { declaration: declared, scope: node, mutable: true };
      } else if (isFunctionScope(node)) {
        const inParameters = node.parameters.some((p) => contains(p, child));
        if (!inParameters && child === node.body && ts.isBlock(node.body)) {
          const declared =
            topFunction(node.body.statements, name) ??
            varIn(node.body, name) ??
            annexB(node, name);
          if (declared)
            return { declaration: declared, scope: node, mutable: true };
        }
        // A computed name or decorator is evaluated in the enclosing scope:
        // neither the parameters nor the body are visible to it.
        const parameter =
          inParameters || child === node.body
            ? parameterNamed(node, name)
            : undefined;
        if (parameter)
          for (const id of bindingNames(parameter.name))
            if (id.text === name)
              return { declaration: id.parent, scope: node, mutable: true };
        if (
          ts.isFunctionExpression(node) &&
          node.name?.text === name &&
          child !== node.name
        )
          return { declaration: node, scope: node, mutable: false };
      } else if (ts.isClassLike(node)) {
        // Class decorators run outside the class scope; computed keys inside it.
        if (
          node.name?.text === name &&
          child !== node.name &&
          !ts.isDecorator(child)
        )
          return { declaration: node, scope: node, mutable: false };
      } else if (ts.isSourceFile(node)) {
        if (esm) {
          for (const statement of node.statements) {
            if (ts.isImportDeclaration(statement) && statement.importClause) {
              const clause = statement.importClause;
              if (clause.name?.text === name)
                return { declaration: clause, scope: node, mutable: false };
              const bindings = clause.namedBindings;
              if (
                bindings &&
                ts.isNamespaceImport(bindings) &&
                bindings.name.text === name
              )
                return { declaration: bindings, scope: node, mutable: false };
              if (bindings && ts.isNamedImports(bindings)) {
                const element = bindings.elements.find(
                  (e) => e.name.text === name,
                );
                if (element)
                  return { declaration: element, scope: node, mutable: false };
              }
            }
            if (
              ts.isImportEqualsDeclaration(statement) &&
              statement.name.text === name
            )
              return { declaration: statement, scope: node, mutable: false };
          }
          const declared =
            lexicalIn(node.statements, name, true) ?? varIn(node, name);
          if (declared)
            return {
              declaration: declared,
              scope: node,
              mutable:
                !isConstBinding(declared) && !ts.isClassDeclaration(declared),
            };
          return { scope: node, free: true, mutable: true };
        }
        // CommonJS: the file body is Node's wrapper function body, whose
        // parameters include `exports`, `require` and `module`. Annex B never
        // hoists a parameter name; a top-level `let`/`const`/`class` of one
        // is an early error; a top-level `function` replaces its value; a
        // top-level `var` re-declares the same binding.
        const lexical = lexicalIn(node.statements, name, false);
        if (lexical)
          return { declaration: lexical, scope: node, mutable: true };
        const fn = topFunction(node.statements, name);
        if (fn) return { declaration: fn, scope: node, mutable: true };
        if (wrapperName) return { scope: node, wrapper: true, mutable: true };
        const declared = varIn(node, name);
        if (declared)
          return { declaration: declared, scope: node, mutable: true };
        return { scope: node, free: true, mutable: true };
      }
    }
    return { scope: file, free: true, mutable: true };
  };

  // ----- dynamic scope -----
  const directEvals: ts.CallExpression[] = [];
  const withs: ts.WithStatement[] = [];
  const findDynamic = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      let callee: ts.Expression = node.expression;
      while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
      // `eval(...)` and `(eval)(...)` are direct; `(0, eval)(...)`,
      // `globalThis.eval(...)` and `new Function(...)` run in global scope.
      if (ts.isIdentifier(callee) && callee.text === "eval")
        directEvals.push(node);
    }
    if (ts.isWithStatement(node)) withs.push(node);
    ts.forEachChild(node, findDynamic);
  };
  findDynamic(file);
  const varScopeOf = (node: ts.Node): ts.Node => {
    let current = node.parent;
    while (
      current &&
      !isFunctionScope(current) &&
      !ts.isClassStaticBlockDeclaration(current) &&
      !ts.isSourceFile(current)
    )
      current = current.parent;
    return current ?? file;
  };

  // ----- `arguments` -----
  /** Whether an `arguments` occurrence denotes the CommonJS wrapper's own. */
  const wrapperArguments = (id: ts.Identifier): boolean => {
    if (ts.isPropertyAccessExpression(id.parent) && id.parent.name === id)
      return false;
    // A `var arguments` in the wrapper's own var scope does not replace the
    // mapped arguments object (sloppy code); any other binding of that name
    // (let/const/class/function/parameter/catch/import, or a var of a nested
    // function) is a different binding.
    const declared = resolve(id, "arguments").declaration;
    if (
      declared &&
      !(
        (ts.isVariableDeclaration(declared) || ts.isBindingElement(declared)) &&
        !((listOf(declared)?.flags ?? LEXICAL) & LEXICAL) &&
        varScopeOf(declared) === file
      )
    )
      return false;
    // Arrow functions inherit `arguments`; any other function has its own.
    // A computed name or decorator of a method is evaluated outside it.
    let child: ts.Node = id;
    for (let node = id.parent; node; child = node, node = node.parent) {
      if (ts.isFunctionLike(node) && !ts.isArrowFunction(node)) {
        const outside =
          ("name" in node && node.name === child) || ts.isDecorator(child);
        if (!outside) return false;
      }
      if (ts.isClassStaticBlockDeclaration(node)) return false;
      if (ts.isSourceFile(node)) return true;
    }
    return false;
  };
  /** A target of assignment, update or deletion (including destructuring). */
  const isWriteTarget = (node: ts.Node): boolean => {
    let current = node;
    for (
      let parent = current.parent;
      parent;
      current = parent, parent = parent.parent
    ) {
      if (
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      )
        return parent.left === current;
      if (
        (ts.isPrefixUnaryExpression(parent) ||
          ts.isPostfixUnaryExpression(parent)) &&
        (parent.operator === ts.SyntaxKind.PlusPlusToken ||
          parent.operator === ts.SyntaxKind.MinusMinusToken)
      )
        return true;
      if (ts.isDeleteExpression(parent)) return true;
      if (
        (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) &&
        parent.initializer === current
      )
        return true;
      // Only literal/pattern containers can carry a target further up.
      if (
        !ts.isArrayLiteralExpression(parent) &&
        !ts.isObjectLiteralExpression(parent) &&
        !ts.isPropertyAssignment(parent) &&
        !ts.isShorthandPropertyAssignment(parent) &&
        !ts.isSpreadElement(parent) &&
        !ts.isSpreadAssignment(parent) &&
        !ts.isParenthesizedExpression(parent)
      )
        return false;
    }
    return false;
  };
  /**
   * The only harmless uses of the wrapper's `arguments`:
   * - `arguments.length` read;
   * - `arguments[i]` read with a numeric-literal index 0-4 (the wrapper's
   *   own mapped data properties, so no inherited getter runs), when the
   *   value is not called (directly, optionally or as a tag) or constructed:
   *   a called value runs with `this` = the arguments object;
   * - a spread into an array literal (`[...x]`): it iterates through the
   *   object's own `Symbol.iterator`, the built-in `Array.prototype.values`
   *   captured at creation, which reads only those same own indexes.
   *   Replacing `Array.prototype[Symbol.iterator]`, `values`,
   *   `Object.prototype[Symbol.iterator]` or the array iterator's `next`
   *   never hands the object out (`caller.arguments` is an unmapped copy).
   * Anything else counts as passing it on, including any call that
   * receives it (`Array.from(x)`, `f(...x)`). Verified in Node.
   */
  const harmlessRead = (id: ts.Identifier): boolean => {
    const parent = id.parent;
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === id &&
      parent.name.text === "length"
    )
      return !isWriteTarget(parent);
    if (ts.isElementAccessExpression(parent) && parent.expression === id) {
      const index = parent.argumentExpression;
      if (!ts.isNumericLiteral(index) || !/^[0-4]$/.test(index.text))
        return false;
      if (isWriteTarget(parent)) return false;
      let value: ts.Node = parent;
      while (
        ts.isParenthesizedExpression(value.parent) ||
        ts.isNonNullExpression(value.parent)
      )
        value = value.parent;
      const user = value.parent;
      return !(
        ((ts.isCallExpression(user) || ts.isNewExpression(user)) &&
          user.expression === value) ||
        (ts.isTaggedTemplateExpression(user) && user.tag === value)
      );
    }
    return (
      ts.isSpreadElement(parent) &&
      ts.isArrayLiteralExpression(parent.parent) &&
      !isWriteTarget(parent)
    );
  };

  // ----- reassignment of the CommonJS wrapper's parameters -----
  const reassigned = new Set<string>();
  if (!esm) {
    const mark = (target: ts.Node): void => {
      if (ts.isIdentifier(target)) {
        if (
          WRAPPER_PARAMS.has(target.text) &&
          resolve(target, target.text).wrapper
        )
          reassigned.add(target.text);
      } else if (ts.isParenthesizedExpression(target)) mark(target.expression);
      else if (ts.isArrayLiteralExpression(target))
        target.elements.forEach(mark);
      else if (ts.isObjectLiteralExpression(target))
        for (const property of target.properties) {
          if (ts.isPropertyAssignment(property)) mark(property.initializer);
          else if (ts.isShorthandPropertyAssignment(property))
            mark(property.name);
          else if (ts.isSpreadAssignment(property)) mark(property.expression);
        }
      else if (ts.isSpreadElement(target)) mark(target.expression);
      else if (
        ts.isBinaryExpression(target) &&
        target.operatorToken.kind === ts.SyntaxKind.EqualsToken
      )
        mark(target.left);
    };
    const scan = (node: ts.Node): void => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      )
        mark(node.left);
      else if (
        (ts.isPrefixUnaryExpression(node) ||
          ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken)
      )
        mark(node.operand);
      else if (
        (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
        !ts.isVariableDeclarationList(node.initializer)
      )
        mark(node.initializer);
      if (
        ts.isVariableDeclaration(node) &&
        ts.isVariableDeclarationList(node.parent)
      ) {
        const list = node.parent;
        const loop =
          ts.isForInStatement(list.parent) || ts.isForOfStatement(list.parent);
        if (!(list.flags & LEXICAL) && (node.initializer || loop))
          for (const id of bindingNames(node.name))
            if (WRAPPER_PARAMS.has(id.text) && resolve(id, id.text).wrapper)
              reassigned.add(id.text);
      }
      // Sloppy wrapper code: its `arguments` object is mapped to the
      // parameters, so anything but a plain read can replace `require`.
      if (
        ts.isIdentifier(node) &&
        node.text === "arguments" &&
        !isStrict(file) &&
        wrapperArguments(node) &&
        !harmlessRead(node)
      )
        for (const name of WRAPPER_PARAMS) reassigned.add(name);
      ts.forEachChild(node, scan);
    };
    scan(file);
  }

  // ----- factories by origin (createRequire, pathToFileURL) -----
  const MODULE = new Set(["module", "node:module"]);
  const URL_MODULE = new Set(["url", "node:url"]);
  const fromModule = (
    specifier: ts.Expression | undefined,
    modules: ReadonlySet<string>,
  ) =>
    !!specifier &&
    ts.isStringLiteralLike(specifier) &&
    modules.has(specifier.text);
  /** `require("m")` with a real `require` and `m` in `modules`. */
  const realRequireOf = (
    expression: ts.Expression,
    modules: ReadonlySet<string> = MODULE,
  ): boolean => {
    let value = expression;
    while (ts.isParenthesizedExpression(value)) value = value.expression;
    return (
      ts.isCallExpression(value) &&
      ts.isIdentifier(value.expression) &&
      value.expression.text === "require" &&
      value.arguments.length === 1 &&
      fromModule(value.arguments[0], modules) &&
      classification(value.expression, "require") === "real"
    );
  };
  /** An identifier bound to a Node builtin's module object (namespace/default import or const require). */
  const isModuleObject = (
    id: ts.Identifier,
    modules: ReadonlySet<string> = MODULE,
  ): boolean => {
    const declaration = resolve(id, id.text).declaration;
    if (!declaration) return false;
    if (ts.isNamespaceImport(declaration) || ts.isImportClause(declaration))
      return fromModule(
        ts.findAncestor(declaration, ts.isImportDeclaration)?.moduleSpecifier,
        modules,
      );
    return (
      ts.isVariableDeclaration(declaration) &&
      isConstBinding(declaration) &&
      !!declaration.initializer &&
      realRequireOf(declaration.initializer, modules)
    );
  };
  /**
   * Whether a callee provably is the builtin export `exported` of one of
   * `modules`, by origin and whatever its local name: a named import, a
   * destructured real `require`, or a member of the module object.
   */
  const isBuiltin = (
    callee: ts.Expression,
    exported: string,
    modules: ReadonlySet<string>,
  ): boolean => {
    let value = callee;
    while (ts.isParenthesizedExpression(value)) value = value.expression;
    if (ts.isPropertyAccessExpression(value))
      return (
        value.name.text === exported &&
        (ts.isIdentifier(value.expression)
          ? isModuleObject(value.expression, modules)
          : realRequireOf(value.expression, modules))
      );
    if (!ts.isIdentifier(value)) return false;
    const declaration = resolve(value, value.text).declaration;
    if (!declaration) return false;
    if (ts.isImportSpecifier(declaration))
      return (
        (declaration.propertyName ?? declaration.name).text === exported &&
        fromModule(
          ts.findAncestor(declaration, ts.isImportDeclaration)?.moduleSpecifier,
          modules,
        )
      );
    if (ts.isBindingElement(declaration) && isConstBinding(declaration)) {
      const key = declaration.propertyName ?? declaration.name;
      // Climb only through binding patterns (never past a parameter).
      const root = rootDeclaration(declaration);
      return (
        !!root &&
        ts.isIdentifier(key) &&
        key.text === exported &&
        ts.isObjectBindingPattern(declaration.parent) &&
        declaration.parent.parent === root &&
        !!root.initializer &&
        realRequireOf(root.initializer, modules)
      );
    }
    if (
      ts.isVariableDeclaration(declaration) &&
      isConstBinding(declaration) &&
      declaration.initializer
    ) {
      const init = declaration.initializer;
      return (
        ts.isPropertyAccessExpression(init) &&
        init.name.text === exported &&
        (ts.isIdentifier(init.expression)
          ? isModuleObject(init.expression, modules)
          : realRequireOf(init.expression, modules))
      );
    }
    return false;
  };

  /**
   * The base is provably this file's own location: `import.meta.url` or
   * `import.meta.filename` in an ES module whose `import.meta` the file never
   * writes; the wrapper's own, never written `__filename` in CommonJS; or
   * `pathToFileURL(<one of those>)` with `pathToFileURL` from `node:url`.
   */
  const baseIsThisFile = (base: ts.Expression | undefined): boolean => {
    if (!base) return false;
    let value = base;
    while (ts.isParenthesizedExpression(value)) value = value.expression;
    if (
      ts.isPropertyAccessExpression(value) &&
      ts.isMetaProperty(value.expression) &&
      value.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
      (value.name.text === "url" || value.name.text === "filename")
    )
      return esm && !importMetaWritten();
    if (ts.isIdentifier(value) && value.text === "__filename")
      return (
        !esm &&
        !!resolve(value, "__filename").wrapper &&
        !reassigned.has("__filename")
      );
    if (ts.isCallExpression(value) && value.arguments.length === 1)
      return (
        isBuiltin(value.expression, "pathToFileURL", URL_MODULE) &&
        !tamperedWith("pathToFileURL", URL_MODULE) &&
        baseIsThisFile(value.arguments[0])
      );
    return false;
  };
  /** Any write to, mutator call on, or escape of `import.meta`. */
  let metaWritten: boolean | undefined;
  const importMetaWritten = (): boolean => {
    if (metaWritten !== undefined) return metaWritten;
    metaWritten = false;
    const scan = (node: ts.Node): void => {
      if (metaWritten) return;
      if (
        ts.isMetaProperty(node) &&
        node.keywordToken === ts.SyntaxKind.ImportKeyword
      ) {
        const parent = node.parent;
        const read =
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node &&
          !isWriteTarget(parent);
        if (!read) metaWritten = true;
      }
      ts.forEachChild(node, scan);
    };
    scan(file);
    return metaWritten;
  };
  /**
   * Whether this file could replace the builtin `exported`: a write to any
   * property of that name, an `Object.assign`/`defineProperty`-style call
   * mentioning it or given the module object, or the module object used as
   * anything but a member read.
   */
  const tamperMemo = new Map<string, boolean>();
  const tamperedWith = (
    exported: string,
    modules: ReadonlySet<string>,
  ): boolean => {
    const known = tamperMemo.get(exported);
    if (known !== undefined) return known;
    tamperMemo.set(exported, false);
    let tampered = false;
    const mutators = new Set([
      "assign",
      "defineProperty",
      "defineProperties",
      "set",
      "setPrototypeOf",
    ]);
    const mentions = (node: ts.Node): boolean => {
      let found = false;
      const visit = (child: ts.Node): void => {
        if (found) return;
        if (
          (ts.isStringLiteralLike(child) && child.text === exported) ||
          (ts.isIdentifier(child) && child.text === exported)
        )
          found = true;
        else ts.forEachChild(child, visit);
      };
      visit(node);
      return found;
    };
    const scan = (node: ts.Node): void => {
      if (tampered) return;
      if (
        (ts.isPropertyAccessExpression(node) && node.name.text === exported) ||
        (ts.isElementAccessExpression(node) &&
          ts.isStringLiteralLike(node.argumentExpression) &&
          node.argumentExpression.text === exported)
      )
        if (isWriteTarget(node)) tampered = true;
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (
          ts.isPropertyAccessExpression(callee) &&
          mutators.has(callee.name.text) &&
          node.arguments.some(
            (argument) =>
              mentions(argument) ||
              (ts.isIdentifier(argument) && isModuleObject(argument, modules)),
          )
        )
          tampered = true;
      }
      // The module object used other than as `object.member` (read).
      if (
        ts.isIdentifier(node) &&
        !(
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node
        ) &&
        !(
          (ts.isImportClause(node.parent) ||
            ts.isNamespaceImport(node.parent) ||
            ts.isVariableDeclaration(node.parent)) &&
          node.parent.name === node
        ) &&
        isModuleObject(node, modules)
      ) {
        const parent = node.parent;
        const memberRead =
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node &&
          !isWriteTarget(parent);
        if (!memberRead) tampered = true;
      }
      ts.forEachChild(node, scan);
    };
    scan(file);
    tamperMemo.set(exported, tampered);
    return tampered;
  };

  // ----- classification -----
  const reasons = new Map<ts.Identifier, string>();
  const assumed = new Set<ts.Identifier>();
  const memo = new Map<ts.Identifier, Classification>();
  const pending = new Set<ts.Identifier>();
  function classification(
    occurrence: ts.Identifier,
    name: Name,
  ): Classification {
    const known = memo.get(occurrence);
    if (known) return known;
    // A cycle (createRequire origin through itself) is not provably real.
    if (pending.has(occurrence)) return "local";
    pending.add(occurrence);
    let result: Classification;
    try {
      result = compute(occurrence, name);
    } finally {
      pending.delete(occurrence);
    }
    memo.set(occurrence, result);
    return result;
  }
  function compute(occurrence: ts.Identifier, name: Name): Classification {
    const binding = resolve(occurrence, name);
    for (const statement of withs)
      if (
        contains(statement.statement, occurrence) &&
        contains(binding.scope, statement)
      )
        return "uncertain";
    for (const call of directEvals) {
      const scope = varScopeOf(call);
      // Sloppy direct eval can add a nearer `var` to its function scope.
      const injects =
        !isStrict(call) &&
        contains(scope, occurrence) &&
        contains(binding.scope, scope);
      // Any direct eval can assign a mutable binding it can see.
      const reassigns = binding.mutable && contains(binding.scope, call);
      if (injects || reassigns) return "uncertain";
    }
    if (binding.wrapper) return reassigned.has(name) ? "uncertain" : "real";
    if (binding.free) {
      if (esm && (name === "require" || name === "module"))
        assumed.add(occurrence);
      return "real";
    }
    const declaration = binding.declaration!;
    if (
      name === "require" &&
      ts.isVariableDeclaration(declaration) &&
      isConstBinding(declaration) &&
      ts.isIdentifier(declaration.name) &&
      declaration.initializer &&
      ts.isCallExpression(declaration.initializer) &&
      isBuiltin(declaration.initializer.expression, "createRequire", MODULE)
    ) {
      // The factory could have been replaced in this file.
      if (tamperedWith("createRequire", MODULE)) return "uncertain";
      // The base decides where it resolves: only this file's own location is modelled.
      if (!baseIsThisFile(declaration.initializer.arguments[0])) {
        reasons.set(occurrence, "createrequire-base");
        return "uncertain";
      }
      return "real";
    }
    return "local";
  }

  // ----- occurrences -----
  const isDeclarationName = (node: ts.Identifier) => {
    const parent = node.parent;
    return (
      ((ts.isVariableDeclaration(parent) ||
        ts.isBindingElement(parent) ||
        ts.isParameter(parent)) &&
        parent.name === node) ||
      ((ts.isFunctionDeclaration(parent) ||
        ts.isFunctionExpression(parent) ||
        ts.isClassDeclaration(parent) ||
        ts.isClassExpression(parent)) &&
        parent.name === node)
    );
  };
  const isPropertyName = (node: ts.Identifier) => {
    const parent = node.parent;
    return (
      (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isQualifiedName(parent) && parent.right === node) ||
      (ts.isPropertyAssignment(parent) && parent.name === node) ||
      ((ts.isMethodDeclaration(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isGetAccessorDeclaration(parent) ||
        ts.isSetAccessorDeclaration(parent) ||
        ts.isPropertySignature(parent) ||
        ts.isMethodSignature(parent)) &&
        parent.name === node) ||
      (ts.isBindingElement(parent) && parent.propertyName === node) ||
      ts.isJsxAttribute(parent) ||
      ts.isLabeledStatement(parent) ||
      ts.isBreakOrContinueStatement(parent) ||
      ts.isMetaProperty(parent)
    );
  };
  const occurrences: Occurrence[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isName(node.text) && !isPropertyName(node)) {
      const parent = node.parent;
      const name = node.text;
      const start = node.getStart(file);
      // An ES import/export specifier NAME (not a local reference) is renamed
      // uniformly in every JS file, so exporter and importer agree.
      const exportName =
        (ts.isImportSpecifier(parent) && parent.propertyName === node) ||
        (ts.isExportSpecifier(parent) &&
          (parent.parent.parent.moduleSpecifier
            ? true
            : parent.name === node && !!parent.propertyName));
      let kind: Classification;
      if (exportName) kind = "local";
      else {
        kind = classification(node, name);
        // A declaration's own name never stays "real" and never takes the
        // undeclared uncertain name (that name must stay undeclared).
        if (isDeclarationName(node) && kind !== "local") kind = "local";
        if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent))
          if (kind === "uncertain") kind = "local";
      }
      const reason = kind === "uncertain" ? reasons.get(node) : undefined;
      occurrences.push({
        name,
        start,
        end: node.end,
        classification: kind,
        ...(reason ? { reason } : {}),
        ...(kind === "real" && assumed.has(node) ? { assumed: true } : {}),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return occurrences;
}

/**
 * Renames one JS file's locally bound and uncertain occurrences. Escaped
 * spellings (`require`) cannot be replaced at the same length: such a file
 * fails with a diagnostic instead of being misread.
 */
export function renameShadowed(
  path: string,
  text: string,
  names: FreshNames,
  options: { esm?: boolean } = {},
): Renamed {
  const empty = { renamed: [], uncertain: [], reasons: {}, assumed: [] };
  if (!mayMention(path, text)) return { text, ...empty };
  let occurrences: Occurrence[];
  try {
    occurrences = classify(path, text, options);
  } catch (error) {
    return {
      text,
      ...empty,
      error: `Scope analysis of require/module/exports failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  // Declaration names of a real binding stay (e.g. `var require;` alone).
  const renaming = occurrences.filter((o) => o.classification !== "real");
  for (const occurrence of renaming)
    if (occurrence.end - occurrence.start !== occurrence.name.length)
      return {
        text,
        ...empty,
        error: `"${occurrence.name}" at offset ${occurrence.start} is written with an escape sequence; it cannot be renamed in place, and the compiler would misread it as CommonJS`,
      };
  let output = text;
  const renamed = new Set<Name>();
  const uncertain: number[] = [];
  const reasons: Record<string, string> = {};
  const assumed = occurrences
    .filter((o) => o.classification === "real" && o.assumed)
    .map((o) => o.start);
  for (const occurrence of renaming) {
    const replacement =
      occurrence.classification === "local"
        ? names.local[occurrence.name]
        : names.uncertain[occurrence.name];
    output =
      output.slice(0, occurrence.start) +
      replacement +
      output.slice(occurrence.end);
    renamed.add(occurrence.name);
    if (occurrence.classification === "uncertain") {
      uncertain.push(occurrence.start);
      if (occurrence.reason) reasons[occurrence.start] = occurrence.reason;
    }
  }
  return { text: output, renamed: [...renamed], uncertain, reasons, assumed };
}

/** Restorers made by `nameRestorer` (for tests: what is stored per file). */
const restorers = new WeakSet<(text: string) => string>();
/**
 * C-64: `restoreNames` over a copy of `names`, for storing beside a source
 * file. Made here, at module level, it closes over the copied strings only:
 * a function made inside the extraction would close over its scope, and so
 * over the program and checker, and lib files outlive every program.
 */
export function nameRestorer(names: FreshNames): (text: string) => string {
  const copy: FreshNames = {
    local: { ...names.local },
    uncertain: { ...names.uncertain },
  };
  for (const table of [copy.local, copy.uncertain])
    for (const value of Object.values(table))
      if (typeof value !== "string")
        throw TypeError("fresh names must be strings");
  const restore = (text: string) => restoreNames(text, copy);
  restorers.add(restore);
  return restore;
}
/** Whether `restore` was made by `nameRestorer` (tests). */
export const isNameRestorer = (restore: unknown): boolean =>
  typeof restore === "function" &&
  restorers.has(restore as (text: string) => string);

/** Puts the original names back into a name or message derived from a renamed file. */
export function restoreNames(value: string, names: FreshNames): string {
  let result = value;
  for (const name of NAMES)
    for (const replacement of [names.local[name], names.uncertain[name]])
      if (result.includes(replacement))
        result = result.replace(
          new RegExp(`(?<![\\w$])${replacement}(?![\\w$])`, "g"),
          name,
        );
  return result;
}
