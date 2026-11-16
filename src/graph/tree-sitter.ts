// SPDX-License-Identifier: MIT
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import {
  Language,
  Parser,
  Query,
  type QueryMatch,
  type Tree,
  type Node,
} from "web-tree-sitter";
import type {
  ParseResult,
  SymbolDraft,
  SourceRange,
  LinkDraft,
} from "./types.js";
const require = createRequire(import.meta.url);
let initialized: Promise<void> | undefined;
export interface TagReference {
  kind: string;
  name: string;
  range: SourceRange;
  node: Node;
  match: QueryMatch;
}
export interface TagsPass {
  /** Borrowed until the callback returns. Never retain native nodes/trees. */
  tree: Tree;
  matches: readonly QueryMatch[];
  references: readonly TagReference[];
  result: ParseResult;
}
export interface TagsOptions {
  /** Absolute grammar WASM path; resolve from the language module's package. */
  wasmPath: string;
  /** Full tags.scm contents; paired @name / @definition.kind captures are mapped. */
  query: string;
  /** Runs synchronously while the whole tree and all reference captures are alive.
   * Add language-specific links/scopes or replace/deduplicate symbols on result. */
  secondPass?: (pass: TagsPass) => void;
  /** Optional reference-to-link mapper; undefined retains exposure through secondPass. */
  mapReference?: (
    reference: TagReference,
    symbols: readonly SymbolDraft[],
  ) => LinkDraft | undefined;
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
          failureKind: "transient",
          diagnostics: [{ message: "Tree-sitter returned no tree" }],
          symbols: [],
          links: [],
        };
      try {
        const symbols: SymbolDraft[] = [];
        const seen = new Set<string>();
        const matches = query.matches(tree.rootNode);
        const references: TagReference[] = [];
        for (const match of matches) {
          const name = match.captures.find(
            (capture) => capture.name === "name",
          )?.node;
          for (const capture of match.captures.filter((item) =>
            item.name.startsWith("reference."),
          )) {
            references.push({
              kind: capture.name.slice("reference.".length),
              name: name?.text ?? capture.node.text,
              range: {
                start: capture.node.startIndex,
                end: capture.node.endIndex,
              },
              node: capture.node,
              match,
            });
          }
          for (const capture of match.captures.filter((item) =>
            item.name.startsWith("definition."),
          )) {
            if (!name) continue;
            const kind = capture.name.slice("definition.".length);
            const key = `${kind}:${name.startIndex}:${name.text}`;
            const symbol: SymbolDraft = {
              key,
              name: name.text,
              identity: name.text,
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
        const result: ParseResult = {
          status: tree.rootNode.hasError ? "partial" : "clean",
          diagnostics: tree.rootNode.hasError
            ? [{ message: "Tree-sitter syntax error or missing node" }]
            : [],
          symbols,
          links: [],
        };
        for (const reference of references) {
          const link = options.mapReference?.(reference, symbols);
          if (link) result.links.push(link);
        }
        options.secondPass?.({ tree, matches, references, result });
        if (tree.rootNode.hasError && result.status === "clean") {
          result.status = "partial";
          result.diagnostics.push({
            message: "Tree-sitter syntax error or missing node",
          });
        }
        return result;
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
