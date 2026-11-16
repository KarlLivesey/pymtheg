// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import {
  lower,
  initial,
  step,
  evaluate,
  replay,
  sourceMappingValid,
} from "../dist/behaviour/model.js";
import { scopeIssueResult } from "../dist/reporting/scope-issues.js";
const file = "/tmp/unused-scope.pym";
const source =
  "op mk() -> Int ensures result > 5; op need(v: Int) -> Int requires v > 0; flow main() -> Int { call mk() as c; let k = c - 10; call need(k) as d; return d; }";
const scope = { results: { mk: ["6"], need: ["1"] } };
const model = (text) =>
  analyseFile(file, () => {}, { buffers: { [file]: text } });
test("unused return scope cannot discard a graph with a real source violation", () => {
  const { ir } = model(source),
    plan = lower(ir, "main", scope);
  assert.equal(plan.kind, "supported");
  const m = plan.model;
  assert.equal(sourceMappingValid(m, ir), true);
  assert.deepEqual(m.flow.graph.scopeIssues, [
    "Unused results scope key need; it did not constrain this flow",
  ]);
  const target = BigInt(
    m.flow.graph.states.findIndex((s) => s.error?.code === "precondition") + 1,
  );
  assert.ok(target > 0n);
  const queue = [[{ values: initial(m.machine), event: -2 }]],
    seen = new Set();
  let found;
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i],
      value = path.at(-1).values;
    if (value.state === target) {
      found = path;
      break;
    }
    if (seen.has(String(value.state))) continue;
    seen.add(String(value.state));
    for (const event of m.machine.events)
      if (evaluate(event.guard, value) === true) {
        queue.push([
          ...path,
          {
            values: step(m.machine, value, event.name),
            event: m.events.find((e) => e.source === event.name).index,
          },
        ]);
      }
  }
  assert.ok(found);
  const validated = replay(m, found, ir);
  assert.equal(validated.valid, true);
  assert.ok(validated.violated.includes("callContractsHold"));
  const issue = scopeIssueResult(ir, m);
  assert.equal(issue.completion, "incomplete");
  assert.equal(issue.outcome, "inconclusive");
  assert.equal(issue.diagnostics[0].code, "B014");
  assert.equal(issue.diagnostics[0].severity, "warning");
});
test("safe unused entries and malformed used values remain refused", () => {
  const { ir } = model(source.replace("c - 10", "c"));
  const corrected = lower(ir, "main", scope);
  assert.equal(corrected.kind, "supported");
  assert.equal(scopeIssueResult(ir, corrected.model), null);
  const typo = lower(ir, "main", {
    results: { mk: ["6"], need: ["1"], typo: ["1"] },
  });
  assert.equal(typo.kind, "incomplete");
  assert.match(typo.reasons.join(" "), /Unused results scope key typo/);
  const wrong = lower(ir, "main", { results: { mk: ["wrong"], need: ["1"] } });
  assert.equal(wrong.kind, "incomplete");
});
