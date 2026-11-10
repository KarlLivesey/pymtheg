import test from "node:test";
import assert from "node:assert/strict";
import { loadProject } from "../dist/language/project.js";
import { typecheck } from "../dist/semantic/core.js";
import { describeBlocks } from "../dist/studio/block-model.js";
import {
  replaceBlockField,
  insertBlock,
  moveBlock,
  applyBlockEdit,
  blockDocumentSchema,
} from "../dist/studio/block-document.js";
const file = "/tmp/blocks.pym";
function model(text) {
  return describeBlocks(
    typecheck(loadProject(file, { buffers: { [file]: text } })),
    file,
  );
}
const source = `op touch(value: Nat) -> Unit cost calls exact 1;
flow main(n: Nat) -> Unit bound n <= 10 {
  // keep the explanation with this repeat
  for i in 3 { call touch(n); }
  unknown // this comment must stay
    "review } cleanup";
  return unit;
}
// independent
rule other() -> Bool = true;
`;
test("visual fields come from the canonical IR and only replace their exact text", () => {
  let doc = blockDocumentSchema.parse(model(source));
  const repeat = doc.blocks[1].sections[0].blocks[0];
  assert.equal(repeat.sections[0].blocks[0].fields[0].label, "value");
  doc = replaceBlockField(doc, repeat.fields[0], "25");
  assert.equal(doc.text, source.replace("in 3", "in 25"));
  const question = doc.blocks[1].sections[0].blocks[1];
  doc = replaceBlockField(doc, question.fields[0], 'What about "cancel"?');
  assert.ok(
    doc.text.includes(
      'unknown // this comment must stay\n    "What about \\"cancel\\"?";',
    ),
  );
  assert.equal(model(doc.text).parsed, true);
  assert.match(doc.text, /rule other\(\) -> Bool = true;/);
});
test("adding and reordering steps retain comments and unrelated source", () => {
  const doc = model(source),
    section = doc.blocks[1].sections[0];
  const moved = moveBlock(source, section, 1, -1);
  assert.ok(
    moved.indexOf("unknown") < moved.indexOf("// keep the explanation"),
  );
  assert.ok(moved.indexOf("// keep the explanation") < moved.indexOf("for i"));
  assert.equal(model(moved).parsed, true);
  const added = insertBlock(source, section, 'unknown "Choose the next step";');
  assert.equal(model(added).blocks[1].sections[0].blocks.length, 4);
  assert.match(added, /\/\/ independent\nrule other/);
  assert.throws(
    () =>
      applyBlockEdit(source, {
        span: repeatSpan(section),
        expected: "wrong snapshot",
        insert: "0",
      }),
    /source changed/,
  );
});
function repeatSpan(section) {
  return section.blocks[0].fields[0].span;
}
test("incomplete source is visible and never presented as an empty, complete design", () => {
  const broken = model(
    "flow broken() -> Unit { let x = ; }\nrule safe() -> Bool = true;",
  );
  assert.equal(broken.parsed, false);
  assert.equal(broken.blocks.at(-1).title, "safe");
  assert.equal(broken.text.includes("let x = ;"), true);
});

test("a field object retained across another edit resolves its current range", () => {
  const original = model(source);
  const repeat = original.blocks[1].sections[0].blocks[0].fields[0];
  const question = original.blocks[1].sections[0].blocks[1].fields[0];
  const first = replaceBlockField(original, repeat, "12345");
  const next = replaceBlockField(first, question, "Review cancellation");
  assert.equal(
    next.text,
    source
      .replace("in 3", "in 12345")
      .replace('"review } cleanup"', '"Review cancellation"'),
  );
  assert.throws(
    () => replaceBlockField(next, { ...question, id: "missing" }, "x"),
    /no longer available/,
  );
});

test("new steps precede a final return and retain the notes attached to it", () => {
  const text = `op touch() -> Unit;
flow main() -> Unit {
  // this note belongs to the returned result
  return unit;
}`;
  const doc = model(text);
  const edited = insertBlock(text, doc.blocks[1].sections[0], "call touch();");
  assert.ok(edited.indexOf("call touch();") < edited.indexOf("// this note"));
  const ir = typecheck(loadProject(file, { buffers: { [file]: edited } }));
  assert.equal(
    ir.diagnostics.some((finding) => finding.code === "C001"),
    false,
  );
  assert.equal(model(edited).blocks[1].sections[0].blocks[0].kind, "invoke");
  const inline = "flow main() -> Unit { return unit; }";
  const inlineEdited = insertBlock(
    inline,
    model(inline).blocks[0].sections[0],
    'unknown "Next step";',
  );
  assert.equal(model(inlineEdited).parsed, true);
  assert.ok(inlineEdited.indexOf("unknown") < inlineEdited.indexOf("return"));
});
