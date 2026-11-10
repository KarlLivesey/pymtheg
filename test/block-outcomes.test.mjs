import test from "node:test";
import assert from "node:assert/strict";
import { loadProject } from "../dist/language/project.js";
import { typecheck } from "../dist/semantic/core.js";
import { describeBlocks } from "../dist/studio/block-model.js";
const file = "/tmp/pym-outcome-blocks.pym";
const source =
  "type Error = Busy | Rejected(String); op send(n: Nat) -> Result<Bool, Error>; flow main(n: Nat) -> Result<Bool, Error> { call send(n) as outcome; }";
test("a call block exposes its resolved outcomes and a compatible return action", () => {
  const ir = typecheck(loadProject(file, { buffers: { [file]: source } }));
  const call = describeBlocks(ir, file).blocks.find((b) => b.title === "main")
    .sections[0].blocks[0];
  assert.deepEqual(
    call.callResult.outcomes.map((o) => o.tag),
    ["Ok", "Busy", "Rejected"],
  );
  assert.equal(call.callResult.canReturn, true);
  assert.equal(call.callResult.binding, "outcome");
});

test("outcome actions use real source syntax and never invent completed branches", async () => {
  const { appendCallOutcome } = await import(
    "../dist/studio/block-document.js"
  );
  const { parse } = await import("../dist/language/parser.js");
  const { analyseFile } = await import("../dist/analysis/index.js");
  const describe = (text) =>
    describeBlocks(
      typecheck(loadProject(file, { buffers: { [file]: text } })),
      file,
    );
  const doc = describe(source),
    call = doc.blocks.find((b) => b.title === "main").sections[0].blocks[0];
  const handled = appendCallOutcome(doc, call, "handle");
  const parsed = parse(file, handled);
  assert.deepEqual(parsed.diagnostics, []);
  const match = parsed.declarations.find((d) => d.name === "main").body[1];
  assert.deepEqual(
    match.arms.map((arm) => arm.tag),
    ["Ok", "Busy", "Rejected"],
  );
  assert.ok(match.arms.every((arm) => arm.body[0].kind === "unknown"));
  const report = analyseFile(file, () => {}, {
    buffers: { [file]: handled },
  }).report;
  assert.ok(report.results.some((result) => result.completion !== "complete"));
  const forwarded = appendCallOutcome(doc, call, "return");
  const checked = typecheck(
    loadProject(file, { buffers: { [file]: forwarded } }),
  );
  assert.equal(
    checked.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
  const wrong = describe(
    source.replace(
      "flow main(n: Nat) -> Result<Bool, Error>",
      "flow main(n: Nat) -> Unit",
    ),
  );
  const wrongCall = wrong.blocks.find((b) => b.title === "main").sections[0]
    .blocks[0];
  assert.equal(wrongCall.callResult.canReturn, false);
  assert.throws(
    () => appendCallOutcome(wrong, wrongCall, "return"),
    /does not match/,
  );
});

test("a yes/no call offers an honest decision, while other result types refuse it", async () => {
  const { appendCallOutcome } = await import(
    "../dist/studio/block-document.js"
  );
  const { parse } = await import("../dist/language/parser.js");
  const describe = (text) =>
    describeBlocks(
      typecheck(loadProject(file, { buffers: { [file]: text } })),
      file,
    );
  const text =
    "op allowed() -> Bool; flow main() -> Unit { call allowed() as answer; return unit; }";
  const doc = describe(text),
    call = doc.blocks[1].sections[0].blocks[0];
  assert.equal(call.callResult.canDecide, true);
  const edited = appendCallOutcome(doc, call, "decide");
  const parsed = parse(file, edited);
  assert.deepEqual(parsed.diagnostics, []);
  const body = parsed.declarations[1].body;
  assert.equal(body[1].kind, "if");
  assert.equal(body[1].test.name, "answer");
  assert.equal(body[1].yes[0].kind, "unknown");
  assert.equal(body[1].no[0].kind, "unknown");
  assert.equal(body[2].kind, "return");
  const other = describe(text.replace("-> Bool", "-> Nat"));
  assert.equal(
    other.blocks[1].sections[0].blocks[0].callResult.canDecide,
    false,
  );
  assert.throws(
    () =>
      appendCallOutcome(other, other.blocks[1].sections[0].blocks[0], "decide"),
    /yes\/no/,
  );
});

test("large outcome sets stay explicit rather than generating a partial handler", async () => {
  const { appendCallOutcome } = await import(
    "../dist/studio/block-document.js"
  );
  const variants = Array.from({ length: 41 }, (_, i) => `Case${i}`).join(" | ");
  const text = `type Cases = ${variants}; op choose() -> Cases; flow main() -> Unit { call choose() as answer; }`;
  const doc = describeBlocks(
    typecheck(loadProject(file, { buffers: { [file]: text } })),
    file,
  );
  const call = doc.blocks[2].sections[0].blocks[0];
  assert.equal(call.callResult.outcomeCount, 41);
  assert.equal(call.callResult.outcomes.length, 40);
  assert.throws(
    () => appendCallOutcome(doc, call, "handle"),
    /cannot be expanded/,
  );
});

test("an existing direct outcome step cannot be inserted twice", async () => {
  const { appendCallOutcome } = await import(
    "../dist/studio/block-document.js"
  );
  const describe = (text) =>
    describeBlocks(
      typecheck(loadProject(file, { buffers: { [file]: text } })),
      file,
    );
  const original = describe(source);
  const handled = describe(
    appendCallOutcome(
      original,
      original.blocks[2].sections[0].blocks[0],
      "handle",
    ),
  );
  const call = handled.blocks[2].sections[0].blocks[0];
  assert.equal(call.callResult.hasOutcomeStep, true);
  assert.throws(() => appendCallOutcome(handled, call, "handle"), /already/);
  // A different binding's handler does not hide this call's actions.
  const other = describe(
    source.replace(
      "call send(n) as outcome;",
      'call send(n) as other; match other { Ok(v) => { unknown "success"; } Busy => { unknown "retry"; } Rejected(e) => { unknown "reject"; } } call send(n) as outcome;',
    ),
  );
  assert.equal(
    other.blocks[2].sections[0].blocks.at(-1).callResult.hasOutcomeStep,
    false,
  );
});
