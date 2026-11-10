import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import { compareCost, compareReports } from "../dist/reporting/compare.js";
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "pym-compare-"));
  const file = join(dir, "main.pym");
  const read = async (body) => {
    await writeFile(file, body);
    return analyseFile(file).report;
  };
  try {
    await fn(read);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const old =
  "op read() -> Unit cost calls exact 1; flow main(N: Nat) -> Unit bound N <= 5 { for i in N { call read(); call read(); call read(); } }";
const newer =
  "op read() -> Unit cost calls exact 1; flow main(N: Nat) -> Unit bound N <= 5 { call read(); for i in N { call read(); call read(); } }";
const cost = (r) =>
  r.results.find((p) => p.propertyId.endsWith("#main/cost/calls"));
test("work comparison uses exact integer arithmetic under matching bounds and contracts", () =>
  fixture(async (read) => {
    const a = await read(old),
      b = await read(newer);
    const c = compareCost(cost(b), cost(a));
    assert.equal(c.comparable, true);
    assert.equal(c.previousMaximum, "15");
    assert.equal(c.currentMaximum, "11");
    assert.equal(c.difference, "-4");
  }));
test("changing bounds or cost assumptions blocks a like-for-like reduction claim", () =>
  fixture(async (read) => {
    const original = await read(old);
    const changedBound = await read(newer.replace("<= 5", "<= 10"));
    const changedCost = await read(newer.replace("exact 1", "exact 2"));
    assert.equal(
      compareCost(cost(changedBound), cost(original)).difference,
      null,
    );
    assert.ok(
      compareCost(cost(changedBound), cost(original)).reasons.includes(
        "Different input bounds",
      ),
    );
    assert.ok(
      compareCost(cost(changedCost), cost(original)).reasons.includes(
        "Different cost assumptions",
      ),
    );
  }));
test("a missing finding in an incomplete run is not treated as proof of a fix", () =>
  fixture(async (read) => {
    const a = await read(
        "op f(n: Nat) -> Unit; flow main() -> Unit { call f(true); }",
      ),
      b = await read('flow main() -> Unit { unknown "not decided"; }');
    const comparison = compareReports(b, a);
    assert.equal(comparison.hasIncomplete, true);
    assert.ok(comparison.notReported.length > 0);
  }));

test("report comparison counts repeated identical findings and includes removed sources", () =>
  fixture(async (read) => {
    const a = await read(
        "op f(n: Nat) -> Unit; flow main() -> Unit { call f(true); call f(true); }",
      ),
      b = await read(
        "op f(n: Nat) -> Unit; flow main() -> Unit { call f(true); }",
      );
    assert.equal(
      compareReports(b, a).notReported.filter((d) => d.code === "T002").length,
      1,
    );
    const extra = { file: "/removed.pym", hash: "old", text: "" };
    a.snapshot.files.push(extra);
    assert.ok(compareReports(b, a).changedFiles.includes(extra.file));
    assert.equal(compareReports(b, a).coverageChanged, true);
  }));

test("different behavioural seeds and scopes remain visible in a report comparison", () =>
  fixture(async (read) => {
    const a = await read(old),
      b = structuredClone(a);
    b.results[0].scope.seed = "73";
    assert.equal(compareReports(b, a).scopeChanged, true);
    assert.equal(compareReports(a, a).scopeChanged, false);
  }));

test("removing a finding property does not invent a scope change in other checks", () =>
  fixture(async (read) => {
    const a = await read(old),
      b = structuredClone(a);
    b.results = b.results.slice(1);
    assert.equal(compareReports(b, a).scopeChanged, false);
  }));

test("a cancelled typed-only report remains incomplete even when its emitted properties completed", () =>
  fixture(async (read) => {
    const complete = await read(old);
    const partial = structuredClone(complete);
    partial.session.state = "Cancelled";
    partial.results = partial.results.filter(
      (r) => r.analysisKind === "types-effects-outcomes",
    );
    assert.ok(partial.results.every((r) => r.completion === "complete"));
    assert.equal(compareReports(complete, partial).hasIncomplete, true);
    assert.equal(compareReports(partial, complete).hasIncomplete, true);
  }));
