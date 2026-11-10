import { errorMessage } from "../shared/error-message.js";
import { withdrawalEvents } from "./acknowledgements.js";
import { documentSetHash } from "./manifest.js";
export { documentSetHash } from "./manifest.js";
import { compareText } from "../shared/order.js";
import {
  architectureLimits as limits,
  maxStoredDocuments,
  documentCountsWithinLimits,
} from "./limits.js";
import { z } from "zod";
import { documentSchema, revisionSchema } from "./schema.js";
import { architectureDraftSchema } from "./draft.js";
import { hash } from "../shared/identity.js";
import {
  decodeObservation,
  observationPath,
} from "../implementation/storage.js";
import { isObservationPart } from "./limits.js";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const documents = z
  .array(z.object({ path: documentSchema.shape.path, hash: digest }).strict())
  .min(1)
  .max(maxStoredDocuments)
  .refine(documentCountsWithinLimits);
const blobs = z.array(
  z
    .object({ hash: digest, text: z.string().max(limits.documentBytes) })
    .strict(),
);
export const legacyHistorySchema = z
  .object({
    schema: z.literal("pymtheg.architecture-history/v1"),
    active: digest,
    revisions: z
      .array(revisionSchema.extend({ documents }))
      .min(1)
      .max(limits.maxRevisions),
    blobs,
    draft: architectureDraftSchema.nullable(),
  })
  .strict();
const historyV2Schema = z
  .object({
    schema: z.literal("pymtheg.architecture-history/v2"),
    active: digest,
    snapshots: z
      .array(z.object({ id: digest, documents }).strict())
      .min(1)
      .max(limits.maxRevisions),
    revisions: z
      .array(
        revisionSchema
          .omit({ snapshotHash: true })
          .extend({ id: digest, snapshot: digest }),
      )
      .min(1)
      .max(limits.maxRevisions),
    blobs,
    draft: architectureDraftSchema.nullable(),
  })
  .strict();
