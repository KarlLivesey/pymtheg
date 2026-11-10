import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateInterfaceType,
  buildInterface,
  appendDefinitionMember,
  appendInterfaceInput,
} from "../dist/studio/interface-builder.js";
import { interfaceTypeSource } from "../dist/studio/interface-syntax.js";
import { declarationDraftSchema } from "../dist/studio/declaration-data.js";
import { createDeclaration } from "../dist/studio/declaration-authoring.js";
import { RecoveryStore } from "../dist/studio/recovery.js";
import { typecheck } from "../dist/semantic/core.js";
import { loadProject } from "../dist/language/project.js";
const unanswered = { kind: "unselected" };
const source = "flow keep() -> Unit { return unit; }\n";
const definition = {
  kind: "record",
  name: "Request",
  fields: [
    { name: "id", type: "Nat" },
    { name: "amount", type: unanswered },
  ],
};
test("unanswered types are recoverable drafts and cannot be emitted as source", () => {
  validateInterfaceType(definition, { draft: true });
  assert.throws(
    () => validateInterfaceType(definition),
    /amount.*Request.*choose what/,
  );
  assert.throws(
    () =>
      interfaceTypeSource(unanswered, () =>
        assert.fail("must not resolve unanswered type"),
      ),
    /choose what/i,
  );
  assert.throws(
    () =>
      buildInterface("send", [{ name: "request", type: definition }], "Unit"),
    /amount.*Request.*choose what/,
  );
  for (const value of [
    { kind: "list", element: unanswered },
    {
      kind: "result",
      ok: unanswered,
      error: {
        kind: "choice",
        name: "Failure",
        variants: [{ name: "Denied" }],
      },
    },
    {
      kind: "choice",
      name: "Reply",
      variants: [{ name: "Found", payload: unanswered }],
    },
  ]) {
    validateInterfaceType(value, { draft: true });
    assert.throws(() => validateInterfaceType(value), /choose what/);
  }
  const complete = {
    ...definition,
    fields: [definition.fields[0], { name: "amount", type: "Nat" }],
  };
  assert.match(
    buildInterface("send", [{ name: "request", type: complete }], "Unit"),
    /amount: Nat/,
  );
});
test("new slots ask for a type and leave existing selected values alone", () => {
  const input = [{ name: "input2", type: "Bool" }];
  const next = appendInterfaceInput(input);
  assert.equal(next[1].name, "input3");
  assert.deepEqual(next[1].type, unanswered);
  assert.deepEqual(input, [{ name: "input2", type: "Bool" }]);
  const nextRecord = appendDefinitionMember({
    kind: "record",
    name: "Data",
    fields: [{ name: "field2", type: "Int" }],
  });
  assert.equal(nextRecord.fields[1].name, "field3");
  assert.deepEqual(nextRecord.fields[1].type, unanswered);
});
test("unfinished declaration survives a real restart and preview cannot write a partial type", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-unselected-type-"));
  let store;
  try {
    const file = join(root, "main.pym"),
      draft = declarationDraftSchema.parse({
        file: "main.pym",
        declaration: { kind: "type", definition },
      });
    const ir = typecheck(loadProject(file, { buffers: { [file]: source } }));
    store = await RecoveryStore.openOrCreate(root);
    store.save(0, {
      drafts: [],
      context: {
        file: "main.pym",
        entry: "",
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
    const recovered = store.read().context.declarationDraft;
    assert.deepEqual(recovered, draft);
    assert.throws(
      () =>
        createDeclaration(
          ir,
          file,
          recovered.declaration,
          ir.snapshot.sources[0].hash,
        ),
      /amount.*choose what/,
    );
    assert.equal(ir.snapshot.sources[0].text, source);
    recovered.declaration.definition.fields[1].type = "Nat";
    const preview = createDeclaration(
      ir,
      file,
      recovered.declaration,
      ir.snapshot.sources[0].hash,
    );
    assert.match(preview.text, /amount: Nat/);
    assert.ok(preview.text.startsWith(source));
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
