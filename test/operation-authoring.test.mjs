// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { createDeclaration } from "../dist/studio/declaration-authoring.js";
import { declarationDraftSchema } from "../dist/studio/declaration-data.js";

const file = "/tmp/pym-operation-rules.pym";
const original =
  "// Retain this design.\nflow main() -> Unit { return unit; }\n";
const analyse = (text) =>
  analyseFile(file, () => {}, { buffers: { [file]: text } });
const operation = {
  kind: "operation",
  signature: {
    name: "reserve",
    inputs: [{ name: "amount", type: "Nat" }],
    output: "Nat",
    effects: [],
  },
  requires: ["amount > 0"],
  ensures: ["result >= amount"],
};
function preview(edit = operation) {
  const { ir } = analyse(original);
  return createDeclaration(ir, file, edit, ir.snapshot.sources[0].hash);
}

test("authored operation rules produce real caller findings and retain environmental assumptions", () => {
  const result = preview();
  assert.ok(result.text.startsWith(original));
  assert.deepEqual(analyse(result.text).report.diagnostics, []);
  const bad = analyse(
    result.text +
      "\nflow bad() -> Unit { call reserve(0) as value; return unit; }\n",
  );
  assert.ok(bad.report.diagnostics.some((d) => d.code === "C004"));
  const good = analyse(
    result.text +
      "\nflow good(n: Nat) -> Unit { if n > 0 { call reserve(n) as value; } return unit; }\n",
  );
  const call = good.report.results.find(
    (r) => r.analysisKind === "call-contract",
  );
  assert.equal(call.outcome, "established");
  assert.ok(
    call.assumptions.some((a) => /Trusted abstract postconditions/.test(a)),
  );
  assert.ok(result.notices.some((n) => /assumptions/.test(n)));
});

test("blank rules remain unresolved and incomplete drafts survive schema validation", () => {
  const draft = declarationDraftSchema.parse({
    file,
    declaration: { ...operation, requires: [""], ensures: ["result >="] },
  });
  assert.equal(draft.declaration.ensures[0], "result >=");
  for (const kind of ["requires", "ensures"]) {
    const result = preview({
      ...operation,
      requires: [],
      ensures: [],
      [kind]: [""],
    });
    assert.match(result.text, /unknown/);
    const checked = analyse(
      result.text +
        "\nflow caller() -> Unit { call reserve(1) as value; return unit; }\n",
    );
    assert.ok(
      checked.report.results.some((r) => r.completion === "incomplete"),
      kind,
    );
  }
});

test("operation expression fields refuse extra declarations and metadata before applying", () => {
  for (const expression of [
    "true; flow injected() -> Unit {}",
    "true ensures false",
    "amount >",
  ]) {
    assert.throws(
      () => preview({ ...operation, requires: [expression] }),
      /one expression/,
    );
  }
  assert.throws(() =>
    preview({ ...operation, requires: Array(21).fill("true") }),
  );
  assert.throws(() => preview({ ...operation, ensures: ["x".repeat(1001)] }));
});
