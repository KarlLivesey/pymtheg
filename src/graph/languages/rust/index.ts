// SPDX-License-Identifier: MIT
import type { ContextFile, GraphFile, LanguageModule } from "../../types.js";
import { crates } from "./cargo.js";
import type { AddedLink, Json } from "../../types.js";
import { parseRust } from "./parse.js";
import { fileFacts } from "../../identity.js";
import { resolveRust, type RustDecisionScope } from "./resolve.js";
import { count } from "../../work.js";
import { macroScopeAssumption } from "./macro-scope.js";
import { runRustPhase } from "./phase-runner.js";
import { rustSurface } from "./incremental.js";

const TARGET_HINT_LIMIT = 16;

type RustAnalysisInput = {
  projectId: string;
  files: readonly Pick<GraphFile, "path" | "module" | "result">[];
  contextFiles: Parameters<typeof crates>[0];
  /** C-36: annotate only these files; every file still supplies facts. */
  scope?: readonly string[];
};

const cargoInputs = (files: readonly ContextFile[]) =>
  files.map(({ path, status, text }) => ({ path, status, text }));

type Crates = ReadonlyMap<string, ReturnType<typeof crates>[number]>;
const crateRoots = (
  contextFiles: Parameters<typeof crates>[0],
  files: readonly Pick<GraphFile, "path">[],
): Crates =>
  new Map(
    crates(contextFiles, new Set(files.map((f) => f.path))).map((c) => [
      c.root,
      c,
    ]),
  );

/** The facts the analysis pass starts from: the parse facts without earlier annotations. */
function analysisInput(
  f: Pick<GraphFile, "path" | "result">,
  roots: Crates,
): Pick<GraphFile, "path" | "result"> {
  const crate = roots.get(f.path);
  const metadata = (f.result.data ?? {}) as Record<string, Json>;
  const contexts = (metadata.attributeContexts ?? []) as {
    sourceConditions?: string[];
  }[];
  const initialConditions = (d: Record<string, Json>): string[] => [
    ...new Set(
      metadata.hasSourceConditions
        ? (contexts[Number(d.attributeContext)]?.sourceConditions ?? [])
        : ((d.conditions ?? []) as string[]),
    ),
  ];
  return {
    path: f.path,
    result: {
      ...f.result,
      links: f.result.links.map((l) => {
        const {
          targets,
          targetCount,
          uncertainty,
          assumes,
          cause,
          opaqueAttributes,
          receiverTyping,
          ...rest
        } = (l.data ?? {}) as Record<string, Json>;
        return {
          ...l,
          data: {
            ...rest,
            conditions: initialConditions(rest),
          } as Record<string, Json>,
        };
      }),
      symbols: f.result.symbols.map((s) => {
        const { underOpaqueAttribute, opaqueAttributes, ...rest } = (s.data ??
          {}) as Record<string, Json>;
        return {
          ...s,
          data: {
            ...rest,
            conditions: initialConditions(rest),
            ...(s.key === "file"
              ? {
                  unitKind: crate ? "crate" : "module",
                  crateName: crate?.name ?? "",
                  targetKind: crate?.kind ?? "",
                  edition: crate?.edition ?? null,
                  manifest: crate?.manifest ?? "",
                  workspace: crate?.workspace ?? null,
                }
              : {}),
          } as Record<string, Json>,
        };
      }),
    },
  };
}

