import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../dist/language/parser.js";
test("parser retains exact editable signature spans without including body or cancellation text", () => {
  const source =
    "// 😀 Unicode before the declaration\nflow route(amount: Nat // quantity\n, reason: String) -> Bool effects(io.Log) bound amount <= 100 {\n  // handwritten body\n  return true;\n} on cancel { return false; }";
  const parsed = parse("/design.pym", source);
  assert.deepEqual(parsed.diagnostics, []);
  const flow = parsed.declarations[0];
  const text = (s) => source.slice(s.start, s.end);
  assert.equal(text(flow.nameSpan), "route");
  assert.equal(
    text(flow.paramsSpan),
    "(amount: Nat // quantity\n, reason: String)",
  );
  assert.deepEqual(flow.meta.effectSpans.map(text), ["effects(io.Log)"]);
  assert.equal(text(flow.result.span), "Bool");
  assert.match(source.slice(flow.paramsSpan.end), /handwritten body/);
  assert.match(
    source.slice(flow.paramsSpan.end),
    /on cancel \{ return false; \}/,
  );
});
