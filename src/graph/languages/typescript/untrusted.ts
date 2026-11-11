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
  const spans: Span[] = [];
  for (const statement of source.statements) {
    const start = statement.getStart(source);
    const error = errors.find((at) => at >= start && at <= statement.end);
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
    spans.push({ start: from, end: Math.max(from, statement.end) });
  }
  // Errors after the last statement (end of file) have nothing to neutralise.
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
    // The closers go at the start of the span (offsets matter, lines not).
    // A span too short for them (the parser closed the declaration early)
    // keeps only its own closing-bracket tokens, as the parser used them.
    const filled =
      close.length <= body.length
        ? close + body.slice(close.length)
        : closingTokens(text, span, source.languageVariant);
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
