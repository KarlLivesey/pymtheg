import { headingRegistryPath } from "./headings.js";
import { isObservationPart } from "./limits.js";
import { z } from "zod";
import { hash } from "../shared/identity.js";
import {
  importResolutionSchema,
  type importConflictSchema,
  type ArchitectureDocument,
} from "./schema.js";
export const sourceRegistryPath = ".pymtheg-sources.json";
export const nativePlanPath = "architecture/plan.json";
const sourceSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    kind: z.enum(["folder", "upload", "bundle"]),
    selection: z.enum(["project-documents", "all-text"]).optional(),
    documents: z.array(
      z.object({
        path: z.string(),
        baselineHash: z.string(),
        sourcePath: z.string().optional(),
      }),
    ),
  })
  .passthrough();
const registrySchema = z
  .object({
    schema: z.literal("pymtheg.sources/v1"),
    sources: z.array(sourceSchema),
    nativeDocuments: z.array(z.string()),
    divergedDocuments: z
      .array(
        z.object({
          path: z.string(),
          sourceId: z.string(),
          sourcePath: z.string(),
          baselineHash: z.string(),
          upstreamPath: z.string().optional(),
        }),
      )
      .default([]),
  })
  .passthrough();
export type ImportSource = Pick<
  z.infer<typeof sourceSchema>,
  "id" | "label" | "kind" | "selection"
