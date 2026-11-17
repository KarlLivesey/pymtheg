// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
test("evidence reviewed at many historical revisions is stale only where its target changed", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-evidence-retention-test-"));
  let store, app;
  try {
    store = await ArchitectureStore.open(root);
    const baselineCount = 8;
    const types = Object.fromEntries(
      Array.from({ length: 250 }, (_, i) => [
        "T" + i,
        { number: i + 1, fields: "" },
      ]),
    );
    const api = {
      path: "api.json",
      text: JSON.stringify({ functions: [], types }),
    };
    const revisions = [];
    for (let i = 0; i < baselineCount; i++)
      revisions.push(
        store.save("Baseline " + i, "test", [
          api,
          { path: "note.md", text: "Version " + i },
        ]).id,
      );
    const items = revisions.map((id, i) => ({
      ...newPlanItem("R" + i),
      title: "Review " + i,
      status: "reviewed",
      acceptance: "Keep type",
      evidence: "Type was reviewed",
      evidenceRevision: id,
      links: [{ kind: "supports", target: "type:" + (i + 1) }],
    }));
    const changed = structuredClone(types);
    changed.T7.fields = { changed: "Bool" };
    const current = store.save("Reviewed targets", "test", [
      {
        path: "api.json",
        text: JSON.stringify({ functions: [], types: changed }),
      },
      {
        path: "plan.json",
        text: JSON.stringify({ schema: "pymtheg.plan/v1", items }),
      },
    ]);
    store.close();
    store = null;
    app = new StudioService(root);
    const work = await app.architectureWork(current.id);
    assert.deepEqual(
      work.map(({ id, kind }) => ({ id, kind })),
      [{ id: "plan:R7", kind: "stale-evidence" }],
    );
  } finally {
    store?.close();
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