/** Snapshot IDs retain old lineage; contentHash binds canonical document content. */
export const historySchema = historyV2Schema.extend({
  schema: z.literal("pymtheg.architecture-history/v3"),
  snapshots: z
    .array(z.object({ id: digest, contentHash: digest, documents }).strict())
    .min(1)
    .max(limits.maxRevisions),
});
export type ArchitectureHistory = z.infer<typeof historySchema>;
/** Normalize old archives before validating content. Checkpoints and content identity are distinct. */
export function validateHistory(raw: unknown): ArchitectureHistory {
  const source = raw as { schema?: unknown } | null;
  const legacy =
    source?.schema === "pymtheg.architecture-history/v1"
      ? (() => {
          const old = legacyHistorySchema.parse(raw);
          return historyV2Schema.parse({
            schema: "pymtheg.architecture-history/v2",
            active: old.active,
            snapshots: old.revisions.map(({ id, documents }) => ({
              id,
              documents,
            })),
            revisions: old.revisions.map(
              ({ documents, snapshotHash, ...revision }) => ({
                ...revision,
                snapshot: revision.id,
              }),
            ),
            blobs: old.blobs,
            draft: old.draft,
          });
        })()
      : source?.schema === "pymtheg.architecture-history/v2"
        ? historyV2Schema.parse(raw)
        : null;
  if (legacy)
    for (const snapshot of legacy.snapshots) {
      if (
        hash(
          JSON.stringify(snapshot.documents.map((d) => [d.path, d.hash])),
        ) !== snapshot.id
      )
        throw Error("History snapshot does not match its document hashes");
    }
  const archive = legacy
    ? historySchema.parse({
        ...legacy,
        schema: "pymtheg.architecture-history/v3",
        snapshots: legacy.snapshots.map((snapshot) => ({
          ...snapshot,
          contentHash: documentSetHash(snapshot.documents),
        })),
      })
    : historySchema.parse(raw);
  if (Buffer.byteLength(JSON.stringify(raw)) > limits.archiveBytes)
    throw Error(
      "Portable history exceeds the 64 MiB archive limit. Existing history was not changed.",
    );
  const sizes = new Map<string, number>();
  const content = new Map<string, string>();
  for (const blob of archive.blobs) {
    const bytes = Buffer.byteLength(blob.text);
    if (bytes > limits.documentBytes)
      throw Error("History document exceeds the 16 MiB document byte limit");
    if (sizes.has(blob.hash) || hash(blob.text) !== blob.hash)
      throw Error("Invalid or duplicate history content hash");
    sizes.set(blob.hash, bytes);
    content.set(blob.hash, blob.text);
  }
  const snapshots = new Set<string>();
  const observations = new Set<string>();
  for (const snapshot of archive.snapshots) {
    if (snapshots.has(snapshot.id)) throw Error("Duplicate history snapshot");
    snapshots.add(snapshot.id);
    snapshot.documents.sort((a, b) => compareText(a.path, b.path));
    const paths = new Set<string>();
    let bytes = 0;
    for (const document of snapshot.documents) {
      if (paths.has(document.path) || !sizes.has(document.hash))
        throw Error("Missing or duplicate history document");
      paths.add(document.path);
      bytes += sizes.get(document.hash)!;
      if (bytes > limits.snapshotBytes)
        throw Error(
          "History revision exceeds the 64 MiB logical snapshot byte limit",
        );
    }
    if (documentSetHash(snapshot.documents) !== snapshot.contentHash)
      throw Error("History snapshot does not match its document hashes");
    if (snapshot.documents.some((d) => d.path === observationPath)) {
      const code = snapshot.documents.filter(
        (d) => d.path === observationPath || isObservationPart(d.path),
      );
      const key = documentSetHash(code);
      if (!observations.has(key)) {
        try {
          decodeObservation(
            code.map((d) => ({ path: d.path, text: content.get(d.hash)! })),
          );
        } catch (error) {
          throw Error(
            "History contains an invalid code version. Nothing was imported. " +
              errorMessage(error),
          );
        }
        observations.add(key);
      }
    }
  }
  const revisions = new Set<string>();
  for (const revision of archive.revisions) {
    if (revisions.has(revision.id)) throw Error("Duplicate history revision");
    revisions.add(revision.id);
    if (!snapshots.has(revision.snapshot))
      throw Error("History checkpoint refers to a missing snapshot");
  }
  const reviewPairs = new Set<string>();
  for (const revision of archive.revisions)
    for (const against of revision.reviewedAgainst ?? []) {
      if (!revisions.has(against))
        throw Error("Branch review refers to a missing revision");
      reviewPairs.add(revision.id + ":" + against);
    }
  const acknowledgementIds = new Set<string>();
  let withdrawalCount = 0;
  for (const revision of archive.revisions)
    for (const record of revision.reviewRecords ?? []) {
      if (!revisions.has(record.against))
        throw Error("Branch acknowledgement refers to a missing revision");
      if (acknowledgementIds.has(record.id))
        throw Error("Duplicate branch acknowledgement identity");
      acknowledgementIds.add(record.id);
      withdrawalCount += withdrawalEvents(record).length;
    }
  if (withdrawalCount > 10000)
    throw Error("Branch withdrawal limit (10000) exceeded");
  if (acknowledgementIds.size > 10000)
    throw Error("Branch review record limit (10000) exceeded");
  if (reviewPairs.size > 10000)
    throw Error("Branch review limit (10000) exceeded");
  validateParentGraph(
    new Map(archive.revisions.map((r) => [r.id, r.parentId])),
  );
  if (!revisions.has(archive.active))
    throw Error("History active revision is missing");
  if (archive.draft?.baseRevision && !revisions.has(archive.draft.baseRevision))
    throw Error("History draft refers to a missing revision");
  return archive;
}

/** Validate the combined lineage as well as individual portable archives. */
export function validateParentGraph(
  parents: ReadonlyMap<string, string | null | undefined>,
) {
  const visited = new Set<string>();
  for (const id of parents.keys()) {
    const path = new Set<string>();
    let current: string | null | undefined = id;
    while (current && !visited.has(current)) {
      if (!parents.has(current))
        throw Error("History checkpoint refers to a missing parent");
      if (path.has(current)) throw Error("History checkpoint parent cycle");
      path.add(current);
      current = parents.get(current);
    }
    for (const id of path) visited.add(id);
  }
}
