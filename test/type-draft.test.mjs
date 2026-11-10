import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readTypeDraft,
  mergeTypeDefinitions,
} from "../dist/studio/type-edit-data.js";
import { RecoveryStore } from "../dist/studio/recovery.js";
import {
  appendDefinitionMember,
  validateInterfaceType,
} from "../dist/studio/interface-builder.js";
const base = {
  kind: "record",
  name: "Request",
  fields: [
    { name: "count", type: "Nat" },
    { name: "label", type: "String" },
  ],
};
test("add/remove/add keeps default member names unique for records and outcomes", () => {
  const record = appendDefinitionMember({
    kind: "record",
    name: "Data",
    fields: [
      { name: "field3", type: "Nat" },
      { name: "id", type: "Nat" },
    ],
  });
  assert.equal(record.fields.at(-1).name, "field4");
  assert.deepEqual(record.fields.at(-1).type, { kind: "unselected" });
  validateInterfaceType(record, { draft: true });
  assert.throws(() => validateInterfaceType(record), /field4.*choose what/);
  const choice = appendDefinitionMember({
    kind: "choice",
    name: "Decision",
    variants: [{ name: "Outcome3" }, { name: "Ready" }],
  });
  assert.equal(choice.variants.at(-1).name, "Outcome4");
  validateInterfaceType(choice);
});
test("data-shape merge preserves independent changes and requires a choice for conflicting members", () => {
  const saved = {
    ...base,
    fields: [...base.fields, { name: "enabled", type: "Bool" }],
  };
  const current = {
    ...base,
    fields: [{ name: "count", type: "Int" }, base.fields[1]],
  };
  const merged = mergeTypeDefinitions(base, saved, current);
  assert.deepEqual(merged.unresolved, []);
  assert.deepEqual(merged.definition.fields, [
    ...current.fields,
    { name: "enabled", type: "Bool" },
  ]);
  const conflict = {
    ...base,
    fields: [{ name: "count", type: "String" }, base.fields[1]],
  };
  assert.equal(
    mergeTypeDefinitions(base, conflict, current).unresolved[0].key,
    "member:count",
  );
  assert.equal(
    mergeTypeDefinitions(base, conflict, current, { "member:count": "saved" })
      .definition.fields[0].type,
    "String",
  );
  const deleted = { ...base, fields: [base.fields[1]] };
  assert.ok(
    mergeTypeDefinitions(base, deleted, current).unresolved.some(
      (item) => item.key === "member:count",
    ),
  );
});
test("unfinished duplicate member names never disappear during draft recovery", () => {
  const saved = {
    ...base,
    fields: [
      { name: "", type: "Nat" },
      { name: "", type: "Bool" },
    ],
  };
  assert.deepEqual(mergeTypeDefinitions(base, saved, base).definition, saved);
  const changed = {
    ...base,
    fields: [...base.fields, { name: "newField", type: "String" }],
  };
  assert.equal(
    mergeTypeDefinitions(base, saved, changed).unresolved[0].key,
    "definition",
  );
  assert.deepEqual(
    mergeTypeDefinitions(base, saved, changed, { definition: "saved" })
      .definition,
    saved,
  );
});
test("unfinished data-shape fields survive the durable recovery store", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-type-draft-"));
  let store;
  try {
    const draft = readTypeDraft({
      schema: "pymtheg.type-draft/v1",
      file: "types.pym",
      name: "Request",
      baseline: base,
      definition: { ...base, fields: [{ name: "", type: "String" }] },
    });
    store = await RecoveryStore.openOrCreate(root);
    store.save(0, {
      drafts: [],
      context: {
        file: "types.pym",
        entry: "",
        tab: "findings",
        settings: {
          seed: "42",
          maxSteps: 12,
          maxSamples: 1000,
          timeoutMs: 45000,
          scope: "{}",
        },
        typeDraft: draft,
      },
    });
    store.close();
    store = null;
    store = await RecoveryStore.openOrCreate(root);
    assert.deepEqual(store.read().context.typeDraft, draft);
    assert.throws(
      () => readTypeDraft({ ...draft, file: "../elsewhere.pym" }),
      /identity/,
    );
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
