import { architectureLimits } from "./limits.js";
import { z } from "zod";
import { hash } from "../shared/identity.js";
import {
  documentSchema,
  planSchema,
  type ArchitectureDocument,
} from "./schema.js";
import {
  architectureHeadings,
  headingIdentifier,
  headingRegistryPath,
  type ArchitectureHeading,
} from "./headings.js";
export { headingRegistryPath };
const storedHeading = z.object({
  id: z.string(),
  line: z.number().int().nonnegative(),
  title: z.string(),
  key: z.string(),
  bodyHash: z.string(),
  hasBody: z.boolean(),
  anchor: z.string().optional(),
});
const registrySchema = z.object({
  schema: z.literal("pymtheg.heading-identities/v1"),
  moveWarnings: z.array(z.string()).optional(),
  moveCandidates: z
    .array(
      z.object({
        fromId: z.string(),
        title: z.string(),
        fromPath: z.string(),
        toPaths: z.array(z.string()),
        linked: z.boolean(),
      }),
    )
    .optional(),
  documents: z.array(
    z.object({
      path: documentSchema.shape.path,
      hash: z.string().nullable(),
      headings: z.array(storedHeading),
      reservedIds: z.array(z.string()).default([]),
    }),
  ),
});
type StoredHeading = z.infer<typeof storedHeading>;
function readRegistry(documents: readonly ArchitectureDocument[]) {
  const doc = documents.find((d) => d.path === headingRegistryPath);
  return doc ? registrySchema.parse(JSON.parse(doc.text)) : null;
}
const legacyId = (path: string, heading: ArchitectureHeading) =>
  "heading:" + path + "#" + (heading.anchor ?? heading.slug);
