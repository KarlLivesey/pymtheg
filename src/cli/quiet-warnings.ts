/**
 * Drops exactly two Node warnings: the ExperimentalWarning that early supported
 * releases (Node 24.0.0, 25.2.1; not 24.21+, 25.9+ or 26) print when
 * `node:sqlite` loads or `path.matchesGlob` is first used. Pymtheg relies on
 * both on every supported Node, so the warnings are noise on stderr for users
 * and agents. Every other warning, including every other ExperimentalWarning,
 * still prints. This module has no imports and is the CLI entry's first import;
 * node:sqlite is loaded lazily (src/storage/local.ts) so it loads after this.
 */
const original = process.emitWarning.bind(process);
export function isReliedOnExperimentalWarning(
  warning: string | Error,
  typeOrOptions?: unknown,
): boolean {
  const message = typeof warning === "string" ? warning : warning.message;
  const type =
    typeof typeOrOptions === "string"
      ? typeOrOptions
      : typeOrOptions &&
          typeof typeOrOptions === "object" &&
          "type" in typeOrOptions &&
          typeof typeOrOptions.type === "string"
        ? typeOrOptions.type
        : typeof warning === "string"
          ? "Warning"
          : warning.name;
  return (
    type === "ExperimentalWarning" &&
    /^(SQLite|glob) is an experimental feature/.test(message)
  );
}
process.emitWarning = function emitWarning(
  warning: string | Error,
  ...rest: unknown[]
): void {
  if (isReliedOnExperimentalWarning(warning, rest[0])) return;
  (original as (...args: unknown[]) => void)(warning, ...rest);
} as typeof process.emitWarning;
