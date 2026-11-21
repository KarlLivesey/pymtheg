// SPDX-License-Identifier: MIT
import { compare, contentHash } from "../../identity.js";
import type {
  GraphFile,
  Json,
  ParseResult,
  ProjectAnalysisContext,
  SymbolDraft,
} from "../../types.js";
import { directoryOf, directoryOfImport, readLayout } from "./gomod.js";
import type { FileFact } from "./model.js";

type Surface = { global: string; functions: string };
type GoData = { go?: FileFact; surface?: Surface; toolchain?: unknown };
const dataOf = (result: ParseResult) => result.data as GoData | undefined;
const ordinaryFunction = (symbol: SymbolDraft) =>
  symbol.kind === "function" && symbol.name !== "init";
const symbolFacts = (symbol: SymbolDraft) => [
  symbol.kind,
  symbol.name,
  symbol.identity,
  symbol.data,
];
const embedFacts = (data: Json | undefined) => {
  const embed = data as { t?: Json; pointer?: boolean } | undefined;
  return [embed?.t, embed?.pointer];
};

/** Exact source-only lookup inputs, with positions represented by source order. */
export function surface(result: ParseResult, fact: FileFact): Surface {
  const symbols = [...result.symbols].sort(
    (a, b) =>
      a.range.start - b.range.start ||
      a.range.end - b.range.end ||
      compare(a.key, b.key),
  );
  const global = symbols.filter((symbol) => !ordinaryFunction(symbol));
  const owners = new Map(global.map((symbol, index) => [symbol.key, index]));
  const embeds = result.links
    .filter((link) => link.kind === "embeds")
    .sort(
      (a, b) =>
        a.range.start - b.range.start ||
        a.range.end - b.range.end ||
        compare(a.targetName, b.targetName),
    );
  return {
    global: contentHash(
      JSON.stringify([
        result.status,
        fact.package,
        fact.imports,
        fact.build,
        fact.goos,
        fact.goarch,
        fact.test,
        global.map(symbolFacts),
        // Unknown embeds use their start as a deduplication key. Preserve which
        // starts coincide as well as their order, independently of byte offsets.
        embeds.map((link, index) => [
          owners.get(link.sourceKey ?? ""),
          link.targetName,
          link.range.start === embeds[index - 1]?.range.start,
          embedFacts(link.data),
        ]),
      ]),
    ),
    functions: contentHash(
      JSON.stringify(symbols.filter(ordinaryFunction).map(symbolFacts)),
    ),
  };
}

function functionsByName(file: GraphFile) {
  const byName = new Map<string, ReturnType<typeof symbolFacts>[]>();
  for (const symbol of file.result.symbols) {
    if (!ordinaryFunction(symbol)) continue;
    const group = byName.get(symbol.name) ?? [];
    group.push(symbolFacts(symbol));
    byName.set(symbol.name, group);
  }
  return byName;
}

/** Could resolving a type, method set, or embedding read a changed name? */
function mentions(data: unknown, names: ReadonlySet<string>): boolean {
  if (typeof data === "string") return names.has(data);
  return (
    !!data &&
    typeof data === "object" &&
    Object.values(data).some((value) => mentions(value, names))
  );
}

/** Files whose notes and link decisions need rebuilding. Undefined means all. */
export function affectedFiles({
  files,
  previousFiles,
  changedContextFiles,
  contextFiles,
}: ProjectAnalysisContext): ReadonlySet<string> | undefined {
  if (
    !previousFiles ||
    changedContextFiles.length ||
    files.some((file) => dataOf(file.result)?.toolchain)
  )
    return;
  const dirty = new Set(previousFiles.keys());
  const changedDirectories = new Set<string>();
  const names = new Set<string>();
  for (const file of files) {
    const old = previousFiles.get(file.path);
    if (!old) continue;
    const before = dataOf(old.result)?.surface;
    const after = dataOf(file.result)?.surface;
    if (
      !before ||
      !after ||
      dataOf(old.result)?.toolchain ||
      before.global !== after.global ||
      file.path.split("/").includes("vendor")
    )
      return;
    if (before.functions === after.functions) continue;
    const earlier = functionsByName(old);
    const later = functionsByName(file);
    for (const name of new Set([...earlier.keys(), ...later.keys()]))
      if (JSON.stringify(earlier.get(name)) !== JSON.stringify(later.get(name)))
        names.add(name);
    changedDirectories.add(directoryOf(file.path));
  }
  if (!changedDirectories.size) return dirty;
  // A function can hide a name used as a type or as an import qualifier, even
  // in invalid code. That can change global method sets and unrelated callers.
  if (
    files.some(
      (file) =>
        file.result.symbols.some(
          (symbol) => !ordinaryFunction(symbol) && mentions(symbol.data, names),
        ) ||
        file.result.links.some(
          (link) =>
            link.kind === "embeds" && mentions(embedFacts(link.data), names),
        ),
    )
  )
    return;

  const layout = readLayout(contextFiles);
  const importers = new Map<string, Set<string>>();
  for (const file of files) {
    const importer = directoryOf(file.path);
    for (const item of dataOf(file.result)?.go?.imports ?? [])
      for (const directory of directoryOfImport(layout, importer, item.path)
        .directories) {
        const group = importers.get(directory) ?? new Set<string>();
        group.add(importer);
        importers.set(directory, group);
      }
  }
  // Set iteration visits additions. Directory scope includes every package
  // name and build variant in the directory, including same-directory tests.
  for (const directory of changedDirectories)
    for (const importer of importers.get(directory) ?? [])
      changedDirectories.add(importer);
  for (const file of files)
    if (changedDirectories.has(directoryOf(file.path))) dirty.add(file.path);
  return dirty;
}
