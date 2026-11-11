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
    /\.(md|rst|json|txt|dot|svg|html|pym)$/i.test(path)
  );
}
/** Patterns are relative POSIX paths: literal files/directories, *, ** and ?. */
export interface DocumentSelection {
  include?: readonly string[];
  exclude?: readonly string[];
  file?: (path: string) => boolean;
  directory?: (path: string) => boolean;
  signal?: AbortSignal;
}
export type SkipReason =
  | "unsupported-type"
  | "excluded"
  | "too-large"
  | "outside-selection"
  | "generated-private"
  | "symbolic-link"
  | "special-file";
export interface SkippedDocuments {
  total: number;
  pathLimit: number;
  counts: Partial<Record<SkipReason, number>>;
  paths: {
    path: string;
    reason: SkipReason;
    kind: "file" | "directory" | "entry";
  }[];
  truncated: number;
}
/** Directory skips count the directory itself; descendants are not inspected. */
export function skippedDocuments(): SkippedDocuments {
  return { total: 0, pathLimit: 100, counts: {}, paths: [], truncated: 0 };
}
export function recordSkipped(
  summary: SkippedDocuments,
  path: string,
  reason: SkipReason,
  kind: "file" | "directory" | "entry" = "file",
) {
  summary.total++;
  summary.counts[reason] = (summary.counts[reason] ?? 0) + 1;
  if (summary.paths.length < summary.pathLimit)
    summary.paths.push({ path, reason, kind });
  else summary.truncated++;
}
function matches(path: string, pattern: string): boolean {
  const normalized = pattern.replace(/^\.\//, "").replace(/\/$/, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  )
    throw Error("Import patterns must be nonempty relative paths without '..'");
  let expression = "";
  for (let i = 0; i < normalized.length; i++) {
    const character = normalized[i]!;
    if (character === "*" && normalized[i + 1] === "*") {
      i++;
      if (normalized[i + 1] === "/") {
        expression += "(?:.*/)?";
        i++;
      } else expression += ".*";
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^(?:" + expression + ")(?:/.*)?$").test(path);
}
export function documentSkipReason(
  path: string,
  options: DocumentSelection = {},
  defaultSelected = true,
): SkipReason | undefined {
  // Validate every pattern even when an earlier one matches.
  const excluded = options.exclude
    ?.map((pattern) => matches(path, pattern))
    .some(Boolean);
  const included = options.include
    ?.map((pattern) => matches(path, pattern))
    .some(Boolean);
  if (excluded) return "excluded";
  if (!textDocument(path)) return "unsupported-type";
  if (
    options.include !== undefined
      ? !included
      : !defaultSelected || options.file?.(path) === false
  )
    return "outside-selection";
  return undefined;
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
  options: DocumentSelection = {},
) {
  if (entries.length > 100000)
    throw Error(
      "The folder contains over 100,000 file entries. Use the CLI folder import to skip generated directories before listing their contents.",
    );
  const included: string[] = [],
    excluded: string[] = [];
  const skipped = skippedDocuments();
  let bytes = 0;
  for (const entry of [...entries].sort((a, b) =>
    compareText(a.path, b.path),
  )) {
    const parts = entry.path.split("/"),
      blocked = parts.slice(0, -1).findIndex(excludedDirectory);
    if (blocked >= 0) {
      recordSkipped(skipped, entry.path, "generated-private");
      excluded.push(
        parts.slice(0, blocked + 1).join("/") +
          " (generated/private directory)",
      );
      continue;
    }
    const reason = documentSkipReason(
      entry.path,
      options,
      selection !== "project-documents" || projectDocumentationPath(entry.path),
    );
    if (reason) {
      recordSkipped(skipped, entry.path, reason);
      // The saved ledger predates detailed reasons: preserve its scope-first
      // directory collapse and format label independently of the new report.
      const outsideFolder =
        options.include === undefined &&
        selection === "project-documents" &&
        parts.length > 1 &&
        !documentationDirectory(entry.path);
      excluded.push(
        outsideFolder
          ? parts[0] + " (outside selected documentation scope)"
          : entry.path + " (outside text-document import formats)",
      );
      continue;
    }
    if (entry.bytes > architectureLimits.documentBytes) {
      recordSkipped(skipped, entry.path, "too-large");
      // Upload preflight remains fail-closed; callers can render its discovery summary.
      throw Object.assign(
        Error(entry.path + " exceeds the 16 MiB document limit"),
        { skipped },
      );
    }
    bytes += entry.bytes;
    included.push(entry.path);
  }
  if (bytes > architectureLimits.snapshotBytes)
    throw Error("Architecture document import exceeds 64 MiB");
  if (included.length >= architectureLimits.maxDocuments)
    throw Error(
      "Select at most 4,095 documents; one additional document records the import inventory.",
    );
  return { included, excluded: [...new Set(excluded)], bytes, skipped };
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
