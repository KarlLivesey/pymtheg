import ts from "typescript";

/**
 * Untrusted compiler input and its neutralisation (see docs/changes/W2-D.md,
 * "Differential analysis"). Two kinds of text can steer the checker without
 * being trustworthy:
 *
 * - a declaration from its first syntax error to its end (from its first
 *   heritage clause when the error is inside the heritage clauses): structure
 *   the parser recovered, which the source does not actually state;
 * - a free `require`/`module` in an ES module, read as the loader only under
 *   a bundler's assumption (rename.ts records these as `assumed`).
 *
 * A neutral text keeps every offset: an untrusted span becomes spaces,
 * starting with just the closing brackets that were open at its start (or,
 * when it is too short for them, keeping only its own closing brackets), so
 * the following declarations parse exactly as before; an assumed
 * name becomes an undeclared name of the same length. A link that resolves
 * the same in both programs does not depend on the untrusted input.
 */

export interface Span {
  start: number;
  end: number;
}

/**
 * Error positions: the compiler's syntactic diagnostics plus heritage grammar
 * the parser accepts but that has no meaning (`extends A, B`, two `extends`
 * clauses, `extends` after `implements`, `implements` on an interface).
 */
export function errorPositions(
  source: ts.SourceFile,
  syntactic: readonly ts.Diagnostic[],
): number[] {
  const errors = syntactic.map((diagnostic) => diagnostic.start ?? 0);
  errors.push(...heritageErrors(source));
  return errors.sort((a, b) => a - b);
}