/** Resolved only against the exact bytes recorded by the identity registry. */
export function identifiedHeadings(documents: readonly ArchitectureDocument[]) {
  const result = new Map<string, (ArchitectureHeading & { id: string })[]>(),
    warnings: string[] = [];
  let registry: z.infer<typeof registrySchema> | null = null,
    invalid = false;
  try {
    registry = readRegistry(documents);
    warnings.push(...(registry?.moveWarnings ?? []));
  } catch {
    invalid = true;
    warnings.push(
      "Heading identity metadata is invalid; legacy links were not rebound.",
    );
  }
  const byPath = new Map(registry?.documents.map((d) => [d.path, d]) ?? []);
  for (const document of documents.filter((d) => /\.(md|rst)$/i.test(d.path))) {
    const headings = architectureHeadings(document.text, document.path),
      stored = byPath.get(document.path),
      contentHash = hash(document.text),
      valid = stored?.hash === contentHash;
    if (headings.length && ((registry && !valid) || invalid))
      warnings.push(
        `${document.path}: heading identity metadata does not match these bytes; review affected links.`,
      );
    const byLine = new Map(
      valid ? stored.headings.map((h) => [h.line, h.id]) : [],
    );
    result.set(
      document.path,
      headings.map((heading) => ({
        ...heading,
        id:
          byLine.get(heading.line) ??
          (!registry && !invalid
            ? legacyId(document.path, heading)
            : "heading:" +
              hash(document.path + "\0" + contentHash + "\0" + heading.line)),
      })),
    );
  }
  return { headings: result, warnings };
}
/** Preserve an old identity only where matching is unambiguous; never use ordinal position. */
export function prepareHeadingIdentities(
  current: readonly ArchitectureDocument[],
  next: readonly ArchitectureDocument[],
): ArchitectureDocument[] {
  const previous = identifiedHeadings(current);
  const oldRegistry = readRegistry(current),
    oldRecords = new Map(oldRegistry?.documents.map((d) => [d.path, d]) ?? []),
    currentByPath = new Map(current.map((d) => [d.path, d])),
    nextPaths = new Set(next.map((d) => d.path));
  // Match content across the whole refresh before matching headings by path.
  // The vacated path may itself receive a new document in this same refresh.
  // Only unique exact content establishes a move; copies remain ambiguous.
  const beforeByHash = new Map<string, string[]>(),
    afterByHash = new Map<string, string[]>();
  for (const [documents, groups] of [
    [current, beforeByHash],
    [next, afterByHash],
  ] as const)
    for (const d of documents)
      if (/\.(md|rst)$/i.test(d.path)) {
        const key = hash(d.text),
          paths = groups.get(key) ?? [];
        paths.push(d.path);
        groups.set(key, paths);
      }
  const movedFrom = new Map<string, string>();
  for (const [key, paths] of beforeByHash) {
    const destinations = afterByHash.get(key);
    if (
      paths.length === 1 &&
      destinations?.length === 1 &&
      paths[0] !== destinations[0]
    )
      movedFrom.set(destinations[0]!, paths[0]!);
  }
  const movedAway = new Set(movedFrom.values());
  const nextHeadings = new Map(
    next
      .filter((d) => /\.(md|rst)$/i.test(d.path))
      .map((d) => [d.path, architectureHeadings(d.text, d.path)]),
  );
  const candidates = new Map<string, Set<string>>();
  const namedCandidates = new Map<string, Set<string>>();
  const headingKey = (h: ArchitectureHeading) => h.title + "\0" + h.bodyHash;
  for (const [path, hs] of nextHeadings)
    if (!currentByPath.has(path))
      for (const h of hs)
        if (h.hasBody) {
          const paths = candidates.get(headingKey(h)) ?? new Set<string>();
          paths.add(path);
          candidates.set(headingKey(h), paths);
          const named = namedCandidates.get(h.title) ?? new Set<string>();
          named.add(path);
          namedCandidates.set(h.title, named);
        }
  const uncertainIds = new Set<string>(),
    moveWarnings: string[] = [];
  const linkedTargets = new Set<string>();
  for (const document of next) {
    if (
      !document.path.endsWith(".json") ||
      !document.text.includes('"pymtheg.plan/v1"')
    )
      continue;
    try {
      const plan = planSchema.safeParse(JSON.parse(document.text));
      if (plan.success)
        for (const item of plan.data.items)
          for (const link of item.links) linkedTargets.add(link.target);
    } catch {
      /* Invalid planning data is reported by the indexer. */
    }
  }
  const moveCandidates = new Map(
    (oldRegistry?.moveCandidates ?? [])
      .filter(
        (candidate) =>
          (!candidate.linked || linkedTargets.has(candidate.fromId)) &&
          candidate.toPaths.some((path) => nextPaths.has(path)),
      )
      .map((candidate) => [
        candidate.fromId,
        {
          ...candidate,
          toPaths: candidate.toPaths.filter((path) => nextPaths.has(path)),
        },
      ]),
  );
  for (const [path, hs] of previous.headings) {
    if (movedAway.has(path)) continue;
    const here = new Set((nextHeadings.get(path) ?? []).map(headingKey));
    for (const h of hs) {
      if (h.anchor || here.has(headingKey(h))) continue;
      // A newly added document with the same heading may be an edited move.
      // This is a review candidate, never authority to transfer the identity.
      const paths =
        candidates.get(headingKey(h)) ??
        (h.hasBody ? namedCandidates.get(h.title) : undefined);
      if (paths?.size) {
        uncertainIds.add(h.id);
        moveCandidates.set(h.id, {
          fromId: h.id,
          title: h.title.slice(0, 240),
          fromPath: path,
          toPaths: [...paths].slice(0, 8),
          linked: linkedTargets.has(h.id),
        });
      }
    }
  }
  const movedIds = new Set(
    [...movedAway].flatMap((path) =>
      (previous.headings.get(path) ?? []).map((h) => h.id),
    ),
  );
  for (const candidate of moveCandidates.values())
    moveWarnings.push(
      `Possible move of “${candidate.title}” from ${candidate.fromPath} to ${candidate.toPaths.join(", ")}. The old link was left unresolved rather than attached to replacement content. Choose the intended target in the plan's links.`,
    );
  const output: z.infer<typeof registrySchema> = {
    schema: "pymtheg.heading-identities/v1",
    documents: [],
    ...(moveWarnings.length ? { moveWarnings } : {}),
    ...(moveCandidates.size
      ? { moveCandidates: [...moveCandidates.values()] }
      : {}),
  };
  for (const document of next.filter((d) => /\.(md|rst)$/i.test(d.path))) {
    const oldPath = movedFrom.get(document.path) ?? document.path;
    const headings = architectureHeadings(document.text, document.path),
      old =
        !movedFrom.has(document.path) && movedAway.has(document.path)
          ? []
          : (previous.headings.get(oldPath) ?? []).filter(
              (h) => !uncertainIds.has(h.id),
            ),
      assigned = new Map<number, string>(),
      used = new Set<number>(),
      reserved = new Set([
        ...(oldRecords.get(document.path)?.reservedIds ?? []),
        ...(previous.headings.get(document.path) ?? []).map((h) => h.id),
        ...(oldRecords.get(oldPath)?.reservedIds ?? []),
        ...old.map((h) => h.id),
      ]),
      contentHash = hash(document.text);
    const oldText = currentByPath.get(oldPath)?.text;
    if (oldText === document.text && old.length === headings.length) {
      old.forEach((heading, i) => assigned.set(i, heading.id));
    } else {
      const match = (
        key: (h: ArchitectureHeading) => string | undefined,
        accepts: (
          before: ArchitectureHeading,
          after: ArchitectureHeading,
        ) => boolean = () => true,
      ) => {
        const left = new Map<string, number[]>(),
          right = new Map<string, number[]>();
        old.forEach((h, i) => {
          if (used.has(i)) return;
          const value = key(h);
          if (value !== undefined) {
            const group = left.get(value) ?? [];
            group.push(i);
            left.set(value, group);
          }
        });
        headings.forEach((h, i) => {
          if (assigned.has(i)) return;
          const value = key(h);
          if (value !== undefined) {
            const group = right.get(value) ?? [];
            group.push(i);
            right.set(value, group);
          }
        });
        for (const [value, group] of left) {
          const candidates = right.get(value);
          if (
            group.length === 1 &&
            candidates?.length === 1 &&
            accepts(old[group[0]!]!, headings[candidates[0]!]!)
          ) {
            assigned.set(candidates[0]!, old[group[0]!]!.id);
            used.add(group[0]!);
          }
        }
      };
      match((h) => (h.anchor ? "anchor:" + h.anchor : undefined));
      match(
        (h) => "add-anchor:" + h.title + "\0" + h.bodyHash,
        (before, after) => !before.anchor && !!after.anchor,
      );
      match((h) =>
        !h.anchor && headingIdentifier(h.key) === h.key
          ? "key:" + h.key.toUpperCase().replace(/\s+/g, "-")
          : undefined,
      );
      match((h) =>
        !h.anchor ? "exact:" + h.title + "\0" + h.bodyHash : undefined,
      );
      // Body equality alone does not establish identity: copied text can describe a different decision.
      match((h) => (!h.anchor ? "title:" + h.title : undefined));
    }
    const usedIds = new Set(assigned.values());
    const entries: StoredHeading[] = headings.map((heading, i) => {
      let id = assigned.get(i);
      if (!id) {
        const proposed = legacyId(document.path, heading);
        id =
          ((!reserved.has(proposed) && proposed.length <= 240) ||
            !!heading.anchor) &&
          (!usedIds.has(proposed) || !!heading.anchor) &&
          !movedIds.has(proposed)
            ? proposed
            : proposed.slice(0, 210) +
              "~" +
              hash(
                document.path +
                  "\0" +
                  contentHash +
                  "\0" +
                  heading.line +
                  "\0" +
                  heading.title,
              ).slice(0, 24);
      }
      usedIds.add(id);
      return {
        id,
        line: heading.line,
        title: heading.title,
        key: heading.key,
        bodyHash: heading.bodyHash,
        hasBody: heading.hasBody,
        ...(heading.anchor ? { anchor: heading.anchor } : {}),
      };
    });
    output.documents.push({
      path: document.path,
      hash: contentHash,
      headings: entries,
      reservedIds: [...new Set([...reserved, ...entries.map((h) => h.id)])],
    });
  }
  for (const [path, record] of oldRecords)
    if (!nextPaths.has(path))
      output.documents.push({
        path,
        hash: null,
        headings: [],
        reservedIds: [
          ...new Set([
            ...record.reservedIds,
            ...record.headings.map((h) => h.id),
          ]),
        ],
      });
  const documents = next.filter((d) => d.path !== headingRegistryPath);
  if (!output.documents.length) return [...documents];
  output.documents.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const text = JSON.stringify(output, null, 2);
  if (Buffer.byteLength(text) > architectureLimits.documentBytes)
    throw Error(
      "Heading identity history exceeds the 16 MiB metadata limit; previous architecture was preserved.",
    );
  return [...documents, { path: headingRegistryPath, text }];
}
