import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { indexArchitecture } from "../dist/architecture/model.js";
import { hash } from "../dist/shared/identity.js";
const signal = new AbortController().signal;
test("the service preserves names for identical content and does not invent semantic differences", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-checkpoint-api-")),
    app = new StudioService(root);
  try {
    const docs = [{ path: "design.md", text: "Accepted design" }],
      first = await app.importArchitecture("Initial baseline", docs, signal),
      second = await app.importArchitecture(
        "Release review complete",
        docs,
        signal,
      );
    assert.notEqual(first.id, second.id);
    assert.equal(first.snapshotHash, second.snapshotHash);
    const overview = await app.architectureOverview();
    assert.equal(overview.activeRevision, second.id);
    assert.deepEqual(
      new Set(overview.revisions.map((r) => r.label)),
      new Set(["Initial baseline", "Release review complete"]),
    );
    assert.equal((await app.architectureOverview(first.id)).index.id, first.id);
    assert.equal(
      (await app.architectureDocument(first.id, "design.md")).text,
      "Accepted design",
    );
    const diff = await app.compareArchitecture(second.id, first.id);
    assert.deepEqual(diff.changed, []);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    const archive = await app.exportArchitectureHistory();
    assert.equal(archive.snapshots.length, 1);
    assert.equal(archive.revisions.length, 2);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("legacy archives retain old IDs after import and label-only checkpoints do not stale linked evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-legacy-checkpoint-api-")),
    app = new StudioService(root);
  try {
    const doc = {
        path: "catalogue.json",
        text: JSON.stringify({
          types: {},
          functions: [
            { id: "f", name: "f", owner: "service", args: {}, returns: "Unit" },
          ],
        }),
      },
      old = indexArchitecture([doc]);
    const archive = {
      schema: "pymtheg.architecture-history/v1",
      active: old.id,
      revisions: [
        {
          id: old.id,
          label: "Legacy",
          created: "2026-11-08T00:00:00.000Z",
          source: "legacy",
          documents: [{ path: doc.path, hash: hash(doc.text) }],
        },
      ],
      blobs: [{ hash: hash(doc.text), text: doc.text }],
      draft: null,
    };
    const preview = await app.previewArchitectureHistory(archive, signal);
    await app.commitArchitectureHistory(preview.token, signal);
    assert.equal((await app.architectureOverview()).index.id, old.id);
    const reviewed = await app.savePlanItem(
      old.id,
      {
        ...newPlanItem("R1"),
        title: "Review f",
        owner: "service",
        status: "reviewed",
        acceptance: "Expected contract",
        evidence: "Review note",
        evidenceRevision: old.id,
        links: [{ kind: "supports", target: "function:f" }],
      },
      "Reviewed",
      signal,
    );
    const named = await app.editArchitectureDocument(
      reviewed.id,
      doc.path,
      doc.text,
      "Approved checkpoint",
      signal,
    );
    assert.notEqual(named.id, reviewed.id);
    assert.equal(named.snapshotHash, reviewed.snapshotHash);
    assert.ok(
      !(await app.architectureWork(named.id)).some(
        (issue) => issue.kind === "stale-evidence",
      ),
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("naming the current version is explicit and rejects a stale target without losing its name", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-name-version-")),
    app = new StudioService(root);
  try {
    const first = await app.importArchitecture(
        "First",
        [{ path: "design.md", text: "Design" }],
        signal,
      ),
      named = await app.nameArchitectureVersion(
        first.id,
        "Ready for API review",
        signal,
      );
    assert.notEqual(named.id, first.id);
    assert.equal(named.snapshotHash, first.snapshotHash);
    await assert.rejects(
      app.nameArchitectureVersion(first.id, "Stale name", signal),
      /current architecture changed/,
    );
    const overview = await app.architectureOverview();
    assert.equal(overview.index.id, named.id);
    assert.ok(
      overview.revisions.some((r) => r.label === "Ready for API review"),
    );
    assert.ok(!overview.revisions.some((r) => r.label === "Stale name"));
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
