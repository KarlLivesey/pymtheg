interface ImportSummary {
  committed: boolean;
  unchanged?: boolean;
  revision?: string;
  message?: string;
  changes: { added: string[]; changed: string[]; removed: string[] };
  conflicts?: { path: string; reason: string }[];
  warnings?: string[];
  newlyBrokenAuthoredLinks?: { name: string; target: string }[];
  [key: string]: unknown;
}
/** Human import view; JSON remains available for full machine-readable detail. */
export function renderImportSummary(value: ImportSummary): string {
  const lines = [
    value.committed
      ? "Architecture import saved."
      : value.unchanged
        ? "Architecture already matches this source."
        : "Architecture import preview — no changes saved.",
  ];
  if (value.revision) lines.push("Revision: " + value.revision);
  if (value.message) lines.push(value.message);
  for (const [label, rows] of [
    ["Added", value.changes.added],
    ["Changed", value.changes.changed],
    ["Removed", value.changes.removed],
  ] as const) {
    lines.push(`${label}: ${rows.length}`);
    for (const path of rows.slice(0, 20)) lines.push("  " + path);
    if (rows.length > 20)
      lines.push(
        `  … ${rows.length - 20} more; use --format json for all paths.`,
      );
  }
  for (const row of value.conflicts ?? [])
    lines.push(`Conflict: ${row.path} — ${row.reason}`);
  for (const row of value.newlyBrokenAuthoredLinks ?? [])
    lines.push(`Plan link needs repair: ${row.name} → ${row.target}`);
  for (const warning of value.warnings ?? []) lines.push("Notice: " + warning);
  if (value.conflicts?.length)
    lines.push(
      "Resolve each document conflict in Studio or supply --resolutions FILE.json.",
    );
  return lines.join("\n") + "\n";
}