/** Positions of meaningless heritage grammar (not parser diagnostics). */
export function heritageErrors(source: ts.SourceFile): number[] {
  const errors: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isClassLike(node) || ts.isInterfaceDeclaration(node)) &&
      node.heritageClauses?.length
    ) {
      const clauses = node.heritageClauses;
      const extendsClauses = clauses.filter(
        (c) => c.token === ts.SyntaxKind.ExtendsKeyword,
      );
      const implementsAt = clauses.findIndex(
        (c) => c.token === ts.SyntaxKind.ImplementsKeyword,
      );
      const extendsAt = clauses.findIndex(
        (c) => c.token === ts.SyntaxKind.ExtendsKeyword,
      );
      const bad =
        (ts.isClassLike(node) &&
          (extendsClauses.length > 1 ||
            extendsClauses.some((c) => c.types.length > 1) ||
            (implementsAt >= 0 &&
              extendsAt >= 0 &&
              implementsAt < extendsAt))) ||
        (ts.isInterfaceDeclaration(node) && implementsAt >= 0);
      if (bad) errors.push(clauses[0]!.getStart(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return errors;
}

/**
 * The untrusted spans of a file: for each top-level statement containing an
 * error, from that first error (or the start of the heritage clauses holding
 * it) to the statement's end.
 */
export function untrustedSpans(
  source: ts.SourceFile,
  errors: readonly number[],
): Span[] {
  if (!errors.length) return [];
  // Trust ends where the construct holding the error starts (trustEnd).
  const ends = [...new Set(errors.map((at) => trustEnd(source, at)))].sort(
    (a, b) => a - b,
  );
  const spans: Span[] = [];
  const covered = new Set<number>();
  for (const statement of source.statements) {
    const start = statement.getStart(source);
    const error = ends.find((at) => at >= start && at < statement.end);
    if (error === undefined) continue;
    let from = error;
    // The innermost class or interface whose heritage clauses hold the error.
    const visit = (node: ts.Node): void => {
      if (node.pos > error || node.end < error) return;
      if (
        (ts.isClassLike(node) || ts.isInterfaceDeclaration(node)) &&
        node.heritageClauses?.length
      ) {
        const first = node.heritageClauses[0]!.getStart(source);
        const last = node.heritageClauses.at(-1)!.end;
        if (error >= first && error <= last) from = Math.min(from, first);
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
    spans.push({ start: from, end: statement.end });
    for (const at of ends)
      if (at >= start && at < statement.end) covered.add(at);
  }
  // Trust that ends outside every statement (an unterminated comment after
  // the last recovered statement, say): from there to the end of the file.
  const text = source.text;
  const rest = ends.find(
    (at) =>
      !covered.has(at) &&
      at < text.length &&
      !spans.some((span) => at >= span.start && at < span.end),
  );
  if (rest !== undefined) {
    const kept = spans.filter((span) => span.end <= rest);
    return [...kept, { start: rest, end: text.length }];
  }
  return spans;
}

/** The closing brackets for those open at `to`, scanning from `from`. */
function closers(
  text: string,
  from: number,
  to: number,
  variant: ts.LanguageVariant,
): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    variant,
    text,
    undefined,
    from,
    to - from,
  );
  const stack: string[] = [];
  let previous = ts.SyntaxKind.Unknown;
  const VALUE_END = new Set([
    ts.SyntaxKind.Identifier,
    ts.SyntaxKind.CloseParenToken,
    ts.SyntaxKind.CloseBracketToken,
    ts.SyntaxKind.CloseBraceToken,
    ts.SyntaxKind.NumericLiteral,
    ts.SyntaxKind.BigIntLiteral,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.ThisKeyword,
    ts.SyntaxKind.SuperKeyword,
    ts.SyntaxKind.TrueKeyword,
    ts.SyntaxKind.FalseKeyword,
    ts.SyntaxKind.NullKeyword,
    ts.SyntaxKind.RegularExpressionLiteral,
  ]);
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  ) {
    if (
      (token === ts.SyntaxKind.SlashToken ||
        token === ts.SyntaxKind.SlashEqualsToken) &&
      !VALUE_END.has(previous)
    )
      token = scanner.reScanSlashToken();
    switch (token) {
      case ts.SyntaxKind.OpenBraceToken:
        stack.push("}");
        break;
      case ts.SyntaxKind.OpenParenToken:
        stack.push(")");
        break;
      case ts.SyntaxKind.OpenBracketToken:
        stack.push("]");
        break;
      case ts.SyntaxKind.TemplateHead:
        stack.push("}`");
        break;
      case ts.SyntaxKind.CloseBraceToken:
        if (stack.at(-1) === "}`") {
          token = scanner.reScanTemplateToken(false);
          if (token === ts.SyntaxKind.TemplateTail) stack.pop();
        } else if (stack.at(-1) === "}") stack.pop();
        break;
      case ts.SyntaxKind.CloseParenToken:
        if (stack.at(-1) === ")") stack.pop();
        break;
      case ts.SyntaxKind.CloseBracketToken:
        if (stack.at(-1) === "]") stack.pop();
        break;
    }
    if (
      token !== ts.SyntaxKind.WhitespaceTrivia &&
      token !== ts.SyntaxKind.NewLineTrivia
    )
      previous = token;
  }
  return stack.reverse().join("");
}

const blank = (text: string) => text.replace(/[^\r\n]/g, " ");

/** A span blanked except for its closing-bracket tokens. */
function closingTokens(
  text: string,
  span: Span,
  variant: ts.LanguageVariant,
): string {
  const out = blank(text.slice(span.start, span.end)).split("");
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    variant,
    text,
    undefined,
    span.start,
    span.end - span.start,
  );
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  )
    if (
      token === ts.SyntaxKind.CloseBraceToken ||
      token === ts.SyntaxKind.CloseParenToken ||
      token === ts.SyntaxKind.CloseBracketToken
    )
      out[scanner.getTokenStart() - span.start] = scanner.getTokenText();
  return out.join("");
}

/** Top-level statement starts (with kind) outside the given spans. */
function shape(source: ts.SourceFile, spans: readonly Span[]): string[] {
  return source.statements
    .map((statement) => [statement.getStart(source), statement.kind] as const)
    .filter(([at]) => !spans.some((span) => at >= span.start && at < span.end))
    .map(([at, kind]) => `${at}:${kind}`);
}

/**
 * The file's text with its untrusted spans neutralised at the same offsets.
 * If closing brackets cannot restore the following statements exactly, the
 * text from the first span to the end of the file is neutralised instead
 * (also reported in `widened`).
 */
