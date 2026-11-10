import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../dist/language/parser.js";
test("the canonical parser retains exact nested body boundaries for block edits", () => {
  const text =
    'flow main(n: Nat) -> Unit { // keep this } comment\n if n > 0 { for i in n { unknown "a } in text"; } } else { return unit; } } on cancel { unknown "cleanup"; }';
  const parsed = parse("design.pym", text);
  assert.deepEqual(parsed.diagnostics, []);
  const flow = parsed.declarations[0];
  const conditional = flow.body[0];
  const loop = conditional.yes[0];
  for (const span of [
    flow.bodySpan,
    flow.cancelSpan,
    conditional.yesSpan,
    conditional.noSpan,
    loop.bodySpan,
  ]) {
    assert.ok(span);
    assert.equal(text[span.start], "{");
    assert.equal(text[span.end - 1], "}");
  }
  assert.ok(
    text
      .slice(flow.bodySpan.start, flow.bodySpan.end)
      .includes("keep this } comment"),
  );
  assert.ok(
    !text.slice(flow.bodySpan.start, flow.bodySpan.end).includes("cleanup"),
  );
});
