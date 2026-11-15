/**
 * Drops exactly one Node warning: the ExperimentalWarning that some supported
 * Node releases (24.0.0 to 24.x before node:sqlite was marked stable, and
 * 25.x before 25.9) print when `node:sqlite` loads. Pymtheg relies on
 * node:sqlite on every supported Node, so the warning is noise on stderr for
 * users and agents. Every other warning still prints. This module has no
 * imports and is the CLI entry's first import, so it runs before anything can
 * load node:sqlite.
 */
const original = process.emitWarning.bind(process);
export function isSqliteExperimentalWarning(
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
    /^SQLite is an experimental feature/.test(message)
  );
}
process.emitWarning = function emitWarning(
  warning: string | Error,
  ...rest: unknown[]
): void {
  if (isSqliteExperimentalWarning(warning, rest[0])) return;
  (original as (...args: unknown[]) => void)(warning, ...rest);
} as typeof process.emitWarning;
