/** Shared representation budgets. Counts and byte limits do not depend on machine speed. */
export const architectureLimits = Object.freeze({
  documentBytes: 16 * 1024 * 1024,
  snapshotBytes: 64 * 1024 * 1024,
  archiveBytes: 64 * 1024 * 1024,
  retainedBytes: 512 * 1024 * 1024,
  draftBytes: 16 * 1024 * 1024,
  maxDocuments: 4096,
  maxObservationParts: 10000,
  maxRevisions: 10000,
  indexVisits: 1_000_000,
});

/** Reserved, parser-produced code parts have a separate count budget from user documents. */
export function isObservationPart(path: string) {
  return /^\.pymtheg-code-parts\/[a-f0-9]{64}\.json$/.test(path);
}
export const maxStoredDocuments =
  architectureLimits.maxDocuments + architectureLimits.maxObservationParts;
export function documentCountsWithinLimits(
  documents: readonly { path: string }[],
) {
  const parts = documents.filter((d) => isObservationPart(d.path)).length;
  return (
    parts <= architectureLimits.maxObservationParts &&
    documents.length - parts <= architectureLimits.maxDocuments
  );
}
