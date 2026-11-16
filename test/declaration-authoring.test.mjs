// SPDX-License-Identifier: MIT
import { json } from "../dist/shared/identity.js";
import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { readSourceEditPreview } from "../dist/studio/interface-data.js";
const file = "/tmp/pym-new-declaration.pym";
const source =
  "// Keep the existing design byte-for-byte.\nflow main() -> Unit { return unit; }\n";
const model = (text = source) =>
  analyseFile(file, () => {}, { buffers: { [file]: text } });
test("new operation is a real checked signature, with explicit effects and unknown work", async () => {
  const { createDeclaration } = await import(
    "../dist/studio/declaration-authoring.js"
  );
  const { ir } = model();
  const preview = readSourceEditPreview(
    createDeclaration(
      ir,
      file,
      {
        kind: "operation",
        signature: {
          name: "send",
          inputs: [{ name: "amount", type: "Nat" }],
          output: {
            kind: "result",
            ok: "Unit",
            error: {
              kind: "choice",
              name: "SendErrors",
              variants: [{ name: "Declined" }, { name: "OutcomeUnknown" }],
            },
          },
          effects: [{ kind: "remote", target: "Provider" }],
        },
        costs: [],
        atomic: false,
      },
      ir.snapshot.sources[0].hash,
    ),
  );
  assert.ok(preview.text.startsWith(source));
  const called = preview.text.replace(
    "return unit;",
    "call send(1) as result; return unit;",
  );
  const checked = model(called);
  assert.ok(checked.report.diagnostics.some((d) => d.code === "E002"));
  assert.ok(
    [...checked.ir.symbols.values()].some(
      (d) => d.kind === "op" && d.name === "send",
    ),
  );
  assert.equal(preview.text.includes("atomic"), false);
  assert.equal(preview.text.includes("cost "), false);
  assert.deepEqual(model(preview.text).report.diagnostics, []);
  assert.throws(
    () =>
      createDeclaration(
        ir,
        file,
        {
          kind: "component",
          signature: { name: "main", inputs: [], output: "Unit", effects: [] },
        },
        ir.snapshot.sources[0].hash,
      ),
    /already exists/,
  );
});
test("data and lifecycle creation preserve existing source and expose real ownership obligations", async () => {
  const { createDeclaration } = await import(
    "../dist/studio/declaration-authoring.js"
  );
  let { ir } = model();
  const shape = createDeclaration(
    ir,
    file,
    {
      kind: "type",
      definition: {
        kind: "record",
        name: "Request",
        fields: [
          {
            name: "lines",
            type: {
              kind: "list",
              element: {
                kind: "record",
                name: "Line",
                fields: [{ name: "quantity", type: "Nat" }],
              },
            },
          },
        ],
      },
    },
    ir.snapshot.sources[0].hash,
  );
  assert.ok(shape.text.startsWith(source));
  assert.deepEqual(model(shape.text).report.diagnostics, []);
  ir = model(shape.text).ir;
  const resource = {
    kind: "resource",
    name: "Log",
    states: ["Open", "Closed"],
    initial: "Open",
    terminal: ["Closed"],
    transitions: [{ from: "Open", to: "Closed" }],
  };
  const preview = createDeclaration(
    ir,
    file,
    resource,
    ir.snapshot.sources[0].hash,
  );
  assert.deepEqual(model(preview.text).report.diagnostics, []);
  assert.ok(
    model(
      preview.text.replace("return unit;", "own log: Log; return unit;"),
    ).report.diagnostics.some((d) => d.code === "O004"),
  );
  assert.throws(
    () =>
      createDeclaration(
        ir,
        file,
        { ...resource, initial: "Missing" },
        ir.snapshot.sources[0].hash,
      ),
    /declared state/,
  );
  assert.throws(
    () => createDeclaration(ir, file, resource, "stale"),
    /snapshot/,
  );
});

test("an undeclared operation metric stays unresolved when that metric is checked", async () => {
  const { createDeclaration } = await import(
    "../dist/studio/declaration-authoring.js"
  );
  const { ir } = model();
  const preview = createDeclaration(
    ir,
    file,
    {
      kind: "operation",
      signature: { name: "send", inputs: [], output: "Unit", effects: [] },
      costs: [],
      atomic: false,
    },
    ir.snapshot.sources[0].hash,
  );
  const called =
    preview.text.replace(
      "flow main() -> Unit { return unit; }",
      "flow main() -> Unit budget calls <= 4 { call send(); return unit; }",
    ) +
    `
op counted() -> Unit cost calls exact 1;
`;
  const report = model(called).report;
  assert.ok(
    report.results.some(
      (r) => r.analysisKind === "cost" && r.completion !== "complete",
    ),
  );
  assert.ok(json(report).includes("no calls summary for send"));
});
