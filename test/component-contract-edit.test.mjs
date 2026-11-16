// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import {
  describeOperationContract,
  rewriteOperationContract,
} from "../dist/studio/operation-contract.js";
import {
  describeSignature,
  rewriteSignature,
} from "../dist/studio/signature.js";
const file = "/tmp/component-contract.pym";
const source =
  "op step() -> Unit cost calls exact 1;\nflow work(count: Nat) -> Nat\n  requires count > 0 // caller note\n  ensures result >= 0 // output note\n  bound count <= 50 // loop count\n  budget calls <= 50 // work limit\n{ for i in count { call step(); } return count; }";
function model(text = source) {
  const { ir, report } = analyseFile(file, () => {}, {
    buffers: { [file]: text },
  });
  return { ir, report, id: file + "#work" };
}
test("Blocks contract transaction changes component rules, budgets and bounds without moving notes", () => {
  const m = model(
      source.replace(
        "budget calls <= 50",
        "overhead steps exact 1 budget calls <= 50",
      ),
    ),
    d = describeOperationContract(m.ir, m.id);
  assert.equal(d.kind, "flow");
  assert.deepEqual(d.parameters, ["count"]);
  const preview = rewriteOperationContract(
    m.ir,
    m.id,
    {
      ...d.definition,
      requires: ["count > 1"],
      costs: [{ metric: "steps", quality: "exact", expression: "2" }],
      bounds: [{ parameter: "count", maximum: "40" }],
      budgets: [{ metric: "calls", expression: "40" }],
      origins: d.origins,
    },
    d.sourceHash,
  );
  assert.match(preview.text, /requires \(count > 1\) \/\/ caller note/);
  assert.match(preview.text, /overhead steps exact 2/);
  assert.match(preview.text, /bound count <= 40 \/\/ loop count/);
  assert.match(preview.text, /budget calls <= 40 \/\/ work limit/);
  assert.ok(
    !model(preview.text).report.diagnostics.some((d) => d.severity === "error"),
  );
  assert.throws(
    () =>
      rewriteOperationContract(
        m.ir,
        m.id,
        { ...d.definition, bounds: [{ parameter: "missing", maximum: "40" }] },
        d.sourceHash,
      ),
    /existing input/,
  );
  const signature = describeSignature(m.ir, m.id);
  const renamed = rewriteSignature(
    m.ir,
    m.id,
    {
      ...signature,
      inputs: signature.inputs.map((p) => ({ ...p, name: "items" })),
    },
    signature.sourceHash,
  );
  assert.ok(renamed.notices.some((n) => /count.*bounds.*references/.test(n)));
});
test("legacy edit plus deletion cannot guess which rule owns a note", () => {
  const m = model(
    source.replace(
      "requires count > 0 // caller note",
      "requires count > 0 // positivity\n requires count < 50 // ceiling",
    ),
  );
  const d = describeOperationContract(m.ir, m.id);
  assert.throws(
    () =>
      rewriteOperationContract(
        m.ir,
        m.id,
        { ...d.definition, requires: ["count < 40"] },
        d.sourceHash,
      ),
    /identity is ambiguous/,
  );
  const preview = rewriteOperationContract(
    m.ir,
    m.id,
    {
      ...d.definition,
      requires: ["count < 40"],
      origins: { ...d.origins, requires: [1] },
    },
    d.sourceHash,
  );
  assert.match(preview.text, /requires \(count < 40\) \/\/ ceiling/);
  assert.match(
    preview.text,
    /Removed requires rule 1; retained original note: \/\/ positivity/,
  );
});

test("adding a Blocks contract to formatted source stays formatter-clean without changing neighbouring declarations", async () => {
  const { formatSource } = await import("../dist/language/format.js");
  const input = formatSource(
    file,
    "op step() -> Unit;\nflow work(count: Nat) -> Nat { return count; }\n",
  );
  const m = model(input),
    d = describeOperationContract(m.ir, m.id);
  const preview = rewriteOperationContract(
    m.ir,
    m.id,
    {
      ...d.definition,
      requires: ["count > 0"],
      bounds: [{ parameter: "count", maximum: "50" }],
      origins: { ...d.origins, requires: [null] },
    },
    d.sourceHash,
  );
  assert.equal(preview.text, formatSource(file, preview.text));
  assert.match(preview.text, /^op step\(\) -> Unit;\n/);
  assert.ok(preview.notices.some((n) => /obligations checked/.test(n)));
  assert.ok(!preview.notices.some((n) => /external implementation/.test(n)));
});
