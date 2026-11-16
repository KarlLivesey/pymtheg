// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { loadProject } from "../dist/language/project.js";
import { typecheck } from "../dist/semantic/core.js";
import { describeBlocks } from "../dist/studio/block-model.js";
import {
  replaceBlockField,
  blockDocumentSchema,
} from "../dist/studio/block-document.js";
import { initial, step } from "../dist/behaviour/model.js";

const file = "/tmp/pym-data-event-blocks.pym";
function checked(text) {
  const ir = typecheck(loadProject(file, { buffers: { [file]: text } }));
  return { ir, doc: blockDocumentSchema.parse(describeBlocks(ir, file)) };
}
test("data-member cards edit one type while preserving comments and exposing affected code", () => {
  const text = `// Keep the original field note\ntype Request = { amount: Nat, label: String };\nflow amount(r: Request) -> Nat { return r.amount; }`;
  const { doc } = checked(text);
  const field = doc.blocks[0].children.find((b) => b.title === "amount")
    .fields[0];
  const next = replaceBlockField(doc, field, "String");
  assert.equal(next.text, text.replace("amount: Nat", "amount: String"));
  assert.ok(
    checked(next.text).ir.diagnostics.some(
      (d) =>
        d.severity === "error" &&
        d.span.start > next.text.indexOf("flow amount"),
    ),
  );
});
test("event cards edit guards and updates using the actual source-step semantics", () => {
  const text = `machine Counter {
  state count: Nat in 0..2 = 0;
  event advance when count < 2 { count = count + 1; }
  invariant bounded = count <= 1;
}`;
  const { doc } = checked(text);
  const event = doc.blocks[0].children.find((b) => b.kind === "event");
  const guard = event.fields.find((f) => f.label === "When this can happen");
  const edited = replaceBlockField(doc, guard, "count < 1");
  const { ir, doc: refreshed } = checked(edited.text);
  assert.deepEqual(ir.diagnostics, []);
  const machine = ir.declarations[0];
  const first = step(machine, initial(machine), "advance");
  assert.equal(first.count, 1n);
  assert.throws(() => step(machine, first, "advance"), /Disabled/);
  const update = refreshed.blocks[0].children
    .find((b) => b.kind === "event")
    .fields.find((f) => f.label === "Set count");
  const changed = replaceBlockField(refreshed, update, "count + 2");
  const result = checked(changed.text).ir.declarations[0];
  assert.equal(step(result, initial(result), "advance").count, 2n);
  assert.match(changed.text, /invariant bounded = count <= 1;/);
});

test("large data definitions stop at the shared visual budget and retain source", () => {
  const fields = Array.from({ length: 1000 }, (_, i) => `field${i}: Nat`).join(
    ", ",
  );
  const text = `type Large = { ${fields} };`;
  const { doc } = checked(text);
  assert.equal(doc.truncated, true);
  assert.ok(doc.blocks[0].children.length < 1000);
  assert.equal(doc.text, text);
});
