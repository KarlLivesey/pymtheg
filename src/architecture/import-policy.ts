import { compareText } from "../shared/order.js";
import { architectureLimits } from "./limits.js";
import type { ArchitectureDocument } from "./schema.js";
import {
  projectDocumentationPath,
  documentationDirectory,
} from "../shared/document-selection.js";
const generated = new Set(["node_modules", "target", "dist"]);
export function excludedDirectory(name: string) {
  return name.startsWith(".") || generated.has(name);
}
export function textDocument(path: string) {
  return (
    !path.split("/").at(-1)!.startsWith(".") &&
    /\.(md|json|txt|dot|svg|html|pym)$/i.test(path)
  );
}
/** Private/runtime paths vary by transport and never belong to imported content. */
function sourceExclusions(paths: readonly string[]) {
  return [...new Set(paths)]
    .filter(
      (path) =>
        !path.split("/").some((part) => part.startsWith(".")) &&
        !path.endsWith(" (generated/private directory)"),
    )
    .sort(compareText);
}
export function folderInventory(
  entries: readonly { path: string; bytes: number }[],
  selection: "all-text" | "project-documents" = "all-text",
) {
  if (entries.length > 100000)
    throw Error(
      "The folder contains over 100,000 file entries. Use the CLI folder import to skip generated directories before listing their contents.",
    );
  const included: string[] = [],
    excluded: string[] = [];
  let bytes = 0;
  for (const entry of [...entries].sort((a, b) =>
    compareText(a.path, b.path),
  )) {
    const parts = entry.path.split("/"),
      blocked = parts.slice(0, -1).findIndex(excludedDirectory);
    if (blocked >= 0) {
      excluded.push(
        parts.slice(0, blocked + 1).join("/") +
          " (generated/private directory)",
      );
      continue;
    }
    if (
      selection === "project-documents" &&
      parts.length > 1 &&
      !documentationDirectory(entry.path)
    ) {
      excluded.push(parts[0] + " (outside selected documentation scope)");
      continue;
    }
    if (
      !textDocument(entry.path) ||
      (selection === "project-documents" &&
        !projectDocumentationPath(entry.path))
    ) {
      excluded.push(entry.path + " (outside text-document import formats)");
      continue;
    }
    if (entry.bytes > architectureLimits.documentBytes)
      throw Error(entry.path + " exceeds the 16 MiB document limit");
    bytes += entry.bytes;
    included.push(entry.path);
  }
  if (bytes > architectureLimits.snapshotBytes)
    throw Error("Architecture document import exceeds 64 MiB");
  if (included.length >= architectureLimits.maxDocuments)
    throw Error(
      "Select at most 4,095 documents; one additional document records the import inventory.",
    );
  return { included, excluded: [...new Set(excluded)], bytes };
}
export function withImportInventory(
  documents: ArchitectureDocument[],
  source: string,
  excluded: readonly string[],
  sourceId: string = source,
) {
  if (documents.length >= architectureLimits.maxDocuments)
    throw Error("Select at most 4,095 documents plus the import inventory.");
  const used = new Set(documents.map((d) => d.path));
  const base = `.pymtheg-imports/${encodeURIComponent(sourceId)}`;
  if (base.length + 5 > 4096)
    throw Error("Source identifier is too long for an inventory path");
  let path = base + ".json",
    suffix = 2;
  while (used.has(path)) path = `${base}-${suffix++}.json`;
  return [
    ...documents,
    {
      path,
      text: JSON.stringify(
        {
          schema: "pymtheg.import/v1",
          source,
          included: documents.map((d) => d.path).sort(compareText),
          // Folder pickers may omit hidden paths. Runtime/generated state is not
          // documentation drift; the preview still exposes its full discovery list.
          excluded: sourceExclusions(excluded),
        },
        null,
        2,
      ),
    },
  ];
}

/** A browser folder name cannot relocate a previously recorded absolute source. */
export function preserveInventoryLocation(
  current: readonly ArchitectureDocument[],
  incoming: ArchitectureDocument[],
  sourceId: string,
) {
  const path = `.pymtheg-imports/${encodeURIComponent(sourceId)}.json`;
  const prior = current.find((d) => d.path === path),
    next = incoming.find((d) => d.path === path);
  if (!prior || !next) return incoming;
  try {
    const old: unknown = JSON.parse(prior.text),
      fresh: unknown = JSON.parse(next.text);
    const record = (v: unknown): v is Record<string, unknown> =>
      !!v && typeof v === "object" && !Array.isArray(v);
    if (
      !record(old) ||
      !record(fresh) ||
      old.schema !== "pymtheg.import/v1" ||
      fresh.schema !== old.schema ||
      typeof old.source !== "string" ||
      typeof fresh.source !== "string"
    )
      return incoming;
    const preserveSource =
      !fresh.source.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(fresh.source);
    const strings = (value: unknown): value is string[] =>
      Array.isArray(value) && value.every((entry) => typeof entry === "string");
    const normalizedFresh = {
      ...fresh,
      source: preserveSource ? old.source : fresh.source,
      ...(strings(fresh.excluded)
        ? { excluded: sourceExclusions(fresh.excluded) }
        : {}),
    };
    const normalizedOld = {
      ...old,
      ...(strings(old.excluded)
        ? { excluded: sourceExclusions(old.excluded) }
        : {}),
    };
    const text =
      JSON.stringify(normalizedFresh) === JSON.stringify(normalizedOld)
        ? prior.text
        : JSON.stringify(normalizedFresh, null, 2);
    return incoming.map((d) => (d.path === path ? { ...d, text } : d));
  } catch {
    /* Invalid inventory stays visible to the ordinary importer. */
  }
  return incoming;
}
