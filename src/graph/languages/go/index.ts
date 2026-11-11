import { posix } from "node:path";
import { createTagsParser, tagsFromPackage } from "../../tree-sitter.js";
import type {
  AnalyzedFile,
  Json,
  LanguageModule,
  ParseResult,
  SourceInput,
} from "../../types.js";
import { GoExtractor } from "./extract.js";
import { importPathOf, readLayout } from "./gomod.js";
import type { FileFact } from "./model.js";
import { resolveGo } from "./resolve.js";

const ID = "go";
/** Key of the one package symbol hosted per directory package (added by analyze). */
const PACKAGE_KEY = "package";

type Helper = { parse(text: string): ParseResult };
let helper: Promise<Helper> | undefined;
let pending: SourceInput | undefined;

/**
 * One reusable Tree-sitter parser for the process. The query is minimal; the
 * extraction walks the whole borrowed tree in the helper's second pass.
 */
function parser(): Promise<Helper> {
  helper ??= (async () => {
    const assets = await tagsFromPackage(
      "tree-sitter-go",
      "tree-sitter-go.wasm",
    );
    return createTagsParser({
      wasmPath: assets.wasmPath,
      query: "(package_clause) @package",
      secondPass({ tree, result }) {
        const source = pending!;
        const extractor = new GoExtractor(source.path, source.text);
        extractor.run(tree.rootNode);
        result.symbols = extractor.symbols;
        result.links = extractor.links;
        result.data = { go: extractor.fact as unknown as Json };
        if (extractor.fact.package === undefined) {
          result.status = "partial";
          result.diagnostics.push({ message: "Missing Go package clause" });
        }
      },
    });
  })().catch((error: unknown) => {
    helper = undefined;
    throw error;
  });
  return helper;
}

async function parse(source: SourceInput): Promise<ParseResult> {
  const tags = await parser();
  pending = source;
  try {
    return tags.parse(source.text);
  } finally {
    pending = undefined;
  }
}

const directoryOf = (path: string) => {
  const directory = posix.dirname(path);
  return directory === "." ? "" : directory;
};

/**
 * Hosts ONE `package` symbol per (directory, package name) in a deterministic
 * file: the first non-test, clean file by path, else the first file by path.
 * Other files' facts are returned unchanged (omitted).
 */
function analyze({
  files,
  contextFiles,
}: Parameters<NonNullable<LanguageModule["analyze"]>>[0]): AnalyzedFile[] {
  const layout = readLayout(contextFiles);
  const groups = new Map<string, typeof files>();
  for (const file of files) {
    if (file.result.status === "failed") continue;
    const fact = (file.result.data as unknown as { go?: FileFact } | undefined)
      ?.go;
    if (fact?.package === undefined || !fact.packageRange) continue;
    const key = `${directoryOf(file.path)}\u0000${fact.package}`;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  const hosts = new Map<string, string>();
  for (const members of groups.values()) {
    const rank = (file: (typeof files)[number]) =>
      (file.path.endsWith("_test.go") ? 2 : 0) +
      (file.result.status === "clean" ? 0 : 1);
    const host = [...members].sort(
      (a, b) =>
        rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    )[0]!;
    hosts.set(host.path, directoryOf(host.path));
  }
  const output: AnalyzedFile[] = [];
  for (const file of files) {
    if (file.result.status === "failed") continue;
    const symbols = file.result.symbols.filter(
      (symbol) => symbol.key !== PACKAGE_KEY,
    );
    const directory = hosts.get(file.path);
    if (directory !== undefined) {
      const fact = (file.result.data as unknown as { go: FileFact }).go;
      const importPath = fact.package!.endsWith("_test")
        ? undefined
        : importPathOf(layout, directory);
      symbols.unshift({
        key: PACKAGE_KEY,
        name: fact.package!,
        kind: "package",
        identity: fact.package!,
        range: fact.packageRange!,
        data: {
          directory,
          ...(importPath === undefined ? {} : { importPath }),
        },
      });
    }
    const result = { ...file.result, symbols };
    if (JSON.stringify(result) !== JSON.stringify(file.result))
      output.push({ path: file.path, result });
  }
  return output;
}

const go: LanguageModule = {
  id: ID,
  version: "1",
  extensions: [".go"],
  contextFiles: ["go.mod", "go.work"],
  parse,
  analyze,
  resolve: (context) => resolveGo(ID, context),
};
export default go;