>;
export class ArchitectureConflict extends Error {
  readonly status = 409;
}
export function sourceRegistry(documents: readonly ArchitectureDocument[]) {
  const found = documents.find((d) => d.path === sourceRegistryPath);
  if (!found)
    return {
      schema: "pymtheg.sources/v1" as const,
      sources: [] as z.infer<typeof sourceSchema>[],
      divergedDocuments: [] as z.infer<
        typeof registrySchema
      >["divergedDocuments"],
      nativeDocuments: documents.some((d) => d.path === nativePlanPath)
        ? [nativePlanPath]
        : [],
    };
  try {
    return registrySchema.parse(JSON.parse(found.text));
  } catch {
    throw new ArchitectureConflict(
      "The architecture source registry is invalid. Restore its earlier version before importing.",
    );
  }
}
function registryDocument(
  registry: z.infer<typeof registrySchema>,
): ArchitectureDocument {
  return {
    path: sourceRegistryPath,
    text: JSON.stringify(
      {
        ...registrySchema.parse(registry),
        sources: [...registry.sources].sort((a, b) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        ),
        nativeDocuments: [...new Set(registry.nativeDocuments)].sort(),
      },
      null,
      2,
    ),
  };
}
export function withNativeDocuments(
  documents: ArchitectureDocument[],
  paths: readonly string[],
) {
  const registry = sourceRegistry(documents);
  const present = new Set(documents.map((d) => d.path));
  registry.nativeDocuments = [
    ...new Set([...registry.nativeDocuments, ...paths]),
  ].filter((path) => !isObservationPart(path) || present.has(path));
  return [
    ...documents.filter((d) => d.path !== sourceRegistryPath),
    registryDocument(registry),
  ];
}
export function mergeArchitectureImport(
  current: readonly ArchitectureDocument[],
  incoming: readonly ArchitectureDocument[],
  source: ImportSource,
  mode: "add" | "refresh" = "add",
  options: {
    collectConflicts?: boolean;
    resolutions?: z.infer<typeof importResolutionSchema>[];
  } = {},
) {
  const registry = sourceRegistry(current),
    native = new Set([
      ...registry.nativeDocuments,
      nativePlanPath,
      sourceRegistryPath,
      headingRegistryPath,
    ]),
    byPath = new Map(current.map((d) => [d.path, d]));
  const previous = registry.sources.find((s) => s.id === source.id),
    old = new Map(
      previous?.documents.map((d) => [d.sourcePath ?? d.path, d]) ?? [],
    ),
    owner = new Map<string, Set<string>>();
  // Preserve the last tracked location even if this refresh removes it.
  for (const fork of registry.divergedDocuments) {
    const tracked =
      fork.sourceId === source.id ? old.get(fork.sourcePath) : undefined;
    if (tracked && tracked.path !== fork.path) fork.upstreamPath = tracked.path;
  }
  for (const group of registry.sources)
    for (const document of group.documents) {
      const owners = owner.get(document.path) ?? new Set<string>();
      owners.add(group.id);
      owner.set(document.path, owners);
    }
  const entries: ArchitectureDocument[] = [],
    archivedMetadata: string[] = [];
  for (const document of incoming) {
    if (
      document.path === sourceRegistryPath ||
      document.path === headingRegistryPath
    ) {
      if (byPath.get(document.path)?.text === document.text) continue;
      const path = `.pymtheg-imported-${document.path === sourceRegistryPath ? "sources" : "heading-identities"}-${hash(document.text).slice(0, 16)}.json`;
      entries.push({ ...document, path });
      archivedMetadata.push(path);
    } else entries.push(document);
  }
  // Folder transports disagree about dotfiles. They are outside the common
  // discovery policy; retain previously imported hidden documents rather than
  // treating an invisible file as a deletion. Explicit document edits still work.
  if (mode === "refresh" && source.kind === "folder") {
    const present = new Set(entries.map((document) => document.path));
    for (const [sourcePath, prior] of old) {
      if (
        !sourcePath.split("/").some((part) => part.startsWith(".")) ||
        sourcePath.startsWith(".pymtheg")
      )
        continue;
      const retained = byPath.get(prior.path);
      if (retained && !present.has(sourcePath))
        entries.push({ path: sourcePath, text: retained.text });
    }
  }
  const conflicts: z.infer<typeof importConflictSchema>[] = [],
    resolutions = new Map<string, z.infer<typeof importResolutionSchema>>();
  for (const raw of options.resolutions ?? []) {
    const resolution = importResolutionSchema.parse(raw);
    if (resolutions.has(resolution.path))
      throw new ArchitectureConflict(
        "Duplicate conflict choice for " + resolution.path,
      );
    resolutions.set(resolution.path, resolution);
  }
  const conflict = (
    path: string,
    reason: string,
    local: string | null,
    incoming: string | null,
    protectLocal = false,
  ) => {
    const detail = {
      path,
      reason,
      local,
      incoming,
      localHash: local === null ? null : hash(local),
      incomingHash: incoming === null ? null : hash(incoming),
      choices: (protectLocal
        ? ["keep-local", "keep-both"]
        : incoming === null
          ? ["keep-local", "take-incoming"]
          : ["keep-local", "take-incoming", "keep-both"]) as z.infer<
        typeof importConflictSchema
      >["choices"],
    };
    const resolution = resolutions.get(path);
    if (resolution) {
      if (
        resolution.localHash !== detail.localHash ||
        resolution.incomingHash !== detail.incomingHash
      )
        throw new ArchitectureConflict(
          path +
            " changed since conflict review. Preview and review its current versions again.",
        );
      if (!detail.choices.includes(resolution.choice))
        throw new ArchitectureConflict(
          "This conflict choice cannot replace protected native/shared work: " +
            path,
        );
      resolutions.delete(path);
      return resolution.choice;
    }
    if (!options.collectConflicts) throw new ArchitectureConflict(reason);
    conflicts.push(detail);
    return "pending";
  };
  const preserveBoth = (document: ArchitectureDocument, sourcePath: string) => {
    const prefix = `imports/${hash(source.id).slice(0, 12)}/`;
    let path = prefix + document.path,
      suffix = 2;
    while (byPath.has(path) && byPath.get(path)!.text !== document.text)
      path = prefix + `${suffix++}-` + document.path;
    if (!byPath.has(path)) added.push(path);
    byPath.set(path, { ...document, path });
    owned.set(sourcePath, {
      path,
      sourcePath,
      baselineHash: hash(document.text),
    });
  };
  const incomingPaths = new Set<string>();
  for (const d of entries) {
    if (incomingPaths.has(d.path))
      throw new ArchitectureConflict(
        "Duplicate imported document path " + d.path,
      );
    incomingPaths.add(d.path);
  }
  const added: string[] = [],
    changed: string[] = [],
    removed: string[] = [],
    keptLocal: string[] = [],
    keptShared: string[] = [],
    adopted: string[] = [],
    owned = new Map(mode === "refresh" ? [] : old);
  const rememberDivergence = (
    path: string,
    sourcePath: string,
    baselineHash: string,
  ) => {
    registry.divergedDocuments = [
      ...registry.divergedDocuments.filter(
        (d) => !(d.path === path && d.sourceId === source.id),
      ),
      {
        path,
        sourceId: source.id,
        sourcePath,
        baselineHash,
        ...(owned.get(sourcePath)?.path !== path && owned.get(sourcePath)?.path
          ? { upstreamPath: owned.get(sourcePath)!.path }
          : {}),
      },
    ];
  };
  const track = (sourcePath: string, path: string, baselineHash: string) =>
    owned.set(sourcePath, {
      path,
      baselineHash,
      ...(path !== sourcePath ? { sourcePath } : {}),
    });
  if (mode === "refresh")
    for (const [sourcePath, entry] of old) {
      const { path, baselineHash } = entry;
      if (incomingPaths.has(sourcePath) || native.has(path)) continue;
      if ([...(owner.get(path) ?? [])].some((id) => id !== source.id)) {
        keptShared.push(path);
        continue;
      }
      const existing = byPath.get(path);
      if (existing && hash(existing.text) !== baselineHash) {
        const choice = conflict(
          path,
          `${path} was edited locally and removed from the source.`,
          existing.text,
          null,
        );
        if (choice !== "take-incoming") {
          keptLocal.push(path);
          rememberDivergence(path, sourcePath, baselineHash);
          continue;
        }
      }
      if (existing) {
        byPath.delete(path);
        removed.push(path);
      }
    }
  for (const incomingDocument of entries) {
    const sourcePath = incomingDocument.path;
    const d = {
      ...incomingDocument,
      path: old.get(sourcePath)?.path ?? sourcePath,
    };
    const before = byPath.get(d.path),
      nextHash = hash(d.text),
      currentHash = before ? hash(before.text) : null;
    if (before && currentHash === nextHash) {
      if (!native.has(d.path)) track(sourcePath, d.path, nextHash);
      continue;
    }
    if (before) {
      const baseline = old.get(sourcePath)?.baselineHash,
        shared = [...(owner.get(d.path) ?? [])].some((id) => id !== source.id);
      let reason = "";
      if (native.has(d.path))
        reason = `${d.path} is native planning work. Import cannot replace it.`;
      else if (registry.divergedDocuments.some((fork) => fork.path === d.path))
        reason = `${d.path} is a local fork of an imported document. Review before replacing it.`;
      else if (mode === "add")
        reason = `${d.path} already exists with different content. Review both versions.`;
      else if (baseline && currentHash !== baseline) {
        if (nextHash === baseline) {
          keptLocal.push(d.path);
          track(sourcePath, d.path, nextHash);
          continue;
        }
        reason = `${d.path} changed both locally and in the source.`;
      } else if (shared)
        reason = `${d.path} is also supplied by another source.`;
      if (reason) {
        const choice = conflict(
          d.path,
          reason,
          before.text,
          d.text,
          native.has(d.path) || shared,
        );
        if (choice === "pending") continue;
        if (choice === "keep-both") {
          preserveBoth(d, sourcePath);
          rememberDivergence(d.path, sourcePath, baseline ?? currentHash!);
          keptLocal.push(d.path);
          continue;
        }
        if (choice === "keep-local") {
          keptLocal.push(d.path);
          if (!native.has(d.path)) track(sourcePath, d.path, nextHash);
          continue;
        }
      }
      if (!owner.has(d.path)) adopted.push(d.path);
      changed.push(d.path);
    } else added.push(d.path);
    byPath.set(d.path, d);
    track(sourcePath, d.path, nextHash);
  }
  if (resolutions.size)
    throw new ArchitectureConflict(
      "Conflict choices no longer match this import. Preview again.",
    );
  if (owned.size || previous) {
    const next = {
      ...previous,
      ...source,
      documents: [...owned]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, entry]) => entry),
    };
    registry.sources = [
      ...registry.sources.filter((s) => s.id !== source.id),
      next,
    ];
  }
  registry.nativeDocuments = [...native].filter(
    (path) =>
      path !== sourceRegistryPath &&
      path !== headingRegistryPath &&
      byPath.has(path),
  );
  byPath.set(sourceRegistryPath, registryDocument(registry));
  return {
    conflicts,
    documents: [...byPath.values()],
    summary: {
      added,
      changed,
      removed,
      keptLocal,
      keptShared,
      adopted,
      archivedMetadata,
      keptNative: [...native].filter(
        (path) =>
          path !== sourceRegistryPath &&
          path !== headingRegistryPath &&
          byPath.has(path),
      ),
      sources: registry.sources.map(({ id, label, kind }) => ({
        id,
        label,
        kind,
      })),
    },
  };
}