export function neutralizeSpans(
  source: ts.SourceFile,
  spans: readonly Span[],
): { text: string; spans: Span[]; widened: boolean } {
  const text = source.text;
  if (!spans.length) return { text, spans: [], widened: false };
  let out = "";
  let at = 0;
  for (const span of spans) {
    const statement = source.statements.find(
      (s) => s.getStart(source) <= span.start && span.end <= s.end,
    );
    const from = statement ? statement.getStart(source) : span.start;
    const close = closers(text, from, span.start, source.languageVariant);
    const body = blank(text.slice(span.start, span.end));
    // The closers go at the start of the span, over spaces only (line
    // breaks keep their positions). A span too short for them (the parser
    // closed the declaration early) keeps only its own closing-bracket
    // tokens, as the parser used them.
    const room = body.replace(/[\r\n]/g, "").length;
    let filled: string;
    if (close.length <= room) {
      const out = body.split("");
      let next = 0;
      for (let i = 0; i < out.length && next < close.length; i++)
        if (out[i] === " ") out[i] = close[next++]!;
      filled = out.join("");
    } else filled = closingTokens(text, span, source.languageVariant);
    out += text.slice(at, span.start) + filled;
    at = span.end;
  }
  out += text.slice(at);
  const reparsed = ts.createSourceFile(
    source.fileName,
    out,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(source.fileName),
  );
  if (shape(reparsed, spans).join() === shape(source, spans).join())
    return { text: out, spans: [...spans], widened: false };
  const first = spans[0]!.start;
  return {
    text: text.slice(0, first) + blank(text.slice(first)),
    spans: [{ start: first, end: text.length }],
    widened: true,
  };
}

const scriptKind = (name: string): ts.ScriptKind =>
  /\.tsx$/.test(name)
    ? ts.ScriptKind.TSX
    : /\.jsx$/.test(name)
      ? ts.ScriptKind.JSX
      : /\.(c|m)?js$/.test(name)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

/**
 * The text with each assumed free `require`/`module` (at `offsets`) replaced
 * by an undeclared name of the same length.
 */
export function neutralizeAssumed(
  text: string,
  offsets: readonly number[],
  undeclared: { require: string; module: string },
): string {
  let out = text;
  for (const at of offsets) {
    const name = text.startsWith("require", at)
      ? "require"
      : text.startsWith("module", at)
        ? "module"
        : undefined;
    if (!name) continue;
    out = out.slice(0, at) + undeclared[name] + out.slice(at + name.length);
  }
  return out;
}

// ----- open declarations: what parser recovery may have thrown away -----

/**
 * Where trust ends for an error reported at `at`: the start of the construct
 * the error belongs to. An error inside or at the end of a comment, a
 * string, template, regular expression or JSX element belongs to it from its
 * opening delimiter (an unterminated one runs to where the error is
 * reported, often the end of the line or file).
 */
export function trustEnd(
  source: ts.SourceFile,
  at: number,
  comments: readonly Span[] = commentsOf(source),
): number {
  let end = at;
  for (const comment of comments)
    if (comment.start < at && at <= comment.end)
      end = Math.min(end, comment.start);
  // The outermost literal or JSX construct whose text contains `at`.
  const visit = (node: ts.Node): void => {
    if (node.getStart(source) > at || node.end < at) return;
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateExpression(node) ||
      ts.isRegularExpressionLiteral(node) ||
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node) ||
      ts.isJsxOpeningElement(node)
    ) {
      const start = node.getStart(source);
      // A terminated construct ending exactly at `at` does not own the error.
      const text = source.text;
      const last = text[node.end - 1];
      const terminated =
        node.end - start >= 2 &&
        (ts.isStringLiteralLike(node)
          ? last === text[start]
          : ts.isTemplateExpression(node)
            ? last === "`"
            : ts.isRegularExpressionLiteral(node)
              ? true
              : last === ">");
      if (start <= at && (at < node.end || !terminated)) {
        end = Math.min(end, start);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return end;
}

/** Every comment range in the file (leading and trailing trivia). */
function commentsOf(source: ts.SourceFile): Span[] {
  const text = source.text;
  const seen = new Map<number, Span>();
  const add = (ranges: readonly ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? [])
      seen.set(range.pos, { start: range.pos, end: range.end });
  };
  const visit = (node: ts.Node): void => {
    add(ts.getLeadingCommentRanges(text, node.pos));
    add(ts.getTrailingCommentRanges(text, node.end));
    ts.forEachChild(node, visit);
  };
  visit(source);
  add(ts.getLeadingCommentRanges(text, source.endOfFileToken.pos));
  return [...seen.values()];
}

