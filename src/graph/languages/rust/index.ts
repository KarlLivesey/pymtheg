// SPDX-License-Identifier: MIT
import type {
  AnalyzedFile,
  ContextFile,
  GraphFile,
  LanguageModule,
  LinkResolution,
} from "../../types.js";
import { crates } from "./cargo.js";
import type { AddedLink, GraphLink, GraphSymbol, Json } from "../../types.js";
import { rustRoute } from "./toolchain-route.js";
import { parseRust } from "./parse.js";
import { compare, fileFacts } from "../../identity.js";
import { resolveRust } from "./resolve.js";
import { macroScopeAssumption } from "./macro-scope.js";
import { runRustPhase } from "./phase-runner.js";

const TARGET_HINT_LIMIT = 16;

type RustAnalysisInput = {
  projectId: string;
  files: readonly Pick<GraphFile, "path" | "module" | "result">[];
  contextFiles: Parameters<typeof crates>[0];
  /**
   * C-43: the toolchain route is on and answered. Links carrying `tc` (a
   * checkout symbol id from the strict join) are decided here.
   */
  toolchain?: { rustAnalyzer: string; configuration: string };
};

/** Toolchain answers by outcome, and the first disagreements. */
export interface ToolchainDecisions {
  counts: Record<string, number>;
  disagreements: Json[];
}
const DISAGREEMENT_LIMIT = 50;
const beyondTest = (gates: readonly Json[] | undefined) =>
  (gates ?? []).some((gate) => gate !== "test");
/** Link data that explains an open link; dropped when the toolchain decides it. */
const OPEN_DATA = [
  "uncertainty",
  "targets",
  "targetCount",
  "opaqueAttributes",
  "cause",
  "assumes",
];

const cargoInputs = (files: readonly ContextFile[]) =>
  files.map(({ path, status, text }) => ({ path, status, text }));

// C-24: stores list rows by id, and every id includes the project's random
// id, so two indexes of one snapshot list the same rows in different orders.
// Lookups through glob cycles can depend on which lookup ran first, so the
// Rust phases take their inputs in an order the snapshot alone fixes: path,
// then position, then what is written there.
const pathOrder = <T extends { path: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => compare(a.path, b.path));
const bySite = <
  T extends {
    file: string;
    range: { start: number; end: number };
    kind: string;
    data?: Json | undefined;
  },
>(
  items: readonly T[],
  written: (item: T) => string[],
): T[] =>
  [...items].sort(
    (a, b) =>
      compare(a.file, b.file) ||
      a.range.start - b.range.start ||
      a.range.end - b.range.end ||
      compare(a.kind, b.kind) ||
      written(a).reduce(
        (order, part, i) => order || compare(part, written(b)[i]!),
        0,
      ) ||
      compare(JSON.stringify(a.data ?? null), JSON.stringify(b.data ?? null)),
  );
const symbolOrder = (symbols: readonly GraphSymbol[]) =>
  bySite(symbols, (s) => [s.key, s.identity, s.name]);
const linkOrder = (links: readonly GraphLink[]) =>
  bySite(links, (l) => [l.origin, l.targetName, l.sourceKey ?? ""]);

/**
 * C-43: decide each link the strict join answered, against the source-only
 * answer and the cfg conditions this analysis found:
 * - a link under a cfg condition other than `test` takes no answer (the
 *   toolchain sees one configuration);
 * - an answer whose target is under such a condition, or shares its
 *   kind and identity with a symbol under such a condition (a cfg variant:
 *   two items of one path can only both exist under cfg), takes no answer, and a
 *   candidate set holding such a symbol stays a candidate set;
 * - a source-only definite target that differs is kept, and counted;
 * - a source-only library answer is kept;
 * - a candidate set holding the answer, or an unresolved link, becomes
 *   definite. The answer is recorded on the link (`toolchain`), and the
 *   resolve phase applies it where the source-only answer is still open.
 */
