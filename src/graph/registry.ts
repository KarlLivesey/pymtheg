// SPDX-License-Identifier: MIT
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, extname } from "node:path";
import { compare } from "./identity.js";
import type { LanguageModule } from "./types.js";

const patterns = new Map<string, RegExp>();

export function matchesPattern(path: string, pattern: string): boolean {
  let compiled = patterns.get(pattern);
  if (!compiled) {
    compiled = compilePattern(pattern);
    // Built-in claim patterns fit here. Bound memory for library callers that
    // create registries with arbitrary patterns over the life of a process.
    if (patterns.size < 128) patterns.set(pattern, compiled);
  }
  return compiled.test(pattern.includes("/") ? path : basename(path));
}

function compilePattern(pattern: string): RegExp {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") {
        i++;
        regex += "(?:.*/)?";
      } else regex += ".*";
    } else if (char === "*") regex += "[^/]*";
    else if (char === "?") regex += "[^/]";
    else regex += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(regex + "$");
}
const validPattern = (value: string) =>
  !!value &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  value.split("/").every((part) => part && part !== "." && part !== "..");
export class LanguageRegistry {
  readonly modules: readonly LanguageModule[];
  constructor(modules: readonly LanguageModule[]) {
    const ids = new Set<string>();
    for (const module of modules) {
      if (
        !/^[a-z][a-z0-9-]*$/.test(module.id) ||
        ids.has(module.id) ||
        !module.version ||
        (!module.parse && !module.analyze)
      )
        throw Error("Invalid or duplicate language module");
      if (
        !module.extensions.length &&
        !module.filenames?.length &&
        !module.patterns?.length
      )
        throw Error("Module claims no files");
      if (
        module.extensions.some(
          (extension) => !/^\.[a-zA-Z0-9]+$/.test(extension),
        ) ||
        module.filenames?.some(
          (name) =>
            !validPattern(name) || name.includes("/") || /[*?]/.test(name),
        ) ||
        [...(module.patterns ?? []), ...(module.contextFiles ?? [])].some(
          (pattern) => !validPattern(pattern),
        )
      )
        throw Error("Invalid file claim");
      ids.add(module.id);
    }
    this.modules = [...modules].sort((a, b) => compare(a.id, b.id));
  }
  claim(path: string): LanguageModule | undefined {
    const scored = this.modules
      .map((module) => {
        const matches = [{ tier: -1, literals: 0 }];
        if (!module.accepts || module.accepts(path)) {
          if (module.extensions.includes(extname(path)))
            matches.push({ tier: 1, literals: extname(path).length });
          for (const pattern of module.patterns ?? [])
            if (matchesPattern(path, pattern))
              matches.push({
                tier: 2,
                literals: pattern.replace(/[*?]/g, "").length,
              });
          if (module.filenames?.includes(basename(path)))
            matches.push({ tier: 3, literals: basename(path).length });
        }
        matches.sort((a, b) => b.tier - a.tier || b.literals - a.literals);
        return { module, ...matches[0]! };
      })
      .sort((a, b) => b.tier - a.tier || b.literals - a.literals);
    const best = scored[0];
    const matches = scored.filter(
      (item) =>
        item.tier >= 0 &&
        item.tier === best?.tier &&
        item.literals === best.literals,
    );
    if (matches.length > 1)
      throw Error(
        `Ambiguous language claims for ${path}: ${matches.map((item) => item.module.id).join(", ")}`,
      );
    return matches[0]?.module;
  }
}
export async function discoverLanguages(
  directory = new URL("./languages/", import.meta.url),
  options: { includeTestOnly?: boolean } = {},
): Promise<LanguageRegistry> {
  const entries = await readdir(fileURLToPath(directory), {
    withFileTypes: true,
  });
  const modules: LanguageModule[] = [];
  for (const entry of entries.sort((a, b) => compare(a.name, b.name)))
    if (entry.isDirectory()) {
      const module = (
        await import(
          new URL(`${encodeURIComponent(entry.name)}/index.js`, directory).href
        )
      ).default as LanguageModule;
      if (!module.testOnly || options.includeTestOnly) modules.push(module);
    }
  return new LanguageRegistry(modules);
}
