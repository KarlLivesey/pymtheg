import { identity } from "../shared/identity-values.js";
import { matchesGlob } from "node:path";
import type { SourcePolicy } from "../shared/source-policy.js";
export function sourceIncluded(
  path: string,
  policy: SourcePolicy = {},
): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    (policy.include ?? [`**/*${identity.extension}`]).some((pattern) =>
      matchesGlob(normalized, pattern),
    ) &&
    !(policy.exclude ?? []).some((pattern) => matchesGlob(normalized, pattern))
  );
}
