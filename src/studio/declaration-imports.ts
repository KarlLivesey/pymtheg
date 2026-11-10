import { realpath } from "node:fs/promises";
import { relative, isAbsolute } from "node:path";
import type { ProjectIR } from "../semantic/core.js";
import type { SourcePolicy } from "../shared/source-policy.js";
import { analyseInWorker } from "../cli/coordinator.js";
import { staleSourcesAsync } from "../language/project.js";
import { createDeclaration } from "./declaration-authoring.js";
import {
  declarationSchema,
  declarationTypeSelectionsSchema,
} from "./declaration-data.js";

export class DeclarationImportConflict extends Error {}
import { declarationTypeReferences } from "./declaration-references.js";
export { declarationTypeReferences } from "./declaration-references.js";
/** One fresh canonical IR checks the target buffer and every explicitly selected type source. */
export async function previewDeclarationImports(options: {
  ir: ProjectIR;
  root: string;
  file: string;
  value: unknown;
  sourceHash: string;
  selections: unknown;
  buffers?: Record<string, string>;
  sourcePolicy?: SourcePolicy;
  signal: AbortSignal;
  execution?: { analyse?: typeof analyseInWorker };
}) {
  options.signal.throwIfAborted();
  const value = declarationSchema.parse(options.value);
  const source = options.ir.snapshot.sources.find(
    (s) => s.file === options.file,
  );
  if (!source || source.hash !== options.sourceHash)
    throw new DeclarationImportConflict(
      "The target source changed. Check it again before adding the declaration.",
    );
  const referenced = declarationTypeReferences(value);
  const selections = declarationTypeSelectionsSchema
    .parse(options.selections)
    .filter((item) => referenced.has(item.symbolId));
  if (
    new Set(selections.map((item) => item.symbolId)).size !== selections.length
  )
    throw Error("Choose each imported type once.");
  for (const selection of selections) {
    const local = relative(options.root, selection.file);
    if (
      !isAbsolute(selection.file) ||
      isAbsolute(local) ||
      local === ".." ||
      local.startsWith("../") ||
      !selection.symbolId.startsWith(selection.file + "#")
    )
      throw Error(
        "Choose a type inside this project using its exact source identity.",
      );
    if (!Object.hasOwn(options.buffers ?? {}, selection.file)) {
      const actual = await realpath(selection.file).catch(() => null);
      options.signal.throwIfAborted();
      if (actual !== selection.file)
        throw new DeclarationImportConflict(
          "A selected type file moved or became a link. Refresh the type choices.",
        );
    }
  }
  if (!selections.length)
    return createDeclaration(
      options.ir,
      options.file,
      value,
      options.sourceHash,
    );
  const buffers = {
    ...options.buffers,
    ...Object.fromEntries(
      options.ir.snapshot.sources.map((s) => [s.file, s.text]),
    ),
  };
  const checked = await (options.execution?.analyse ?? analyseInWorker)({
    file: options.file,
    signal: options.signal,
    workerData: {
      root: options.root,
      buffers,
      sourcePolicy: options.sourcePolicy,
      additionalEntries: [...new Set(selections.map((item) => item.file))],
    },
  });
  options.signal.throwIfAborted();
  if (!checked.ir)
    throw Error(
      checked.report.diagnostics[0]?.message ??
        "The selected type sources could not be checked.",
    );
  const selectedSources = new Map(
    checked.ir.snapshot.sources.map((s) => [s.file, s]),
  );
  for (const selection of selections) {
    const source = selectedSources.get(selection.file),
      symbol = checked.ir.symbols.get(selection.symbolId);
    if (!source || source.hash !== selection.sourceHash)
      throw new DeclarationImportConflict(
        "A selected type source changed. Refresh the type choices and review the new definition.",
      );
    if (
      !symbol ||
      symbol.span.file !== selection.file ||
      !["type", "resource"].includes(symbol.kind)
    )
      throw new DeclarationImportConflict(
        "The selected type is no longer present at its recorded identity. Choose it again.",
      );
  }
  if (
    (
      await staleSourcesAsync(
        checked.ir.snapshot.sources.filter(
          (s) => !Object.hasOwn(buffers, s.file),
        ),
        options.signal,
      )
    ).length
  )
    throw new DeclarationImportConflict(
      "A selected import changed while checking. Refresh the type choices.",
    );
  const importClosure = new Set<string>(),
    pending = selections.map((s) => s.file);
  while (pending.length) {
    const path = pending.pop()!;
    if (importClosure.has(path)) continue;
    importClosure.add(path);
    pending.push(...(selectedSources.get(path)?.imports ?? []));
  }
  const preview = createDeclaration(
    checked.ir,
    options.file,
    value,
    options.sourceHash,
  );
  return {
    ...preview,
    baseSnapshotId: options.ir.snapshot.id,
    importedSources: checked.ir.snapshot.sources
      .filter((s) => importClosure.has(s.file))
      .map((s) => ({ file: s.file, hash: s.hash })),
  };
}

/** Resolve only identity fields; authored names/text remain untouched. */
export async function normalizeDeclarationSymbols(
  value: unknown,
  resolveSymbol: (id: string) => Promise<string>,
): Promise<unknown> {
  let count = 0;
  async function visit(item: unknown, depth: number): Promise<unknown> {
    if (++count > 10000 || depth > 25)
      throw Error("Declaration edit is too deeply nested or large.");
    if (Array.isArray(item)) {
      const result = [];
      for (const v of item) result.push(await visit(v, depth + 1));
      return result;
    }
    if (item && typeof item === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(item))
        result[key] =
          key === "symbolId" && typeof v === "string"
            ? await resolveSymbol(v)
            : await visit(v, depth + 1);
      return result;
    }
    return item;
  }
  return visit(value, 0);
}
