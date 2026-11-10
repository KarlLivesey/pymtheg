import type { StudioRun } from "./protocol.js";
export function mergeRun(
  records: StudioRun[],
  incoming: StudioRun,
): StudioRun[] {
  const current = records.find((r) => r.id === incoming.id);
  if (current && current.sequence >= incoming.sequence) return records;
  return [incoming, ...records.filter((r) => r.id !== incoming.id)].slice(
    0,
    10,
  );
}
