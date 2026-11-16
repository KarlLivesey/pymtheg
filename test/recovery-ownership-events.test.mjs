// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
test("successful recovery ownership is pushed immediately; stale ownership changes nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-recovery-event-"));
  const service = new StudioService(root);
  try {
    await service.initializeRecovery();
    const events = [];
    const unsub = service.subscribe((e) => events.push(e));
    const before = service.readRecovery();
    const first = await service.saveRecovery(
      before.revision,
      { drafts: [], context: null },
      "window-a",
    );
    assert.deepEqual(events, [
      { kind: "recovery", revision: first.revision, owner: "window-a" },
    ]);
    const second = await service.saveRecovery(
      first.revision,
      { drafts: [], context: null },
      "window-b",
    );
    assert.equal(events.at(-1).owner, "window-b");
    assert.equal(events.at(-1).revision, second.revision);
    await assert.rejects(
      service.saveRecovery(
        first.revision,
        { drafts: [], context: null },
        "window-a",
      ),
      /RecoveryConflict/,
    );
    assert.equal(events.length, 2);
    assert.equal(service.readRecovery().revision, second.revision);
    unsub();
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
