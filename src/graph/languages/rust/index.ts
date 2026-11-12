import type { LanguageModule } from "../../types.js";
import { crates } from "./cargo.js";
import type { Json } from "../../types.js";
import { parseRust } from "./parse.js";
import { fileFacts } from "../../identity.js";
import { resolveRust } from "./resolve.js";

const TARGET_HINT_LIMIT = 16;

const rust: LanguageModule = {
  id: "rust",
  version: "9",
  extensions: [".rs"],
  contextFiles: ["Cargo.toml"],
  parse: parseRust,
  analyze({ projectId, files, contextFiles }) {
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
        return {
          path: f.path,
          result: {
            ...f.result,
            links: f.result.links.map((l) => {
              const { targets, targetCount, uncertainty, cause, ...rest } =
                (l.data ?? {}) as Record<string, Json>;
              return { ...l, data: rest };
            }),
            symbols: f.result.symbols.map((s) =>
              s.key !== "file"
                ? s
                : {
                    ...s,
                    data: {
                      ...(s.data as Record<string, Json>),
                      unitKind: crate ? "crate" : "module",
                      crateName: crate?.name ?? "",
                      targetKind: crate?.kind ?? "",
                      manifest: crate?.manifest ?? "",
                      workspace: crate?.workspace ?? null,
                    },
                  },
            ),
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
      }
    >();
    resolveRust(
      {
        projectId,
        files: updated,
        contextFiles,
        symbols: facts.flatMap((f) => f.symbols),
        links: facts.flatMap((f) => f.links),
      },
      (l, targets, reason, files) =>
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
        }),
    );
    for (let i = 0; i < updated.length; i++) {
      const f = updated[i]!,
        a = byPath.get(f.path);
      if (a)
        a.result.links = a.result.links.map((l, j) => {
          const u = unknown.get(facts[i]!.links[j]!.id);
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
                },
              }
            : l;
        });
    }
    return analyzed;
  },
  resolve: resolveRust,
};
export default rust;
