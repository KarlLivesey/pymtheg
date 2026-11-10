import { identity } from "./identity-values.js";
export interface SourcePolicy {
  include?: string[];
  exclude?: string[];
}
const excluded = new Set([
  "node_modules",
  "dist",
  "evidence",
  "research",
  "target",
  "vendor",
]);
export function sourceDirectoryExcluded(
  name: string,
  policy: SourcePolicy = {},
): boolean {
  return (
    name.startsWith(".") ||
    ["node_modules", "dist"].includes(name) ||
    (!policy.include && excluded.has(name))
  );
}
/** Conservative directory pruning: only skip a subtree whose static prefix cannot match any include. */
export function directoryMayContainSource(
  directory: string,
  policy: SourcePolicy = {},
): boolean {
  const dir = directory
    .replaceAll("\\", "/")
    .replace(/^(\.\/)+/, "")
    .replace(/\/$/, "");
  return (policy.include ?? [`**/*${identity.extension}`]).some((raw) => {
    if (raw.includes("\\")) return true; // Leave platform/escape interpretation to the actual glob matcher.
    const pattern = raw.replace(/^(\.\/)+/, "");
    const firstGlob = pattern.search(/[*?\[\]{}()!+@]/);
    if (firstGlob < 0) return pattern.startsWith(dir + "/");
    const slash = pattern.lastIndexOf("/", firstGlob),
      prefix = slash < 0 ? "" : pattern.slice(0, slash);
    return (
      !prefix ||
      dir === prefix ||
      dir.startsWith(prefix + "/") ||
      prefix.startsWith(dir + "/")
    );
  });
}
export function readSourcePolicy(value: unknown): SourcePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("sources must contain include/exclude glob lists");
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object))
    if (!["include", "exclude"].includes(key))
      throw Error("Unknown source setting: " + key);
  const result: SourcePolicy = {};
  for (const key of ["include", "exclude"] as const)
    if (object[key] !== undefined) {
      const patterns = object[key];
      if (
        !Array.isArray(patterns) ||
        patterns.length > 100 ||
        !patterns.every(
          (p) =>
            typeof p === "string" &&
            p.length > 0 &&
            p.length <= 500 &&
            !p.startsWith("/") &&
            !p.split("/").includes(".."),
        )
      )
        throw Error("Source patterns must be relative globs without ..");
      result[key] = patterns;
    }
  return result;
}
