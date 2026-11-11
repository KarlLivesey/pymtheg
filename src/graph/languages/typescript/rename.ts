import ts from "typescript";

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
  /** Set when the file must fail rather than be misread. */
  error?: string;
}

const isJs = (path: string) => /\.(c|m)?jsx?$/.test(path);
const isName = (value: string): value is Name =>
  (NAMES as readonly string[]).includes(value);
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
              ts.isDefaultClause(holder)) &&
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
    const wrapperName = isName(name);
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
        const parameter = parameterNamed(node, name);
        if (parameter && child !== node.name)
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
        if (node.name?.text === name && child !== node.name)
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

  // ----- reassignment of the CommonJS wrapper's parameters -----
  const reassigned = new Set<Name>();
  if (!esm) {
    const mark = (target: ts.Node): void => {
      if (ts.isIdentifier(target)) {
        if (isName(target.text) && resolve(target, target.text).wrapper)
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
            if (isName(id.text) && resolve(id, id.text).wrapper)
              reassigned.add(id.text);
      }
      // Sloppy wrapper code: `arguments[i] = x` reassigns a parameter.
      if (
        ts.isIdentifier(node) &&
        node.text === "arguments" &&
        !isStrict(file) &&
        varScopeOf(node) === file
      )
        for (const name of NAMES) reassigned.add(name);
      ts.forEachChild(node, scan);
    };
    scan(file);
  }

  // ----- createRequire by origin -----
  const fromNodeModule = (specifier: ts.Expression | undefined) =>
    !!specifier &&
    ts.isStringLiteralLike(specifier) &&
    (specifier.text === "module" || specifier.text === "node:module");
  const realRequireOf = (expression: ts.Expression): boolean => {
    let value = expression;
    while (ts.isParenthesizedExpression(value)) value = value.expression;
    return (
      ts.isCallExpression(value) &&
      ts.isIdentifier(value.expression) &&
      value.expression.text === "require" &&
      value.arguments.length === 1 &&
      fromNodeModule(value.arguments[0]) &&
      classification(value.expression, "require") === "real"
    );
  };
  /** An identifier bound to Node's `module` object (namespace/default import or const require). */
  const isModuleObject = (id: ts.Identifier): boolean => {
    const declaration = resolve(id, id.text).declaration;
    if (!declaration) return false;
    if (ts.isNamespaceImport(declaration) || ts.isImportClause(declaration))
      return fromNodeModule(
        ts.findAncestor(declaration, ts.isImportDeclaration)?.moduleSpecifier,
      );
    return (
      ts.isVariableDeclaration(declaration) &&
      isConstBinding(declaration) &&
      !!declaration.initializer &&
      realRequireOf(declaration.initializer)
    );
  };
  const isCreateRequire = (callee: ts.Expression): boolean => {
    let value = callee;
    while (ts.isParenthesizedExpression(value)) value = value.expression;
    if (ts.isPropertyAccessExpression(value))
      return (
        value.name.text === "createRequire" &&
        (ts.isIdentifier(value.expression)
          ? isModuleObject(value.expression)
          : realRequireOf(value.expression))
      );
    if (!ts.isIdentifier(value) || value.text !== "createRequire") return false;
    const declaration = resolve(value, value.text).declaration;
    if (!declaration) return false;
    if (ts.isImportSpecifier(declaration))
      return (
        (declaration.propertyName ?? declaration.name).text ===
          "createRequire" &&
        fromNodeModule(
          ts.findAncestor(declaration, ts.isImportDeclaration)?.moduleSpecifier,
        )
      );
    if (ts.isBindingElement(declaration) && isConstBinding(declaration)) {
      const key = declaration.propertyName ?? declaration.name;
      let root: ts.Node = declaration;
      while (!ts.isVariableDeclaration(root)) root = root.parent;
      return (
        ts.isIdentifier(key) &&
        key.text === "createRequire" &&
        ts.isObjectBindingPattern(declaration.parent) &&
        declaration.parent.parent === root &&
        !!(root as ts.VariableDeclaration).initializer &&
        realRequireOf((root as ts.VariableDeclaration).initializer!)
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
        init.name.text === "createRequire" &&
        (ts.isIdentifier(init.expression)
          ? isModuleObject(init.expression)
          : realRequireOf(init.expression))
      );
    }
    return false;
  };

  // ----- classification -----
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
    if (binding.free) return "real";
    const declaration = binding.declaration!;
    if (
      name === "require" &&
      ts.isVariableDeclaration(declaration) &&
      isConstBinding(declaration) &&
      ts.isIdentifier(declaration.name) &&
      declaration.initializer &&
      ts.isCallExpression(declaration.initializer) &&
      isCreateRequire(declaration.initializer.expression)
    )
      return "real";
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
      occurrences.push({ name, start, end: node.end, classification: kind });
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
  if (!mayMention(path, text)) return { text, renamed: [], uncertain: [] };
  let occurrences: Occurrence[];
  try {
    occurrences = classify(path, text, options);
  } catch (error) {
    return {
      text,
      renamed: [],
      uncertain: [],
      error: `Scope analysis of require/module/exports failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  // Declaration names of a real binding stay (e.g. `var require;` alone).
  const renaming = occurrences.filter((o) => o.classification !== "real");
  for (const occurrence of renaming)
    if (occurrence.end - occurrence.start !== occurrence.name.length)
      return {
        text,
        renamed: [],
        uncertain: [],
        error: `"${occurrence.name}" at offset ${occurrence.start} is written with an escape sequence; it cannot be renamed in place, and the compiler would misread it as CommonJS`,
      };
  let output = text;
  const renamed = new Set<Name>();
  const uncertain: number[] = [];
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
    if (occurrence.classification === "uncertain")
      uncertain.push(occurrence.start);
  }
  return { text: output, renamed: [...renamed], uncertain };
}

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
