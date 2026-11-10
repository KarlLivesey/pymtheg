import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RecoveryStore } from "../dist/studio/recovery.js";
import { implementationDraftsSchema } from "../dist/studio/implementation-draft.js";
const draft = {
  planId: "R1",
  planName: "Send",
  planHash: "hash",
  planRevision: "plan",
  codeRevision: "code",
  observationId: "observation",
  nodeId: "main.ts#send",
  note: "Send once",
};
test("link draft recovery is bounded, per-record and never persists review approval", async () => {
  assert.equal(
    implementationDraftsSchema.safeParse([{ ...draft, reviewed: true }])
      .success,
    false,
  );
  assert.equal(
    implementationDraftsSchema.safeParse([draft, draft]).success,
    false,
  );
  assert.equal(
    implementationDraftsSchema.safeParse([{ ...draft, note: "x".repeat(2001) }])
      .success,
    false,
  );
  const root = await mkdtemp(join(tmpdir(), "pym-link-recovery-"));
  let store;
  try {
    store = await RecoveryStore.openOrCreate(root);
    store.save(0, {
      drafts: [],
      context: {
        file: "",
        entry: "",
        tab: "",
        settings: {
          seed: "1",
          maxSteps: 10,
          maxSamples: 10,
          timeoutMs: 1000,
          scope: "",
        },
        implementationDrafts: [
          draft,
          { ...draft, planId: "R2", note: "Another plan" },
        ],
      },
    });
    store.close();
    store = await RecoveryStore.openOrCreate(root);
    assert.deepEqual(store.read().context.implementationDrafts, [
      draft,
      { ...draft, planId: "R2", note: "Another plan" },
    ]);
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