function decideToolchain(
  updated: readonly { path: string }[],
  facts: readonly { symbols: GraphSymbol[]; links: GraphLink[] }[],
  byPath: Map<string, { result: AnalyzedFile["result"] }>,
  resolutions: Map<string, LinkResolution>,
  toolchain: NonNullable<RustAnalysisInput["toolchain"]>,
): ToolchainDecisions {
  const counts: Record<string, number> = {};
  const disagreements: Json[] = [];
  const bump = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);
  // Final symbol conditions, and how many symbols share each identity.
  const gated = new Set<string>();
  const identityOf = new Map<string, string>();
  /** Identities (kind and in-file path) some gated symbol has. */
  const gatedIdentities = new Set<string>();
  updated.forEach((f, i) => {
    const symbols = byPath.get(f.path)?.result.symbols;
    if (!symbols) return;
    symbols.forEach((symbol, j) => {
      const id = facts[i]!.symbols[j]!.id;
      const data = (symbol.data ?? {}) as Record<string, Json>;
      const identity = `${symbol.kind}\u0000${symbol.identity}`;
      identityOf.set(id, identity);
      if (beyondTest(data.conditions as Json[] | undefined)) {
        gated.add(id);
        gatedIdentities.add(identity);
      }
    });
  });
  const variant = (id: string) =>
    gated.has(id) || gatedIdentities.has(identityOf.get(id) ?? "");
  updated.forEach((f, i) => {
    const a = byPath.get(f.path);
    if (!a) return;
    a.result.links = a.result.links.map((l, j) => {
      const data = (l.data ?? {}) as Record<string, Json>;
      if (!("tc" in data)) return l;
      const { tc, ...rest } = data;
      const target = String(tc);
      const id = facts[i]!.links[j]!.id;
      const kept = (why: string) => {
        bump(why);
        return { ...l, data: rest };
      };
      if (beyondTest(rest.conditions as Json[] | undefined))
        return kept("withheld:cfg-link");
      if (!identityOf.has(target)) return kept("withheld:no-symbol");
      if (variant(target)) return kept("withheld:cfg-variant");
      const r = resolutions.get(id);
      let from: "definite" | "candidates" | "unresolved";
      if (r?.targetId) {
        if (r.targetId !== target) {
          if (disagreements.length < DISAGREEMENT_LIMIT)
            disagreements.push({
              file: f.path,
              range: [l.range.start, l.range.end],
              kind: l.kind,
              name: l.targetName,
              sourceOnly: r.targetId,
              toolchain: target,
            });
          return kept("kept:source-only-differs");
        }
        from = "definite";
      } else if (r?.library) return kept("kept:source-only-library");
      else if (r?.candidateIds) {
        if (!r.candidateIds.includes(target))
          return kept("kept:outside-candidate-set");
        if (r.libraries?.length || r.candidateIds.some(variant))
          return kept("withheld:cfg-variant");
        from = "candidates";
      } else from = "unresolved";
      bump(`definite:${from}`);
      const decided: Record<string, Json> = { ...rest };
      if (from !== "definite") for (const key of OPEN_DATA) delete decided[key];
      decided.toolchain = {
        origin: "toolchain",
        rustAnalyzer: toolchain.rustAnalyzer,
        configuration: toolchain.configuration,
        upgrade: "definite",
        from,
        ...(from === "definite" ? {} : { target }),
      };
      return { ...l, data: decided };
    });
  });
  return { counts, disagreements };
}

