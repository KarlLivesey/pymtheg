// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { DraftWriter } from "../dist/architecture/draft-writer.js";
import { newPlanItem } from "../dist/architecture/planning.js";
for (const competing of [false, true])
  test(`confirmed save stays successful when recovery ${competing ? "belongs to another writer" : "can be cleared"}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pym-commit-recovery-")),
      app = new StudioService(root),
      signal = new AbortController().signal;
    try {
      const original = {
        ...newPlanItem("R1"),
        title: "Original",
        owner: "team",
      };
      const base = await app.savePlanItem("", original, "Initial", signal);
      const changed = { ...original, title: "Confirmed design change" },
        target = { document: "architecture/plan.json", originalId: "R1" };
      const draft = {
        kind: "plan",
        baseRevision: base.id,
        item: changed,
        target,
      };
      const writer = new DraftWriter(0, null, (version, value) =>
        app.saveArchitectureDraft(version, value),
      );
      writer.persist(draft);
      await writer.flush();
      if (competing)
        await app.saveArchitectureDraft(1, {
          kind: "plan",
          baseRevision: base.id,
          item: { ...newPlanItem("R2"), title: "Other session", owner: "team" },
        });
      const saved = await app.savePlanItem(
        base.id,
        changed,
        "Confirmed",
        signal,
        target,
      );
      let reload = false;
      const warning = await writer.finishCommitted(() => {
        reload = true;
      });
      assert.equal(
        (await app.architectureRecord(saved.id, "plan:R1")).data.title,
        changed.title,
      );
      assert.equal(reload, competing);
      if (competing) {
        assert.match(warning, /design was saved/);
        assert.equal(
          (await app.architectureDraft()).draft.item.title,
          "Other session",
        );
        assert.equal(writer.value.item.title, changed.title);
      } else {
        assert.equal(warning, null);
        assert.equal((await app.architectureDraft()).draft, null);
      }
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
