import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { createDeclaration } from "../dist/studio/declaration-authoring.js";
import { declarationDraftSchema } from "../dist/studio/declaration-data.js";
import { machineDefinitionSource } from "../dist/studio/machine-authoring.js";
import { lower, initial, step, replay } from "../dist/behaviour/model.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RecoveryStore } from "../dist/studio/recovery.js";

const file = "/tmp/pym-machine-create.pym";
const source =
  "// Preserve my design\nflow existing() -> Unit { return unit; }\n";
const model = (text) =>
  analyseFile(file, () => {}, { buffers: { [file]: text } });
const definition = () => ({
  kind: "machine",
  name: "Attempts",
  states: [{ name: "count", type: "Nat", min: "0", max: "3", initial: "0" }],
  events: [
    {
      name: "tryAgain",
      guard: "count < 3",
      updates: [{ state: "count", value: "count + 1" }],
    },
  ],
  invariants: [{ name: "OnlyOnce", expression: "count <= 1" }],
});

test("created event model preserves source and exposes the actual failing second retry", () => {
  const { ir } = model(source);
  const preview = createDeclaration(
    ir,
    file,
    definition(),
    ir.snapshot.sources[0].hash,
  );
  assert.ok(preview.text.startsWith(source));
  const checked = model(preview.text);
  assert.deepEqual(checked.report.diagnostics, []);
  const plan = lower(checked.ir, "Attempts");
  assert.equal(plan.kind, "supported");
  const machine = checked.ir.symbols.get(file + "#Attempts");
  const start = initial(machine),
    first = step(machine, start, "tryAgain"),
    second = step(machine, first, "tryAgain");
  const witness = replay(plan.model, [
    { values: start, event: -2 },
    { values: first, event: 0 },
    { values: second, event: 0 },
  ]);
  assert.equal(witness.valid, true);
  assert.deepEqual(witness.violated, ["OnlyOnce"]);
  assert.ok(
    witness.events.every(
      (e) =>
        e.span.file === file &&
        preview.text.slice(e.span.start, e.span.end).includes("tryAgain"),
    ),
  );
  assert.equal(
    step(machine, step(machine, initial(machine), "tryAgain"), "tryAgain")
      .count,
    2n,
  );
  assert.equal(machine.invariants[0].name, "OnlyOnce");
  assert.match(preview.text, /invariant OnlyOnce = count <= 1/);
});

test("blank machine expressions stay explicit unknowns and cannot lower as complete", () => {
  for (const field of ["initial", "guard", "value", "expression"]) {
    const value = definition();
    if (field === "initial") value.states[0].initial = "";
    if (field === "guard") value.events[0].guard = "";
    if (field === "value") value.events[0].updates[0].value = "";
    if (field === "expression") value.invariants[0].expression = "";
    const checked = model(machineDefinitionSource(value));
    assert.ok(
      checked.report.diagnostics.some((d) => d.code === "U001"),
      field,
    );
    assert.notEqual(lower(checked.ir, "Attempts").kind, "supported", field);
  }
});

test("finite event authoring rejects invalid ranges, references, duplicates and expression injection", () => {
  const cases = [
    [
      (v) => {
        v.states[0].min = "4";
      },
      /minimum/,
    ],
    [
      (v) => {
        v.states[0].min = "";
      },
      /whole-number/,
    ],
    [
      (v) => {
        v.states[0].min = "-1";
      },
      /cannot be negative/,
    ],
    [
      (v) => {
        v.events[0].updates[0].state = "missing";
      },
      /declared state/,
    ],
    [
      (v) => {
        v.states.push({ ...v.states[0] });
      },
      /distinct/,
    ],
    [
      (v) => {
        v.events.push({ ...v.events[0] });
      },
      /distinct/,
    ],
    [
      (v) => {
        v.events[0].updates.push({ ...v.events[0].updates[0] });
      },
      /only once/,
    ],
    [
      (v) => {
        v.invariants[0].expression =
          "true; flow injected() -> Unit {} rule more() -> Bool = true";
      },
      /Extra declarations/,
    ],
    [
      (v) => {
        v.events[0].guard = "true;";
      },
      /one expression/,
    ],
  ];
  for (const [mutate, message] of cases) {
    const value = definition();
    mutate(value);
    assert.throws(() => machineDefinitionSource(value), message);
  }
});

test("unfinished event forms retain numeric text without making it valid source", () => {
  const value = definition();
  value.states[0].min = "-";
  assert.equal(
    declarationDraftSchema.parse({ file, declaration: value }).declaration
      .states[0].min,
    "-",
  );
  assert.throws(() => machineDefinitionSource(value), /whole-number/);
  value.states[0].type = "Int";
  value.states[0].min = "-3";
  assert.match(machineDefinitionSource(value), /Int in -3\.\.3/);
});

test("an unfinished event-model draft survives closing and reopening its recovery store", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-machine-recovery-"));
  let store;
  try {
    const declaration = definition();
    declaration.states[0].min = "-";
    declaration.events[0].guard = "count <";
    const draft = { file: "main.pym", declaration };
    const state = {
      drafts: [],
      context: {
        file: "main.pym",
        entry: "Attempts",
        tab: "findings",
        settings: {
          seed: "42",
          maxSteps: 6,
          maxSamples: 20,
          timeoutMs: 1000,
          scope: "{}",
        },
        declarationDraft: draft,
      },
    };
    store = await RecoveryStore.openOrCreate(root);
    store.save(0, state);
    store.close();
    store = await RecoveryStore.openOrCreate(root);
    assert.deepEqual(store.read().context.declarationDraft, draft);
    assert.throws(
      () =>
        machineDefinitionSource(
          store.read().context.declarationDraft.declaration,
        ),
      /whole-number/,
    );
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