export const rustPhases = {
  analyze({
    projectId,
    files: listed,
    contextFiles: contexts,
    toolchain,
  }: RustAnalysisInput): {
    files: AnalyzedFile[];
    toolchain?: ToolchainDecisions;
  } {
    const files = pathOrder(listed),
      contextFiles = pathOrder(contexts);
    const roots = new Map(
      crates(contextFiles, new Set(files.map((f) => f.path))).map((c) => [
        c.root,
        c,
      ]),
    );
    const analyzed = files
      .filter((f) => f.result.status !== "failed")
      .map((f) => {
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
                // A previous run's toolchain record is decided again.
                toolchain: _toolchain,
                ...rest
              } = (l.data ?? {}) as Record<string, Json>;
              void _toolchain;
              return {
                ...l,
                data: {
                  ...rest,
                  conditions: initialConditions(rest),
                } as Record<string, Json>,
              };
            }),
            symbols: f.result.symbols.map((s) => {
              const { underOpaqueAttribute, opaqueAttributes, ...rest } =
                (s.data ?? {}) as Record<string, Json>;
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
      });
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
    const resolutions = resolveRust(
      {
        projectId,
        files: updated,
        contextFiles,
        symbols: symbolOrder(facts.flatMap((f) => f.symbols)),
        links: linkOrder(facts.flatMap((f) => f.links)),
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
    );
    for (let i = 0; i < updated.length; i++) {
      const f = updated[i]!,
        a = byPath.get(f.path);
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
    if (!toolchain) return { files: analyzed };
    return {
      files: analyzed,
      toolchain: decideToolchain(
        updated,
        facts,
        byPath,
        new Map(resolutions.map((r) => [r.linkId, r])),
        toolchain,
      ),
    };
  },
  resolve(input: Parameters<typeof resolveRust>[0]) {
    const ctx = {
      ...input,
      files: pathOrder(input.files),
      contextFiles: pathOrder(input.contextFiles),
      symbols: symbolOrder(input.symbols),
      links: linkOrder(input.links),
    };
    const links: AddedLink[] = [];
    let resolutions = resolveRust(ctx, undefined, undefined, undefined, (l) =>
      links.push(l),
    );
    // C-43: the toolchain's answer, where the source-only one is still open.
    const upgraded = new Map<string, string>();
    for (const link of ctx.links) {
      const record = (link.data as { toolchain?: Record<string, Json> })
        ?.toolchain;
      if (
        record?.origin === "toolchain" &&
        typeof record.target === "string" &&
        record.from !== "definite"
      )
        upgraded.set(link.id, record.target);
    }
    if (upgraded.size) {
      const seen = new Set<string>();
      resolutions = resolutions.map((r) => {
        const target = upgraded.get(r.linkId);
        if (target === undefined) return r;
        seen.add(r.linkId);
        return r.candidateIds || (!r.targetId && !r.library)
          ? { linkId: r.linkId, targetId: target }
          : r;
      });
      for (const [linkId, targetId] of upgraded)
        if (!seen.has(linkId)) resolutions.push({ linkId, targetId });
    }
    return {
      resolutions,
      links,
      missingLinkReason: "analysis-resolution-disagreement",
    };
  },
};

const rust: LanguageModule = {
  id: "rust",
  version: "48",
  extensions: [".rs"],
  contextFiles: [
    "Cargo.toml",
    "Cargo.lock",
    "**/.cargo/config.toml",
    "**/.cargo/config",
  ],
  parse: parseRust,
  async analyze({ projectId, files, contextFiles, signal, toolchain }) {
    if (!files.length) return [];
    // C-43: the opt-in toolchain route's answers, joined to the parsed links.
    const route = toolchain
      ? await rustRoute(toolchain, projectId, files, contextFiles)
      : undefined;
    const context: RustAnalysisInput = {
      projectId,
      files: files.map(({ path, module, result }) => {
        const answers = route?.answers.get(path);
        return {
          path,
          module,
          result: answers
            ? {
                ...result,
                links: result.links.map((link, index) =>
                  answers.has(index)
                    ? {
                        ...link,
                        data: {
                          ...((link.data ?? {}) as Record<string, Json>),
                          tc: answers.get(index)!,
                        },
                      }
                    : link,
                ),
              }
            : result,
        };
      }),
      contextFiles: cargoInputs(contextFiles),
      ...(route
        ? {
            toolchain: {
              rustAnalyzer: route.rustAnalyzer,
              configuration: route.configuration,
            },
          }
        : {}),
    };
    const output = signal
      ? await runRustPhase({ phase: "analyze", context }, signal)
      : rustPhases.analyze(context);
    if (toolchain && output.toolchain)
      toolchain.note({
        status: "merged",
        decided: output.toolchain.counts,
        disagreements: output.toolchain.disagreements,
      });
    return output.files;
  },
  resolve({ projectId, files, contextFiles, symbols, links, signal }) {
    if (!links.length) return [];
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
    return signal
      ? runRustPhase({ phase: "resolve", context: input }, signal)
      : rustPhases.resolve(input);
  },
};
export default rust;
