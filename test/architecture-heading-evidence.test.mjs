import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const signal = new AbortController().signal;
test("evidence on a requirement includes child sections but excludes later sibling requirements", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-heading-evidence-")),
    app = new StudioService(root);
  const text =
    "# Requirements\n## R03 Keep writes\nDurability rule.\n### Detail\nfsync before ack\n## R04 Read rules\nOriginal sibling\n";
  try {
    const initial = await app.importArchitecture(
      "Initial",
      [{ path: "REQ.md", text }],
      signal,
    );
    const heading = initial.entities.find(
      (e) => e.kind === "heading" && e.key === "R03",
    );
    assert.ok(heading);
    assert.match(
      (await app.architectureRecord(initial.id, heading.id)).data,
      /fsync before ack/,
    );
    assert.doesNotMatch(
      (await app.architectureRecord(initial.id, heading.id)).data,
      /Original sibling/,
    );
    const reviewed = await app.savePlanItem(
      initial.id,
      {
        ...newPlanItem("EV-1"),
        kind: "test",
        title: "Review durability",
        owner: "storage",
        status: "reviewed",
        acceptance: "Acknowledge only durable writes",
        evidence: "Reviewed requirement",
        evidenceRevision: initial.id,
        links: [{ kind: "tests", target: heading.id }],
      },
      "Review",
      signal,
    );
    const sibling = await app.editArchitectureDocument(
      reviewed.id,
      "REQ.md",
      text.replace("Original sibling", "Changed sibling"),
      "Sibling changed",
      signal,
    );
    assert.ok(
      !(await app.architectureWork(sibling.id)).some(
        (i) => i.id === "plan:EV-1" && i.kind === "stale-evidence",
      ),
    );
    const changed = await app.editArchitectureDocument(
      sibling.id,
      "REQ.md",
      text.replace("fsync before ack", "NO fsync; ack early"),
      "Child requirement changed",
      signal,
    );
    assert.ok(
      (await app.architectureWork(changed.id)).some(
        (i) => i.id === "plan:EV-1" && i.kind === "stale-evidence",
      ),
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