type RustRecord = Pick<GraphFile, "path" | "module" | "result">;
const byId = (a: { id: string }, b: { id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The resolve phase's input, built from stored file records exactly as the
 * store presents it: every Rust symbol and parsed link in id order, unresolved.
 */
function resolutionInput(
  projectId: string,
  records: readonly RustRecord[],
  contextFiles: Parameters<typeof crates>[0],
) {
  const rust = records.filter((file) => file.module === "rust");
  const facts = rust.map((file) => fileFacts(projectId, file));
  return {
    projectId,
    contextFiles,
    files: rust.map(({ path, module, result }) => {
      const { status, diagnostics, data } = result;
      return {
        path,
        module,
        result: {
          status,
          diagnostics,
          ...(data === undefined ? {} : { data }),
        },
      };
    }),
    symbols: facts.flatMap((fact) => fact.symbols).sort(byId),
    links: facts.flatMap((fact) => fact.links).sort(byId),
  };
}

type ScopedRequest = RustAnalysisInput & {
  scope: readonly string[];
  /** The stored record of every edited file, before the edit. */
  previous: readonly RustRecord[];
};

/**
 * C-36: why the edited files' links cannot be re-decided alone, or undefined
 * with their analyzed results when they can. Every other file keeps its
 * stored annotations and decisions only when (1) each edited file is clean
 * before and after, (2) its surface is unchanged, before and after analysis,
 * and (3) no lookup cut was met while deciding its links, with its new facts
 * and with its old ones, in the analysis and the resolution pass. Answers
 * met without a cut do not depend on which lookups ran before them, so the
 * edited file's decisions equal a cold index's, and adding or removing its
 * lookups cannot change another file's.
 */
function scopedAnalysis(
  request: ScopedRequest,
):
  | { reason: string }
  | { files: Pick<GraphFile, "path" | "result">[]; cuts: number } {
  const { projectId, files, contextFiles, scope, previous } = request;
  const before = new Map(previous.map((file) => [file.path, file]));
  const current = new Map(files.map((file) => [file.path, file]));
  const roots = crateRoots(contextFiles, files);
  for (const path of scope) {
    const old = before.get(path),
      now = current.get(path);
    if (!old || !now) return { reason: "previous-record" };
    if (old.result.status !== "clean" || now.result.status !== "clean")
      return { reason: "status" };
    if (
      rustSurface(analysisInput(old, roots).result) !==
      rustSurface(analysisInput(now, roots).result)
    )
      return { reason: "surface" };
  }
  const restored = files.map((file) => before.get(file.path) ?? file);
  const analysis = rustPhases.analyze({
    projectId,
    files,
    contextFiles,
    scope,
  });
  if (analysis.decisionCuts) return { reason: "lookup-cut" };
  if (
    rustPhases.analyze({ projectId, files: restored, contextFiles, scope })
      .decisionCuts
  )
    return { reason: "lookup-cut" };
  const analyzed = new Map(analysis.files.map((file) => [file.path, file]));
  for (const path of scope)
    if (
      rustSurface(analyzed.get(path)!.result) !==
      rustSurface(before.get(path)!.result)
    )
      return { reason: "analyzed-surface" };
  const after = files.map((file) => {
    const result = analyzed.get(file.path)?.result;
    return result ? { ...file, result } : file;
  });
  for (const records of [after, restored])
    if (
      rustPhases.resolve({
        ...resolutionInput(projectId, records, contextFiles),
        scope,
      }).decisionCuts
    )
      return { reason: "lookup-cut" };
  return { files: analysis.files, cuts: analysis.cuts };
}

export const rustPhases = {
  analyzeScoped(request: ScopedRequest) {
    const scoped = scopedAnalysis(request);
    if ("files" in scoped) return { scoped: true as const, ...scoped };
    const { scope: _scope, previous: _previous, ...full } = request;
    return {
      scoped: false as const,
      reason: scoped.reason,
      ...rustPhases.analyze(full),
    };
  },
  analyze({ projectId, files, contextFiles, scope }: RustAnalysisInput) {
    const inScope = scope ? new Set(scope) : undefined;
    const roots = crateRoots(contextFiles, files);
    const analyzed = files
      .filter((f) => f.result.status !== "failed")
      .map((f) => analysisInput(f, roots));
    const byPath = new Map(analyzed.map((a) => [a.path, a]));
    const updated = files.map((f) => ({
      ...f,
      result: byPath.get(f.path)?.result ?? f.result,
    }));
    const facts = updated.map((f) => fileFacts(projectId, f));
    const unknown = new Map<
      string,
      {
        targets?: string[];
        targetCount?: number;
        reason: string;
        files?: string[] | undefined;
        attributes?: string[] | undefined;
      }
    >();
    const presence = new Map<string, string[]>();
    const conditions = new Map<string, string[]>();
    const assumedScope = new Set<string>();
    const notes = new Map<string, Record<string, Json>>();
    const decide: RustDecisionScope = inScope ? { files: inScope } : {};
    resolveRust(
      {
        projectId,
        files: updated,
        contextFiles,
        symbols: facts.flatMap((f) => f.symbols),
        links: facts.flatMap((f) => f.links),
      },
      (l, targets, reason, files, attributes) =>
        unknown.set(l.id, {
          ...(reason === "invalid-code"
            ? {}
            : targets.length > TARGET_HINT_LIMIT
              ? { targetCount: targets.length }
              : { targets: targets.map((t) => t.id).sort() }),
          reason:
            reason !== "invalid-code" && targets.length > TARGET_HINT_LIMIT
              ? reason + "; too-many-targets"
              : reason,
          files: files ? [...new Set(files)].sort() : undefined,
          attributes: attributes?.length
            ? [...new Set(attributes)].sort()
            : undefined,
        }),
      (symbol, attributes, gates) => {
        presence.set(symbol.id, attributes);
        conditions.set(symbol.id, gates);
      },
      (link, gates) => conditions.set(link.id, gates),
      undefined,
      undefined,
      (link, extra) => notes.set(link.id, extra),
      (link, assumed) => {
        unknown.delete(link.id);
        if (assumed) assumedScope.add(link.id);
      },
      undefined,
      decide,
    );
    for (let i = 0; i < updated.length; i++) {
      const f = updated[i]!,
        a = inScope && !inScope.has(f.path) ? undefined : byPath.get(f.path);
      if (a)
        a.result.symbols = a.result.symbols.map((symbol, j) => {
          const id = facts[i]!.symbols[j]!.id,
            attributes = presence.get(id);
          symbol = {
            ...symbol,
            data: {
              ...(symbol.data as Record<string, Json>),
              conditions:
                conditions.get(id) ??
                (symbol.data as Record<string, Json>).conditions ??
                [],
            },
          };
          return attributes?.length
            ? {
                ...symbol,
                data: {
                  ...(symbol.data as Record<string, Json>),
                  underOpaqueAttribute: true,
                  opaqueAttributes: attributes,
                },
              }
            : symbol;
        });
      if (a)
        a.result.links = a.result.links.map((l, j) => {
          const id = facts[i]!.links[j]!.id,
            u = unknown.get(id),
            gates = conditions.get(id),
            note = notes.get(id);
          if (gates)
            l = {
              ...l,
              data: { ...(l.data as Record<string, Json>), conditions: gates },
            };
          if (note)
            l = {
              ...l,
              data: { ...(l.data as Record<string, Json>), ...note },
            };
          if (assumedScope.has(id))
            l = {
              ...l,
              data: {
                ...(l.data as Record<string, Json>),
                assumes: [macroScopeAssumption],
              },
            };
          return u
            ? {
                ...l,
                data: {
                  ...(l.data as Record<string, Json>),
                  ...(u.reason === "invalid-code"
                    ? { cause: { files: u.files ?? [] } }
                    : u.targetCount !== undefined
                      ? { targetCount: u.targetCount }
                      : { targets: u.targets ?? [] }),
                  uncertainty: u.reason,
                  ...(u.reason !== "invalid-code" && u.attributes?.length
                    ? { opaqueAttributes: u.attributes }
                    : {}),
                },
              }
            : l;
        });
    }
    return {
      files: inScope ? analyzed.filter((a) => inScope.has(a.path)) : analyzed,
      cuts: decide.runCuts ?? 0,
      decisionCuts: decide.decisionCuts ?? 0,
    };
  },
  resolve(
    ctx: Parameters<typeof resolveRust>[0] & { scope?: readonly string[] },
  ) {
    const links: AddedLink[] = [];
    const decide: RustDecisionScope = ctx.scope
      ? { files: new Set(ctx.scope) }
      : {};
    const resolutions = resolveRust(
      ctx,
      undefined,
      undefined,
      undefined,
      (l) => links.push(l),
      undefined,
      undefined,
      undefined,
      undefined,
      decide,
    );
    return {
      result: {
        resolutions,
        links,
        missingLinkReason: "analysis-resolution-disagreement",
      },
      cuts: decide.runCuts ?? 0,
      decisionCuts: decide.decisionCuts ?? 0,
    };
  },
};

const rust: LanguageModule = {
  id: "rust",
  version: "45",
  extensions: [".rs"],
  contextFiles: [
    "Cargo.toml",
    "Cargo.lock",
    "**/.cargo/config.toml",
    "**/.cargo/config",
  ],
  incrementalAnalysis: true,
  parse: parseRust,
  async analyze({
    projectId,
    files,
    contextFiles,
    signal,
    previousFiles,
    changedContextFiles,
  }) {
    if (!files.length) return [];
    const context = {
      projectId,
      files: files.map(({ path, module, result }) => ({
        path,
        module,
        result,
      })),
      contextFiles: cargoInputs(contextFiles),
    };
    // A changed manifest, lockfile or Cargo configuration, and any edit the
    // indexer cannot compare with a previous record, use the full pass.
    if (previousFiles?.size && !changedContextFiles.length) {
      const request = {
        ...context,
        scope: [...previousFiles.keys()],
        previous: [...previousFiles.values()].map(
          ({ path, module, result }) => ({ path, module, result }),
        ),
      };
      const output = signal
        ? await runRustPhase(
            { phase: "analyzeScoped", context: request },
            signal,
          )
        : rustPhases.analyzeScoped(request);
      count("analyze.rust.lookupCuts", output.cuts);
      if (output.scoped) {
        count("analyze.rust.scopedFiles", request.scope.length);
        return { files: output.files, resolutionFiles: request.scope };
      }
      count(`analyze.rust.fullPass.${output.reason}`);
      return output.files;
    }
    const output = signal
      ? await runRustPhase({ phase: "analyze", context }, signal)
      : rustPhases.analyze(context);
    count("analyze.rust.lookupCuts", output.cuts);
    return output.files;
  },
  async resolve({
    projectId,
    files,
    contextFiles,
    symbols,
    links,
    signal,
    resolutionFiles,
  }) {
    if (!links.length) return [];
    if (resolutionFiles) {
      // The scoped analysis proved these decisions with this exact input:
      // every stored record's links and symbols, in the store's id order.
      // Without declared scoped link kinds the indexer passes whole records.
      const records = files as readonly Partial<RustRecord>[];
      if (records.some((file) => !file.result?.symbols))
        throw Error("Rust scoped resolution needs whole file records");
      const input = {
        ...resolutionInput(
          projectId,
          (records as readonly RustRecord[]).map(
            ({ path, module, result }) => ({ path, module, result }),
          ),
          cargoInputs(contextFiles),
        ),
        scope: [...resolutionFiles],
      };
      const output = signal
        ? await runRustPhase({ phase: "resolve", context: input }, signal)
        : rustPhases.resolve(input);
      count("resolve.rust.decisionFiles", resolutionFiles.size);
      count("resolve.rust.lookupCuts", output.cuts);
      if (output.decisionCuts)
        throw Error("Rust scoped resolution met a lookup cycle after analysis");
      return output.result;
    }
    // Parsed drafts and raw source text are not consumed by the resolver.
    const input = {
      projectId,
      contextFiles: cargoInputs(contextFiles),
      files: files
        .filter((file) => file.module === "rust")
        .map(({ path, module, result }) => {
          const { status, diagnostics, data } = result;
          return {
            path,
            module,
            result: {
              status,
              diagnostics,
              ...(data === undefined ? {} : { data }),
            },
          };
        }),
      symbols: symbols.filter((symbol) => symbol.module === "rust"),
      links,
    };
    const output = signal
      ? await runRustPhase({ phase: "resolve", context: input }, signal)
      : rustPhases.resolve(input);
    count("resolve.rust.lookupCuts", output.cuts);
    return output.result;
  },
};
export default rust;
