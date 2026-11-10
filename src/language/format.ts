import { lex } from "./lexer.js";
import { parse } from "./parser.js";
export class FormatSyntaxError extends Error {}
/** Format indentation and blank-line runs while preserving tokens and comments. */
export function formatSource(file: string, source: string): string {
  const normalized = source.replace(/\r\n?/g, "\n");
  const tokenized = lex(file, normalized);
  const parsed = parse(file, normalized);
  const diagnostic = [...tokenized.diagnostics, ...parsed.diagnostics].sort(
    (a, b) => a.span.start - b.span.start,
  )[0];
  if (diagnostic) {
    const prefix = normalized.slice(0, diagnostic.span.start);
    const line = prefix.split("\n").length;
    const column = prefix.length - prefix.lastIndexOf("\n");
    throw new FormatSyntaxError(
      `${file}:${line}:${column} ${diagnostic.code}: ${diagnostic.message}. Fix syntax errors before formatting.`,
    );
  }
  const lines = normalized.split("\n");
  const tokens = tokenized.tokens.filter((t) => t.kind !== "eof");
  const continuations = parsed.declarations
    .filter((d) => d.kind === "type" && d.fields === null)
    .map((d) => d.span);
  let continuation = 0;
  let offset = 0,
    index = 0,
    depth = 0;
  const out: string[] = [];
  for (const line of lines) {
    const end = offset + line.length;
    while (
      continuation < continuations.length &&
      continuations[continuation]!.end <= offset
    )
      continuation++;
    const span = continuations[continuation];
    let indent =
      depth + (span && span.start < offset && offset < span.end ? 1 : 0);
    const first = tokens[index];
    if (first && first.span.start <= end && first.text === "}") indent--;
    if (line.trim() || out.at(-1) !== "")
      out.push(
        line.trim() ? "  ".repeat(Math.max(0, indent)) + line.trim() : "",
      );
    while (index < tokens.length && tokens[index]!.span.start <= end) {
      const t = tokens[index++]!;
      if (t.text === "{") depth++;
      else if (t.text === "}") depth--;
    }
    offset = end + 1;
  }
  return out.join("\n").trimEnd() + "\n";
}
