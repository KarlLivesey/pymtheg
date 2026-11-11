import ts from "typescript";
import { contentHash } from "../../index.js";
import type {
  AnalyzedFile,
  Diagnostic,
  GraphFile,
  Json,
  LanguageModule,
  LinkResolution,
  ParseResult,
} from "../../types.js";
import { extractFile, type TargetFact } from "./extract.js";
import { projectModel, toVirtual } from "./project.js";
import { withChecker } from "./symbols.js";

/**
 * TypeScript and JavaScript through the TypeScript compiler. Analyze-only: one
 * Program per owning config, built over the captured snapshot through a virtual
 * host. Analysis records each link's checker targets as (file, symbol key)
 * facts; resolve maps those facts to symbol IDs. See docs/changes/W2-D.md.
 */
const MODULE_VERSION = `1+typescript-${ts.version}`;

/** Observation counters for tests (programs built, files extracted). Not a correctness input. */
export const statistics = { programs: 0, extracted: 0, reused: 0 };

// A file whose text re-encodes to its captured byte hash was readable; unreadable
// sources are stored with empty text and the hash of their original bytes.
const readable = (file: GraphFile) =>
  contentHash(Buffer.from(file.text, "utf8")) === file.hash;

const failed = (message: string): ParseResult => ({
  status: "failed",
  diagnostics: [{ message }],
  symbols: [],
  links: [],
});

const module: LanguageModule = {
  id: "typescript",
  version: MODULE_VERSION,
  // `.d.ts`, `.d.mts` and `.d.cts` are covered by the `.ts`, `.mts` and `.cts` claims.
  extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  contextFiles: ["tsconfig*.json", "jsconfig*.json", "package.json"],
  analyze(context) {
    const files = context.files.filter(readable);
    // Unchanged snapshot: stored facts came from a complete analysis of these exact
    // sources and contexts by this module version, so they are reused unparsed.
    if (
      !context.changedFiles.length &&
      !context.changedContextFiles.length &&
      files.every(
        (file) =>
          file.result.status !== "failed" &&
          (file.result.data as { analyzer?: unknown } | undefined)?.analyzer ===
            MODULE_VERSION,
      )
    ) {
      statistics.reused++;
      return files.map((file) => ({ path: file.path, result: file.result }));
    }
    const model = projectModel(files, context.contextFiles);
    const captured = new Set(files.map((file) => file.path));
    const results: AnalyzedFile[] = [];
    // A broken config or manifest fails only the files it governs, not the module.
    for (const [path, message] of model.failures)
      results.push({ path, result: failed(message) });
    for (const group of model.groups) {
      if (!group.roots.length) continue;
      const program = ts.createProgram({
        rootNames: group.roots,
        options: group.options,
        host: model.host(group),
      });
      statistics.programs++;
      const checker = program.getTypeChecker();
      for (const root of group.roots) {
        const path = root.slice(1);
        const source = program.getSourceFile(toVirtual(path));
        const data: { [key: string]: Json } = {
          analyzer: MODULE_VERSION,
          project: group.config,
        };
        if (group.notes.length) data.configNotes = [...group.notes];
        const diagnostics: Diagnostic[] = group.limitations.map((message) => ({
          message,
        }));
        let result: ParseResult;
        try {
          if (!source) throw Error("The compiler did not load this source");
          result = withChecker(checker, () =>
            extractFile(source, checker, program, captured, diagnostics, data),
          );
          statistics.extracted++;
        } catch (error) {
          result = failed(
            `TypeScript extraction failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        results.push({ path, result });
      }
    }
    return results;
  },
  resolve({ symbols, links }) {
    const byKey = new Map<string, string>();
    for (const symbol of symbols)
      if (symbol.module === module.id)
        byKey.set(`${symbol.file}\0${symbol.key}`, symbol.id);
    const resolutions: LinkResolution[] = [];
    for (const link of links) {
      const data = link.data as
        | { targets?: TargetFact[]; reason?: string }
        | undefined;
      const facts = data?.targets ?? [];
      const ids = [
        ...new Set(
          facts
            .map((fact) => byKey.get(`${fact.file}\0${fact.key}`))
            .filter((id): id is string => id !== undefined),
        ),
      ];
      // Never a guess: a lost or incomplete target set is not narrowed to one definite target.
      const complete = ids.length === facts.length && !data?.reason;
      if (ids.length === 1 && complete)
        resolutions.push({ linkId: link.id, targetId: ids[0]! });
      else if (ids.length >= 2)
        resolutions.push({ linkId: link.id, candidateIds: ids });
    }
    return resolutions;
  },
};
export default module;
