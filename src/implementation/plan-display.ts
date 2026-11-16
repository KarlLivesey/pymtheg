// SPDX-License-Identifier: MIT
/** A readable view of native planning fields; original JSON remains available. */
export function planDisplay(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.title !== "string")
    return undefined;
  const labels: Record<string, string> = {
    title: "Title",
    kind: "Kind",
    status: "Authored status",
    owner: "Owner",
    detail: "Plan",
    description: "Description",
    acceptance: "Acceptance criteria",
    evidence: "Authored evidence",
    evidenceRevision: "Evidence version",
  };
  return Object.entries(labels).flatMap(([key, label]) => {
    const text = record[key];
    if (typeof text !== "string" || !text) return [];
    return [
      { label, text: text.slice(0, 2000), truncated: text.length > 2000 },
    ];
  });
}
