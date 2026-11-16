// SPDX-License-Identifier: MIT
/** Public built-in targets; external emitters identify themselves through the plugin API. */
export const outputTargetIds = ["typescript", "rust", "go"] as const;
export type BuiltinTarget = (typeof outputTargetIds)[number];
export const outputTargets: Record<
  BuiltinTarget,
  { label: string; extension: string }
> = {
  typescript: { label: "TypeScript", extension: ".ts" },
  rust: { label: "Rust", extension: ".rs" },
  go: { label: "Go", extension: ".go" },
};
export const isOutputTarget = (value: unknown): value is BuiltinTarget =>
  typeof value === "string" && Object.hasOwn(outputTargets, value);

/** A fail-fast stub never silently succeeds, including for Unit functions. */
export const scaffoldBodyModes = ["fail-fast", "empty"] as const;
export type ScaffoldBodyMode = (typeof scaffoldBodyModes)[number];
export const defaultScaffoldBodyMode: ScaffoldBodyMode = "fail-fast";
export const isScaffoldBodyMode = (value: unknown): value is ScaffoldBodyMode =>
  value === "fail-fast" || value === "empty";

export const outputModes = ["stubs", "contracts"] as const;
export type OutputMode = (typeof outputModes)[number];
export const isOutputMode = (value: unknown): value is OutputMode =>
  value === "stubs" || value === "contracts";

export const defaultPluginTimeoutMs = 5000;
export function pluginDeadline(value: string): number {
  const match = /^(\d+)(ms|s)$/.exec(value);
  const milliseconds = match
    ? Number(match[1]) * (match[2] === "s" ? 1000 : 1)
    : NaN;
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 1 ||
    milliseconds > 120000
  )
    throw Error(
      "Plugin timeout must be from 1ms to 120s, for example --plugin-timeout 30s",
    );
  return milliseconds;
}
