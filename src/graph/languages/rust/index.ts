// SPDX-License-Identifier: MIT
import type { ContextFile, GraphFile, LanguageModule } from "../../types.js";
import { crates } from "./cargo.js";
import type { AddedLink, GraphLink, GraphSymbol, Json } from "../../types.js";
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
};

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

export const rustPhases = {
  analyze({
    projectId,
    files: listed,
    contextFiles: contexts,
  }: RustAnalysisInput) {
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
    resolveRust(
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
    return analyzed;
  },
  // Derived links (calls in macro bodies) are returned only when present, so
  // a project without them keeps the plain resolution list.
  resolve(input: Parameters<typeof resolveRust>[0]) {
    const ctx = {
      ...input,
      files: pathOrder(input.files),
      contextFiles: pathOrder(input.contextFiles),
      symbols: symbolOrder(input.symbols),
      links: linkOrder(input.links),
    };
    const links: AddedLink[] = [];
    const resolutions = resolveRust(ctx, undefined, undefined, undefined, (l) =>
      links.push(l),
    );
    return links.length ? { resolutions, links } : resolutions;
  },
} satisfies Pick<LanguageModule, "analyze" | "resolve">;

const rust: LanguageModule = {
  id: "rust",
  version: "40",
  extensions: [".rs"],
  contextFiles: [
    "Cargo.toml",
    "Cargo.lock",
    "**/.cargo/config.toml",
    "**/.cargo/config",
  ],
  parse: parseRust,
  analyze({ projectId, files, contextFiles, signal }) {
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
    return signal
      ? runRustPhase({ phase: "analyze", context }, signal)
      : rustPhases.analyze(context);
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
