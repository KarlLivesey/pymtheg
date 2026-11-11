import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Language, Parser, Query, type QueryMatch } from "web-tree-sitter";
import type { ParseResult, SymbolDraft } from "./types.js";
const require = createRequire(import.meta.url);
let initialized: Promise<void> | undefined;
export interface TagsOptions {
  /** Absolute grammar WASM path; resolve from the language module's package. */
  wasmPath: string;
  /** Full tags.scm contents; paired @name / @definition.kind captures are mapped. */
  query: string;
  /** Override symbol mapping for scope, custom kinds or metadata. No tree may escape parse(). */
  mapDefinition?: (
    match: QueryMatch,
    defaultSymbol: SymbolDraft,
  ) => SymbolDraft | undefined;
}
/** Reusable parser/query; caller owns dispose(), including when a test fails. */
export async function createTagsParser(
  options: TagsOptions,
): Promise<{ parse(text: string): ParseResult; dispose(): void }> {
  initialized ??= Parser.init({
    locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
  });
  await initialized;
  const language = await Language.load(options.wasmPath);
  const parser = new Parser();
  let query: Query;
  try {
    parser.setLanguage(language);
    query = new Query(language, options.query);
  } catch (error) {
    parser.delete();
    throw error;
  }
  let disposed = false;
  return {
    parse(text) {
      if (disposed) throw Error("Tags parser is disposed");
      const tree = parser.parse(text);
      if (!tree)
        return {
          status: "failed",
          diagnostics: [{ message: "Tree-sitter returned no tree" }],
          symbols: [],
          links: [],
        };
      try {
        const symbols: SymbolDraft[] = [];
        const seen = new Set<string>();
        for (const match of query.matches(tree.rootNode)) {
          const name = match.captures.find(
            (capture) => capture.name === "name",
          )?.node;
          for (const capture of match.captures.filter((item) =>
            item.name.startsWith("definition."),
          )) {
            if (!name) continue;
            const kind = capture.name.slice("definition.".length);
            const key = `${kind}:${name.startIndex}:${name.text}`;
            const symbol: SymbolDraft = {
              key,
              name: name.text,
              kind,
              range: {
                start: capture.node.startIndex,
                end: capture.node.endIndex,
              },
            };
            const mapped = options.mapDefinition
              ? options.mapDefinition(match, symbol)
              : symbol;
            if (mapped && !seen.has(mapped.key)) {
              seen.add(mapped.key);
              symbols.push(mapped);
            }
          }
        }
        return {
          status: tree.rootNode.hasError ? "partial" : "clean",
          diagnostics: tree.rootNode.hasError
            ? [{ message: "Tree-sitter syntax error or missing node" }]
            : [],
          symbols,
          links: [],
        };
      } finally {
        tree.delete();
      }
    },
    dispose() {
      if (!disposed) {
        query.delete();
        parser.delete();
        disposed = true;
      }
    },
  };
}
/** Convenience for modules whose grammar packages expose their WASM and query assets. */
export async function tagsFromPackage(
  packageName: string,
  wasm: string,
  queryPath = "queries/tags.scm",
): Promise<TagsOptions> {
  return {
    wasmPath: require.resolve(`${packageName}/${wasm}`),
    query: await readFile(
      require.resolve(`${packageName}/${queryPath}`),
      "utf8",
    ),
  };
}
