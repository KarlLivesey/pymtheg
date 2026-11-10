import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import { compileFlow, flowGraph } from "../dist/behaviour/flow.js";
function model(source, scope = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pym-flow-"));
  try {
    const file = join(dir, "m.pym");
    writeFileSync(file, source);
    const { ir } = analyseFile(file);
    assert.deepEqual(
      ir.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    return flowGraph(compileFlow(ir, "main", scope));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("source assertions expose real branch outcomes", () => {
  const graph = model(
    "flow main(flag: Bool) -> Unit { if flag { assert true; } else { assert false; } }",
  );
  assert.ok(graph.states.some((s) => s.error?.code === "assertion"));
  assert.ok(graph.states.some((s) => s.status === "returned"));
});
test("tagged outcomes and nested calls share source semantics", () => {
  const graph = model(
    "type E = Failed; op choose() -> Result<Unit, E>; flow inner() -> Result<Unit, E> { call choose() as r; propagate r; } flow main() -> Unit { call inner() as r; match r { Ok(v) => { assert true; } Failed => { assert false; } } }",
  );
  assert.ok(graph.states.some((s) => s.status === "violated"));
  assert.ok(graph.edges.some((e) => e.operation === "choose"));
});
test("bounded loops include zero iterations and short circuiting", () => {
  const graph = model(
    "flow main(N: Nat) -> Unit bound N <= 2 { for i in N { assert i < 2; } assert true || false; }",
  );
  assert.equal(
    graph.states.some((s) => s.status === "violated"),
    false,
  );
  assert.equal(graph.initial.length, 3);
});
const resourceSource =
  "resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; Closed -> Closed; } type E = Failed; op open() -> Result<File,E> effects(state.File) creates result; ";
test("resource creation, failure, and cancellation are preserved in execution", () => {
  const graph = model(
    resourceSource +
      "flow main() -> Unit effects(state.File) { call open() as r; match r { Ok(f) => { transition f -> Closed; return unit; } Failed => { return unit; } } } on cancel { transition f -> Closed; }",
  );
  assert.ok(graph.states.some((s) => s.status === "cancelled"));
  assert.ok(graph.states.some((s) => s.status === "returned"));
  assert.equal(
    graph.states.some((s) => s.error?.code === "resource"),
    false,
  );
});
test("returning without cleanup creates a resource counterexample", () => {
  const graph = model(
    resourceSource +
      "flow main() -> Unit effects(state.File) { call open() as r; match r { Ok(f) => { return unit; } Failed => { return unit; } } } on cancel { transition f -> Closed; }",
  );
  assert.ok(graph.states.some((s) => s.error?.code === "resource"));
});
test("abstract postconditions restrict outcomes, while rule contracts are actually checked", () => {
  const g = model(
    "op pick() -> Bool ensures result; flow main() -> Unit { call pick() as answer; assert answer; }",
  );
  assert.equal(
    g.states.some((s) => s.status === "violated"),
    false,
  );
  assert.ok(
    g.assumptions.some((assumption) =>
      /Postconditions.*assumed/.test(assumption),
    ),
    "Restricting abstract outcomes must retain the assumed guarantee as evidence",
  );
  const invalid = model(
    "rule requirePositive(n: Nat) -> Bool requires n > 0 = true; flow main(n: Nat) -> Unit bound n <= 1 { assert requirePositive(n); }",
  );
  assert.ok(invalid.states.some((s) => s.error?.code === "precondition"));
});
test("finite inputs cannot silently exceed declared cardinality or invent fields", () => {
  assert.throws(
    () =>
      model("flow main(n: Nat) -> Unit bound n <= 2 { assert n < 3; }", {
        inputs: { n: [3] },
      }),
    /exceeds its declared bound/,
  );
  assert.throws(
    () =>
      model("type R = { ok: Bool }; flow main(r: R) -> Unit { assert r.ok; }", {
        inputs: { r: [{ ok: true, extra: false }] },
      }),
    /Unknown field/,
  );
});
test("a flow without business properties cannot masquerade as five safety passes", async () => {
  const { lower } = await import("../dist/behaviour/model.js");
  const dir = mkdtempSync(join(tmpdir(), "pym-vacuity-"));
  try {
    const file = join(dir, "plain.pym");
    writeFileSync(file, "flow main() -> Unit { return unit; }");
    const { ir } = analyseFile(file);
    const plan = lower(ir, "main");
    assert.equal(plan.kind, "supported");
    assert.deepEqual(
      plan.model.properties.map((p) => p.source),
      ["executionSafe"],
    );
    assert.ok(
      plan.model.assumptions.some((a) =>
        a.includes("no business-safety claim"),
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("external effect atomicity must be a visible source decision", () => {
  assert.throws(
    () =>
      model(
        "op remote() -> Unit effects(network.Service); flow main() -> Unit effects(network.Service) { call remote(); assert true; }",
      ),
    /explicit atomic assumption or link a protocol/,
  );
  const graph = model(
    "op remote() -> Unit effects(network.Service) atomic; flow main() -> Unit effects(network.Service) { call remote(); assert true; }",
  );
  assert.ok(
    graph.assumptions.some((a) =>
      a.includes("atomic boundary explicitly assumed"),
    ),
  );
});
