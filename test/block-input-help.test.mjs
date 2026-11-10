import test from "node:test";
import assert from "node:assert/strict";
import { loadProject } from "../dist/language/project.js";
import { typecheck } from "../dist/semantic/core.js";
import { describeBlocks } from "../dist/studio/block-model.js";
import { replaceBlockField } from "../dist/studio/block-document.js";
const file = "/tmp/pym-block-input-help.pym";
const source = `op send(amount: Nat) -> Unit;
flow main(amount: Nat, message: String) -> Unit { call send(unknown "Choose amount"); }`;
test("call input guidance suggests compatible names without choosing one or losing the unknown", () => {
  const ir = typecheck(loadProject(file, { buffers: { [file]: source } }));
  const doc = describeBlocks(ir, file);
  const field = doc.blocks[1].sections[0].blocks[0].fields[0];
  assert.equal(field.placeholder, "Choose amount");
  assert.deepEqual(field.suggestions, ["amount"]);
  assert.match(doc.text, /unknown "Choose amount"/);
  assert.ok(ir.holes.size);
  const edited = replaceBlockField(doc, field, "amount");
  const checked = typecheck(
    loadProject(file, { buffers: { [file]: edited.text } }),
  );
  assert.equal(checked.holes.size, 0);
  assert.deepEqual(checked.diagnostics, []);
});

test("input suggestions are local and bounded instead of using another flow's names", () => {
  const text = `op send(amount: Nat) -> Unit;
flow unrelated(value: Nat) -> Unit { return unit; }
flow main(message: String) -> Unit { call send(unknown "Choose amount"); }`;
  const ir = typecheck(loadProject(file, { buffers: { [file]: text } }));
  const field = describeBlocks(ir, file).blocks[2].sections[0].blocks[0]
    .fields[0];
  assert.deepEqual(field.suggestions, []);
});

test("large input scopes bound suggestions and disclose incomplete search", () => {
  const params = Array.from({ length: 300 }, (_, i) => `n${i}: Nat`).join(", ");
  const text = `op send(n: Nat) -> Unit; flow main(${params}) -> Unit { call send(unknown "Choose n"); }`;
  const ir = typecheck(loadProject(file, { buffers: { [file]: text } }));
  const input = describeBlocks(ir, file).blocks[1].sections[0].blocks[0]
    .fields[0];
  assert.equal(input.suggestions.length, 20);
  assert.equal(input.suggestionsComplete, false);
  assert.ok(ir.holes.size);
  assert.equal(ir.measurements.inputSuggestionVisits, 20);
});

test("a compatible name beyond the scan cap is omitted with an explicit limitation", () => {
  const params = Array.from({ length: 270 }, (_, i) => `s${i}: String`).join(
    ", ",
  );
  const text = `op send(n: Nat) -> Unit; flow main(${params}, amount: Nat) -> Unit { call send(unknown "Choose amount"); }`;
  const ir = typecheck(loadProject(file, { buffers: { [file]: text } }));
  const input = describeBlocks(ir, file).blocks[1].sections[0].blocks[0]
    .fields[0];
  assert.deepEqual(input.suggestions, []);
  assert.equal(input.suggestionsComplete, false);
  assert.equal(ir.measurements.inputSuggestionVisits, 256);
});

test("clearing an answered call input restores a valid explicit question through recheck", () => {
  let doc = describeBlocks(
    typecheck(
      loadProject(file, {
        buffers: {
          [file]: source.replace('unknown "Choose amount"', "amount"),
        },
      }),
    ),
    file,
  );
  const input = doc.blocks[1].sections[0].blocks[0].fields[0];
  doc = replaceBlockField(doc, input, "   ");
  const checked = typecheck(
    loadProject(file, { buffers: { [file]: doc.text } }),
  );
  assert.equal(
    checked.diagnostics.some((d) => d.code.startsWith("P")),
    false,
  );
  assert.ok(checked.holes.size > 0);
  const restored = describeBlocks(checked, file).blocks[1].sections[0].blocks[0]
    .fields[0];
  assert.equal(
    doc.text.slice(restored.span.start, restored.span.end),
    restored.placeholderSource,
  );
  assert.equal(restored.placeholder, "Choose amount");
  const answered = replaceBlockField(doc, restored, "amount");
  assert.equal(
    typecheck(loadProject(file, { buffers: { [file]: answered.text } })).holes
      .size,
    0,
  );
});
