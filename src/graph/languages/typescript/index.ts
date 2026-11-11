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
import { CONTEXT_PATTERNS, projectModel, toVirtual } from "./project.js";
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

/**
 * Merges one file's results from equally ranked configs. Symbols are syntactic
 * and identical; a link whose targets differ between configs gets the union of
 * targets (candidates when every variant was complete) and, if any variant was
 * incomplete, the reason `ambiguous-project`, so no config is silently picked.
 */
function mergeTied(
  variants: ParseResult[],
  configs: (string | null)[],
): ParseResult {
  if (variants.some((variant) => variant.status === "failed"))
    return variants.find((variant) => variant.status === "failed")!;
  const [first] = variants;
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  if (
    variants.some(
      (variant) =>
        !same(variant.symbols, first!.symbols) ||
        variant.links.length !== first!.links.length ||
        variant.links.some(
          (link, index) =>
            link.kind !== first!.links[index]!.kind ||
            !same(link.range, first!.links[index]!.range),
        ),
    )
  )
    return failed(
      `Equally ranked configs ${configs.join(", ")} produced different structure for this file`,
    );
  const links = first!.links.map((link, index) => {
    const datas = variants.map(
      (variant) =>
        (variant.links[index]!.data ?? {}) as {
          targets?: TargetFact[];
          reason?: string;
        },
    );
    const outcome = (data: { targets?: TargetFact[]; reason?: string }) => [
      data.targets ?? [],
      data.reason ?? null,
    ];
    if (datas.every((data) => same(outcome(data), outcome(datas[0]!))))
      return link;
    const targets = new Map<string, TargetFact>();
    for (const data of datas)
      for (const target of data.targets ?? [])
        targets.set(`${target.file}\0${target.key}`, { ...target });
    const merged: { [key: string]: Json } = {
      ...(link.data as { [key: string]: Json }),
      projects: [...configs],
    };
    delete merged.targets;
    delete merged.reason;
    if (targets.size)
      merged.targets = [...targets.values()].map((t) => ({ ...t }));
    if (datas.some((data) => data.reason)) merged.reason = "ambiguous-project";
    return { ...link, data: merged };
  });
  const diagnostics = [
    ...new Map(
      variants
        .flatMap((variant) => variant.diagnostics)
        .map((diagnostic) => [JSON.stringify(diagnostic), diagnostic]),
    ).values(),
  ];
  return {
    ...first!,
    status: variants.some((variant) => variant.status === "partial")
      ? "partial"
      : first!.status,
    diagnostics,
    links,
    data: {
      ...(first!.data as { [key: string]: Json }),
      projects: [...configs],
    },
  };
}

const module: LanguageModule = {
  id: "typescript",
  version: MODULE_VERSION,
  // `.d.ts`, `.d.mts` and `.d.cts` are covered by the `.ts`, `.mts` and `.cts` claims.
  extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  contextFiles: CONTEXT_PATTERNS,
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
    const tiedResults = new Map<string, ParseResult[]>();
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
        if (model.ties.has(path))
          tiedResults.set(path, [...(tiedResults.get(path) ?? []), result]);
        else results.push({ path, result });
      }
    }
    for (const [path, variants] of tiedResults)
      results.push({
        path,
        result: mergeTied(
          variants,
          model.ties.get(path)!.map((group) => group.config),
        ),
      });
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
      // Never a guess: a set with a lost target (failed file) or a possible
      // declaration outside the project (`reason`) is not narrowed, neither to
      // one definite target nor to a candidate set that omits a possibility.
      const complete = ids.length === facts.length && !data?.reason;
      if (!complete) continue;
      if (ids.length === 1)
        resolutions.push({ linkId: link.id, targetId: ids[0]! });
      else if (ids.length >= 2)
        resolutions.push({ linkId: link.id, candidateIds: ids });
    }
    return resolutions;
  },
};
export default module;
