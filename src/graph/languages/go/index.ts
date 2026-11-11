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
import { linkNotes, resolveGo } from "./resolve.js";

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
        result.diagnostics.push(...extractor.diagnostics);
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
  // Package-level names, to decide whether a predeclared identifier is shadowed.
  // A `_test.go` declaration shadows only for that package's test files.
  const packageNames = new Map<
    string,
    { plain: Set<string>; test: Set<string> }
  >();
  for (const file of files) {
    if (file.result.status === "failed") continue;
    const fact = (file.result.data as unknown as { go?: FileFact } | undefined)
      ?.go;
    if (fact?.package === undefined) continue;
    const key = `${directoryOf(file.path)}\u0000${fact.package}`;
    let names = packageNames.get(key);
    if (!names)
      packageNames.set(key, (names = { plain: new Set(), test: new Set() }));
    for (const symbol of file.result.symbols)
      if (
        [
          "function",
          "var",
          "const",
          "struct",
          "interface",
          "type",
          "alias",
        ].includes(symbol.kind) &&
        !(symbol.kind === "function" && symbol.name === "init") &&
        // A recovered header (layer 2) never shadows anything.
        !(symbol.data as { recovered?: boolean } | undefined)?.recovered
      )
        (fact.test ? names.test : names.plain).add(symbol.name);
  }
  // Recompute every file's facts from its parse facts: drop the previous host symbol and overflow notes.
  const next = new Map<string, ParseResult>();
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
    // Notes and shadowed-predeclared links from a previous analyze are recomputed.
    const parsed = file.result.links.filter(
      (link) =>
        !(link.data as { predeclaredName?: boolean } | undefined)
          ?.predeclaredName,
    );
    const fact = (file.result.data as unknown as { go?: FileFact } | undefined)
      ?.go;
    const scope =
      fact?.package === undefined
        ? undefined
        : packageNames.get(`${directoryOf(file.path)}\u0000${fact.package}`);
    for (const use of fact?.predeclared ?? []) {
      const shadowed =
        scope?.plain.has(use.n) ||
        (file.path.endsWith("_test.go") && scope?.test.has(use.n));
      if (!shadowed) continue;
      parsed.push({
        sourceKey: use.src,
        kind: use.k === "call" ? "calls" : "references",
        targetName: use.n,
        range: { start: use.s, end: use.e },
        data:
          use.k === "type"
            ? { t: { n: use.n }, predeclaredName: true }
            : { expr: { k: "name", n: use.n }, predeclaredName: true },
      });
    }
    const links = parsed.map((link) => {
      const data = link.data as { [key: string]: Json } | undefined;
      if (!data || !("overflow" in data || "builtin" in data || "open" in data))
        return link;
      const {
        overflow: _overflow,
        builtin: _builtin,
        open: _open,
        ...rest
      } = data;
      void _overflow;
      void _builtin;
      void _open;
      return { ...link, data: rest };
    });
    next.set(file.path, { ...file.result, symbols, links });
  }
  // Over-cap candidate sets (left unresolved) and real builtin calls are only known
  // project-wide; record them on the links themselves.
  const notes = linkNotes(
    ID,
    files.map((file) =>
      next.has(file.path) ? { ...file, result: next.get(file.path)! } : file,
    ),
    contextFiles,
  );
  for (const [path, group] of notes) {
    const result = next.get(path)!;
    result.links = result.links.map((link, index) => {
      const note = group.get(index);
      if (!note) return link;
      return {
        ...link,
        data: {
          ...((link.data as { [key: string]: Json } | undefined) ?? {}),
          ...(note.builtin ? { builtin: true } : {}),
          ...(note.open
            ? {
                open: {
                  reason: note.open[0]!,
                  // Every reason that applies, when there is more than one.
                  ...(note.open.length > 1 ? { reasons: note.open } : {}),
                },
              }
            : {}),
          ...(note.overflow
            ? {
                overflow: {
                  candidates: note.overflow.candidates,
                  cap: note.overflow.cap,
                },
              }
            : {}),
        },
      };
    });
  }
  const output: AnalyzedFile[] = [];
  for (const file of files) {
    const result = next.get(file.path);
    if (result && JSON.stringify(result) !== JSON.stringify(file.result))
      output.push({ path: file.path, result });
  }
  return output;
}

const go: LanguageModule = {
  id: ID,
  version: "14",
  extensions: [".go"],
  contextFiles: ["go.mod", "go.work"],
  parse,
  analyze,
  resolve: (context) => resolveGo(ID, context),
};
export default go;
