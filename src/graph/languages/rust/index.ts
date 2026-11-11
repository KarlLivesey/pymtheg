import type { LanguageModule } from "../../types.js";
import { crates } from "./cargo.js";
import type { Json } from "../../types.js";
import { parseRust } from "./parse.js";
import { resolveRust } from "./resolve.js";

const rust: LanguageModule = {
  id: "rust",
  version: "3",
  extensions: [".rs"],
  contextFiles: ["Cargo.toml"],
  parse: parseRust,
  analyze({ files, contextFiles }) {
    const roots = new Map(
      crates(contextFiles, new Set(files.map((f) => f.path))).map((c) => [
        c.root,
        c,
      ]),
    );
    return files
      .filter((f) => f.result.status !== "failed")
      .map((f) => {
        const crate = roots.get(f.path);
        return {
          path: f.path,
          result: {
            ...f.result,
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
  },
  resolve: resolveRust,
};
export default rust;
