import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initialDeclaration,
  declarationDraftSchema,
} from "../dist/studio/declaration-data.js";
import { RecoveryStore } from "../dist/studio/recovery.js";
test("unfinished declaration fields survive recovery without becoming validated source", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-new-decl-recovery-"));
  let store;
  try {
    store = await RecoveryStore.openOrCreate(root);
    const declaration = {
      ...initialDeclaration("resource"),
      name: "",
      initial: "",
      terminal: [],
    };
    const draft = { file: "main.pym", declaration };
    assert.deepEqual(declarationDraftSchema.parse(draft), draft);
    const state = {
      drafts: [],
      context: {
        file: "main.pym",
        entry: "main",
        tab: "findings",
        settings: {
          seed: "1",
          maxSteps: 10,
          maxSamples: 10,
          timeoutMs: 1000,
          scope: "{}",
        },
        declarationDraft: draft,
      },
    };
    store.save(0, state);
    store.close();
    store = await RecoveryStore.openOrCreate(root);
    assert.deepEqual(store.read().context.declarationDraft, draft);
    assert.equal(
      declarationDraftSchema.safeParse({
        ...draft,
        declaration: { ...declaration, states: Array(41).fill("s") },
      }).success,
      false,
    );
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("unfinished operation rules survive a real recovery-store restart verbatim", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-operation-recovery-"));
  let store;
  try {
    const draft = {
      file: "main.pym",
      declaration: {
        ...initialDeclaration("operation"),
        requires: ["", "amount >"],
        ensures: ["result >= amount"],
      },
    };
    store = await RecoveryStore.openOrCreate(root);
    store.save(0, {
      drafts: [],
      context: {
        file: "main.pym",
        entry: "main",
        tab: "findings",
        settings: {
          seed: "1",
          maxSteps: 10,
          maxSamples: 10,
          timeoutMs: 1000,
          scope: "{}",
        },
        declarationDraft: draft,
      },
    });
    store.close();
    store = await RecoveryStore.openOrCreate(root);
    assert.deepEqual(store.read().context.declarationDraft, draft);
    assert.deepEqual(declarationDraftSchema.parse(draft), draft);
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
