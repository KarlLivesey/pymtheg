// SPDX-License-Identifier: MIT
import type {
  LanguageModule,
  LibraryTarget,
  LinkDraft,
  LinkResolution,
  ParseResult,
} from "../../types.js";

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
      // `use ECOSYSTEM:UNIT` imports a library unit outside the project;
      // a trailing ` *` is a glob import of every name in it.
      const use = /^use ([a-z][a-z0-9-]*):([@\w./-]+)( \*)?$/.exec(line);
      if (use) {
        result.links.push({
          sourceKey: null,
          kind: "imports",
          targetName: use[2]!,
          range,
          data: { library: use[1]!, ...(use[3] ? { glob: true } : {}) },
        });
      } else if (match?.[1] === "def") {
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
    const resolutions: LinkResolution[] = [];
    for (const link of links) {
      const uses = links.filter(
        (other) =>
          other.file === link.file &&
          (other.data as { library?: string } | undefined)?.library,
      );
      const used = (other: (typeof links)[number]) =>
        other.data as { library: string; glob?: true };
      if ((link.data as { library?: string } | undefined)?.library) {
        // The import names the unit: a level-1 library target.
        resolutions.push({
          linkId: link.id,
          library: {
            ecosystem: used(link).library,
            unit: link.targetName,
            evidence: "import-path",
          },
        });
        continue;
      }
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
      if (link.kind !== "calls") {
        if (candidates.length === 1)
          resolutions.push({ linkId: link.id, targetId: candidates[0]!.id });
        continue;
      }
      // `call UNIT.NAME` selects NAME from a unit this file uses, by the
      // unit's last path segment: the import binding proves unit and symbol.
      const dot = link.targetName.indexOf(".");
      const bound =
        dot > 0
          ? uses.filter(
              (other) =>
                !used(other).glob &&
                other.targetName.split("/").at(-1) ===
                  link.targetName.slice(0, dot),
            )
          : [];
      // A glob import makes a plain name possible, never proven.
      const globbed: LibraryTarget[] =
        dot < 0
          ? uses
              .filter((other) => used(other).glob)
              .map((other) => ({
                ecosystem: used(other).library,
                unit: other.targetName,
                symbol: link.targetName,
                evidence: "glob-import",
              }))
          : [];
      if (!candidates.length && bound.length === 1)
        resolutions.push({
          linkId: link.id,
          library: {
            ecosystem: used(bound[0]!).library,
            unit: bound[0]!.targetName,
            symbol: link.targetName.slice(dot + 1),
            evidence: "import-binding",
          },
        });
      else if (globbed.length && candidates.length + globbed.length >= 2)
        resolutions.push({
          linkId: link.id,
          candidateIds: candidates.map((symbol) => symbol.id),
          libraries: globbed,
        });
      else if (candidates.length === 1 && !globbed.length)
        resolutions.push({ linkId: link.id, targetId: candidates[0]!.id });
    }
    return resolutions;
  },
};
export default module;
