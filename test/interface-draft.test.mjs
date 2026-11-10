import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RecoveryStore } from "../dist/studio/recovery.js";
import { readSignatureEdit } from "../dist/studio/interface-data.js";
import { defaultRecipeOptions } from "../dist/studio/recipes.js";
test("unfinished type names persist as drafts while apply validation still rejects them", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-blank-form-"));
  let store;
  try {
    store = await RecoveryStore.openOrCreate(root);
    const options = {
      ...defaultRecipeOptions,
      inputs: [
        {
          name: "customer",
          type: {
            kind: "record",
            name: "",
            fields: [{ name: "", type: "Nat" }],
          },
        },
      ],
    };
    assert.throws(
      () => readSignatureEdit({ ...options, effects: [] }),
      /name|identifier/,
    );
    const context = {
      file: "",
      entry: "",
      tab: "findings",
      settings: {
        seed: "42",
        maxSteps: 6,
        maxSamples: 10,
        timeoutMs: 45000,
        scope: "{}",
      },
      newDesign: { id: "component", options, path: "new.pym", choosing: false },
      interfaceDraft: {
        file: "main.pym",
        symbolId: "symbol",
        snapshotId: "snapshot",
        edit: { ...options, effects: [] },
      },
    };
    store.save(0, { drafts: [], context });
    store.close();
    store = await RecoveryStore.openOrCreate(root);
    assert.equal(
      store.read().context.newDesign.options.inputs[0].type.name,
      "",
    );
    assert.equal(
      store.read().context.interfaceDraft.edit.inputs[0].type.fields[0].name,
      "",
    );
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
