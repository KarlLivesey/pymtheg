// SPDX-License-Identifier: MIT
import { posix as p } from "node:path";
import type { ContextFile } from "../../types.js";
import { readToml, table, type TomlTable } from "./toml.js";

type Source = { fields: TomlTable; directory?: string };

/** Cargo directory-source facts from captured project configs. A null result
 * is a replacement whose location cannot be established from the snapshot. */
export function cargoSources(
  contexts: readonly Pick<ContextFile, "path" | "status" | "text">[],
): (dir: string) => string | null | undefined {
  const configs = new Map<
    string,
    { canonical: boolean; value: TomlTable | null }
  >();
  for (const c of contexts) {
    if (!/(?:^|\/)\.cargo\/config(?:\.toml)?$/.test(c.path)) continue;
    const dir = p.dirname(p.dirname(c.path));
    const canonical = p.basename(c.path) === "config";
    if (!canonical && configs.get(dir)?.canonical) continue;
    configs.set(dir, {
      canonical,
      value: c.status === "clean" ? readToml(c.text) : null,
    });
  }
  return (dir) => {
    if (!configs.size) return;
    const ancestry = [dir];
    while (dir !== ".") {
      dir = p.dirname(dir);
      ancestry.push(dir);
    }
    const sources = new Map<string, Source>();
    for (const base of ancestry.reverse()) {
      const config = configs.get(base);
      if (!config) continue;
      if (!config.value) return null;
      if (config.value.source === undefined) continue;
      const sections = table(config.value.source);
      if (!sections) return null;
      for (const [name, value] of Object.entries(sections)) {
        const fields = table(value);
        if (!fields) return null;
        const previous = sources.get(name);
        const directory = fields.directory;
        if (
          directory !== undefined &&
          (typeof directory !== "string" || !directory)
        )
          return null;
        sources.set(name, {
          fields: { ...previous?.fields, ...fields },
          ...(typeof directory === "string"
            ? {
                directory: p.isAbsolute(directory)
                  ? directory
                  : p.join(base, directory),
              }
            : previous?.directory === undefined
              ? {}
              : { directory: previous.directory }),
        });
      }
    }
    const seen = new Set<string>();
    let name = "crates-io";
    for (;;) {
      if (seen.has(name)) return null;
      seen.add(name);
      const source = sources.get(name);
      const next = source?.fields["replace-with"];
      if (next === undefined)
        return source?.directory ?? (seen.size === 1 ? undefined : null);
      if (typeof next !== "string" || !next) return null;
      name = next;
    }
  };
}
