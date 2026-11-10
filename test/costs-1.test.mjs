import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
function cost(source) {
  const d = mkdtempSync(join(tmpdir(), "pym-cost-bind-"));
  try {
    const f = join(d, "x.pym");
    writeFileSync(f, source);
    return analyseFile(f).report.results.find((r) =>
      r.propertyId.includes("#main/cost/"),
    ).witnessOrDerivation;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}
test("local list and size aliases preserve cardinalities", () => {
  assert.equal(
    cost(
      "op tick() -> Unit cost calls exact 1; flow main() -> Unit { let items = [1,2,3]; for item in items { call tick(); } }",
    ).maximum,
    "3",
  );
  assert.equal(
    cost(
      "op tick() -> Unit cost calls exact 1; flow main(N: Nat) -> Unit bound N <= 5 { let size = N; for i in size { call tick(); } }",
    ).maximum,
    "5",
  );
});

test("operation cost substitution uses caller-local values and list aliases", () => {
  assert.equal(
    cost(
      "op batch(count: Nat) -> Unit cost calls exact count; flow main() -> Unit { let size = 3; call batch(size); }",
    ).maximum,
    "3",
  );
  assert.equal(
    cost(
      "op batch(items: List<Nat>) -> Unit cost calls exact items.count; flow main() -> Unit { let items = [2,5,8]; let copy = items; call batch(copy); }",
    ).maximum,
    "3",
  );
  assert.equal(
    cost(
      "op batch(count: Nat) -> Unit cost calls exact count; flow main(n: Nat) -> Unit bound n <= 5 { let twice = n * 2; call batch(twice); }",
    ).maximum,
    "10",
  );
});
