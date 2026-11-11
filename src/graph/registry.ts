import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, extname } from "node:path";
import type { LanguageModule } from "./types.js";

export class LanguageRegistry {
  readonly modules: readonly LanguageModule[];
  constructor(modules: readonly LanguageModule[]) {
    const ids = new Set<string>();
    for (const module of modules) {
      if (
        !/^[a-z][a-z0-9-]*$/.test(module.id) ||
        ids.has(module.id) ||
        !module.version ||
        typeof module.parse !== "function" ||
        typeof module.resolve !== "function"
      )
        throw Error("Invalid or duplicate language module");
      if (!module.extensions.length && !module.filenames?.length)
        throw Error("Module claims no files");
      if (
        module.extensions.some(
          (extension) => !/^\.[a-zA-Z0-9]+$/.test(extension),
        ) ||
        module.filenames?.some(
          (name) => !name || name.includes("/") || name.includes("\\"),
        )
      )
        throw Error("Invalid file claim");
      ids.add(module.id);
    }
    this.modules = [...modules].sort((a, b) => a.id.localeCompare(b.id));
  }
  claim(path: string): LanguageModule | undefined {
    const matches = this.modules.filter(
      (module) =>
        module.extensions.includes(extname(path)) ||
        module.filenames?.includes(basename(path)),
    );
    if (matches.length > 1)
      throw Error(
        `Ambiguous language claims for ${path}: ${matches.map((m) => m.id).join(", ")}`,
      );
    return matches[0];
  }
}
/** Every immediate folder must export default LanguageModule from index.js. No core language list. */
export async function discoverLanguages(
  directory = new URL("./languages/", import.meta.url),
): Promise<LanguageRegistry> {
  const entries = await readdir(fileURLToPath(directory), {
    withFileTypes: true,
  });
  const modules: LanguageModule[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory())
      modules.push(
        (
          await import(
            new URL(`${encodeURIComponent(entry.name)}/index.js`, directory)
              .href
          )
        ).default as LanguageModule,
      );
  }
  return new LanguageRegistry(modules);
}
