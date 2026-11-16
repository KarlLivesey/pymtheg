// SPDX-License-Identifier: MIT
import type { LanguageModule, LinkDraft, ParseResult } from "../../types.js";

/** A deliberately tiny fixture language. It is not a production language support claim. */
const module: LanguageModule = {
  id: "toy",
  version: "2",
  testOnly: true,
  extensions: [".toy"],
  parse({ path, text }) {
    const result: ParseResult = {
      status: "clean",
      diagnostics: [],
      symbols: [
        {
          key: "file",
          name: path,
          identity: path,
          kind: "file",
          range: { start: 0, end: text.length },
        },
      ],
      links: [],
    };
    let offset = 0;
    let sourceKey: string | null = null;
    for (const line of text.split("\n")) {
      const range = { start: offset, end: offset + line.length };
      const match = /^(def|call|import) ([\w./-]+)$/.exec(line);
      if (match?.[1] === "def") {
        sourceKey = `def:${offset}`;
        result.symbols.push({
          key: sourceKey,
          name: match[2]!,
          identity: match[2]!,
          kind: "function",
          range,
        });
      } else if (match) {
        const link: LinkDraft = {
          sourceKey: match[1] === "import" ? null : sourceKey,
          kind: match[1] === "import" ? "imports" : "calls",
          targetName: match[2]!,
          range,
        };
        result.links.push(link);
      } else if (line.trim() && !line.startsWith("#")) {
        result.status = "partial";
        result.diagnostics.push({
          message: "Expected def, call or import",
          range,
        });
      }
      offset += line.length + 1;
    }
    return result;
  },
  resolve({ files, symbols, links }) {
    const resolutions = [];
    for (const link of links) {
      // Toy calls see their own file and explicitly imported paths. Ambiguity stays unresolved.
      const visible = new Set([
        link.file,
        ...links
          .filter(
            (other) => other.file === link.file && other.kind === "imports",
          )
          .map((other) => other.targetName),
      ]);
      const candidates = symbols.filter(
        (symbol) =>
          symbol.module === "toy" &&
          files.some(
            (file) =>
              file.path === symbol.file && file.result.status !== "failed",
          ) &&
          (link.kind === "imports"
            ? symbol.file === link.targetName && symbol.kind === "file"
            : visible.has(symbol.file) &&
              symbol.kind === "function" &&
              symbol.name === link.targetName),
      );
      if (candidates.length === 1)
        resolutions.push({ linkId: link.id, targetId: candidates[0]!.id });
    }
    return resolutions;
  },
};
export default module;