/** A declaration or scope whose set of members may hold unseen ones. */
export interface OpenInfo {
  /** The file scope is open from here (any parse error), or undefined. */
  fileAt: number | undefined;
  /**
   * Declarations with a member list (class, interface, enum, namespace,
   * type literal, object literal) open from the offset given: a parse error
   * in the member list, or a missing closing brace. The source file itself
   * is included (keyed by the SourceFile) when its scope is open.
   */
  owners: Map<ts.Node, number>;
}

const openMemo = new WeakMap<ts.SourceFile, OpenInfo>();

/**
 * The open declarations of a file, from the parser's own diagnostics only
 * (grammar checks that drop no text, such as JS-only syntax or heritage
 * defects, open nothing).
 */
export function openInfo(source: ts.SourceFile): OpenInfo {
  const known = openMemo.get(source);
  if (known) return known;
  const diagnostics =
    (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  const owners = new Map<ts.Node, number>();
  let fileAt: number | undefined;
  if (diagnostics.length) {
    const comments = commentsOf(source);
    const ends = [
      ...new Set(
        diagnostics.map((d) => trustEnd(source, d.start ?? 0, comments)),
      ),
    ].sort((a, b) => a - b);
    fileAt = ends[0];
    owners.set(source, fileAt!);
    const text = source.text;
    const visit = (node: ts.Node): void => {
      const list = memberListStart(node, source);
      if (list !== undefined) {
        const end = ts.isModuleDeclaration(node) ? node.body!.end : node.end;
        const closed = text[end - 1] === "}";
        let at = ends.find((e) => e >= list && e <= end);
        // A missing closing brace: whatever the error, members end here.
        if (!closed) at = Math.min(at ?? end, end);
        if (at !== undefined) owners.set(node, at);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    // An unseen merge partner (a later `interface X`, `namespace X`) can add
    // members to any mergeable declaration of an open scope: its own members
    // stay seen, anything that falls through it is open. TS files only.
    if (!/\.(c|m)?jsx?$/.test(source.fileName)) {
      const mergeable = (statements: readonly ts.Statement[]) => {
        for (const statement of statements) {
          if (
            ts.isClassDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement) ||
            ts.isEnumDeclaration(statement) ||
            ts.isModuleDeclaration(statement)
          )
            if (!owners.has(statement)) owners.set(statement, statement.end);
          if (
            ts.isModuleDeclaration(statement) &&
            statement.body &&
            ts.isModuleBlock(statement.body) &&
            owners.has(statement)
          )
            mergeable(statement.body.statements);
        }
      };
      mergeable(source.statements);
    }
  }
  const info = { fileAt, owners };
  openMemo.set(source, info);
  return info;
}

/** Where a declaration's member list starts (its `{`), if it has one. */
function memberListStart(
  node: ts.Node,
  source: ts.SourceFile,
): number | undefined {
  if (
    ts.isClassLike(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isTypeLiteralNode(node) ||
    ts.isObjectLiteralExpression(node)
  ) {
    const members = (node as { members?: ts.NodeArray<ts.Node> }).members;
    if (ts.isObjectLiteralExpression(node)) return node.getStart(source);
    return members ? members.pos - 1 : undefined;
  }
  if (ts.isModuleDeclaration(node) && node.body && ts.isModuleBlock(node.body))
    return node.body.getStart(source);
  return undefined;
}
