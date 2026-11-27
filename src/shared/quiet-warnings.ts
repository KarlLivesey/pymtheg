// SPDX-License-Identifier: MIT
/**
 * Drops exactly two Node warnings: the ExperimentalWarning that early supported
 * releases (Node 24.0.0, 25.2.1; not 24.21+, 25.9+ or 26) print when
 * `node:sqlite` loads or `path.matchesGlob` is first used. Pymtheg relies on
 * both on every supported Node, so the warnings are noise on stderr for users
 * and agents. Every other warning, including every other ExperimentalWarning,
 * still prints. This module has no imports. It is the first import of the CLI
 * entry (through src/cli/quiet-warnings.ts) and of every worker entry, since
 * a worker thread loads its own modules (C-50: the CLI's graph worker loads
 * node:sqlite); test/worker-entries.test.mjs checks that every worker entry
 * imports it first. node:sqlite is loaded lazily (src/storage/local.ts), so it
 * loads after this.
 */
const original = process.emitWarning.bind(process);
/** Node's exact texts (lib/internal/util.js emitExperimentalWarning). */
const relied = new Set([
  "SQLite is an experimental feature and might change at any time",
  "glob is an experimental feature and might change at any time",
]);
/**
 * Follows `process.emitWarning`'s overloads: (string, type string, ...),
 * (string, options object) and (Error). For an Error, Node ignores every other
 * argument and uses the Error's own name; Node emits these two warnings as
 * strings, so an Error is never filtered.
 */
export function isReliedOnExperimentalWarning(
  warning: unknown,
  typeOrOptions?: unknown,
): boolean {
  if (typeof warning !== "string") return false;
  const type =
    typeof typeOrOptions === "string"
      ? typeOrOptions
      : typeOrOptions !== null &&
          typeof typeOrOptions === "object" &&
          typeof (typeOrOptions as { type?: unknown }).type === "string"
        ? (typeOrOptions as { type: string }).type
        : "Warning";
  return type === "ExperimentalWarning" && relied.has(warning);
}
process.emitWarning = function emitWarning(
  warning: string | Error,
  ...rest: unknown[]
): void {
  if (isReliedOnExperimentalWarning(warning, rest[0])) return;
  (original as (...args: unknown[]) => void)(warning, ...rest);
} as typeof process.emitWarning;
