// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import { exitStatus } from "../dist/reporting/report.js";
const file = "/tmp/guarantee-feasibility.pym";
const check = (source) =>
  analyseFile(file, () => {}, { buffers: { [file]: source } }).report;
test("contradictory scalar return assumptions are located design errors", () => {
  for (const source of [
    "op mk() -> Int ensures result > 5 && result < 3;",
    "op mk() -> Nat ensures result < 0;",
    "op mk() -> Bool ensures result ensures !result;",
    "op mk() -> Bool ensures result == true && result == false;",
    "op mk() -> Bool ensures false != result ensures result == false;",
    "op mk(n: Int) -> Int requires n > 5 ensures n < 3;",
    "op mk() -> Int ensures result > 5 ensures 3 > result;",
  ]) {
    const report = check(source);
    const error = report.diagnostics.find((d) => d.code === "V002");
    assert.ok(error, source);
    assert.equal(exitStatus(report), 1, source);
    assert.ok(source.slice(error.span.start, error.span.end).length);
    assert.equal(
      report.results.find((r) => r.propertyId.endsWith("/postconditions"))
        .outcome,
      "counterexample",
    );
  }
});
test("consistent or unsupported return assumptions are not called contradictions", () => {
  for (const source of [
    "op mk() -> Int ensures result >= 5 && result <= 5;",
    "op mk() -> Int ensures result > 5 || result < 3;",
    "op mk(n: Int) -> Int ensures result == n;",
  ])
    assert.equal(
      check(source).diagnostics.some((d) => d.code === "V002"),
      false,
      source,
    );
});
