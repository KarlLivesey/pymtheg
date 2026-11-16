// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
function check(src) {
  const d = mkdtempSync(join(tmpdir(), "pym-contract-"));
  try {
    const p = join(d, "x.pym");
    writeFileSync(p, src);
    return analyseFile(p).report;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}
test("caller and branch facts discharge scalar preconditions", () => {
  const r = check(
    "op positive(x: Int) -> Unit requires x > 0; flow f(x: Int) -> Unit { if x > 0 { call positive(x); } }",
  );
  assert.equal(
    r.results.find((r) => r.analysisKind === "call-contract").outcome,
    "established",
  );
});
test("bad and good concrete returns have different evidence", () => {
  const a = check(
    "flow f(x: Nat) -> Nat ensures result >= x { return x + 1; }",
  );
  assert.equal(
    a.results.find((r) => r.analysisKind === "contracts").outcome,
    "established",
  );
  const b = check("flow f() -> Int ensures result > 0 { return -1; }");
  assert.ok(b.diagnostics.some((d) => d.code === "C005"));
});
