// SPDX-License-Identifier: MIT
import type { ContextFile, GraphFile, LanguageModule } from "../../types.js";
import { crates } from "./cargo.js";
import type { AddedLink, Json } from "../../types.js";
import { parseRust } from "./parse.js";
import { fileFacts } from "../../identity.js";
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

export const rustPhases = {
  analyze({ projectId, files, contextFiles }: RustAnalysisInput) {
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
  resolve(ctx: Parameters<typeof resolveRust>[0]) {
    const links: AddedLink[] = [];
    const resolutions = resolveRust(ctx, undefined, undefined, undefined, (l) =>
      links.push(l),
    );
    return links.length ? { resolutions, links } : resolutions;
  },
} satisfies Pick<LanguageModule, "analyze" | "resolve">;

const rust: LanguageModule = {
  id: "rust",
  version: "39",
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
