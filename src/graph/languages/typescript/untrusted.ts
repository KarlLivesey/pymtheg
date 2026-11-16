// SPDX-License-Identifier: MIT
/**
 * The bundler assumption's neutral text (see docs/changes/W2-D.md,
 * "Differential analysis"): a free `require`/`module` in an ES module is read
 * as the loader only under a bundler's assumption (rename.ts records these
 * as `assumed`). The neutral text renames each of them, at the same length,
 * to an undeclared name, so every offset is kept; a link that resolves the
 * same in both programs does not rest on the assumption.
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
