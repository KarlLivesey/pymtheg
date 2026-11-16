// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import { lower, sourceMappingValid } from "../dist/behaviour/model.js";
import {
  compileFlow,
  flowGraph,
  graphMachine,
} from "../dist/behaviour/flow.js";
import { json } from "../dist/shared/identity.js";

const root = resolve(import.meta.dirname, "..");
const fixture = join(root, "test/fixtures/flow-lowering-pure/calls-op.pym");
const discovery = join(root, "examples/self/discovery.pym");
const cases = [
  [fixture, "stampOnce"],
  [fixture, "stampTwice"],
  [fixture, "idle"],
  [discovery, "selectSourceTree"],
];

function analysed(file) {
  const { ir } = analyseFile(file);
  assert.deepEqual(
    ir.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  return ir;
}
const snapshot = (ir) =>
  json({ declarations: ir.declarations, symbols: [...ir.symbols] });

for (const [file, entry] of cases) {
  const name = `${file.split("/").at(-1)}#${entry}`;

  test(`${name}: lowering twice gives identical models and leaves the IR unchanged`, () => {
    const ir = analysed(file);
    const before = snapshot(ir);
    const scope = {};
    const first = lower(ir, entry, scope);
    const second = lower(ir, entry, scope);
    assert.equal(first.kind, "supported", JSON.stringify(first.reasons));
    assert.equal(second.kind, "supported");
    assert.equal(first.model.hash, second.model.hash);
    assert.equal(json(first.model), json(second.model));
    assert.equal(snapshot(ir), before);
    assert.deepEqual(scope, {});
  });

  test(`${name}: graphMachine does not change its plan or graph`, () => {
    const ir = analysed(file);
    const plan = compileFlow(ir, entry, {});
    const graph = flowGraph(plan);
    const graphBefore = json(graph);
    const assumptionsBefore = [...plan.assumptions];
    const machine = graphMachine(plan, graph);
    assert.equal(json(graph), graphBefore);
    assert.deepEqual([...plan.assumptions], assumptionsBefore);
    // A fresh, unexplored plan (as the backend precheck uses) gives the same
    // machine and still leaves the stored graph alone.
    const again = graphMachine(compileFlow(ir, entry, {}), graph);
    assert.equal(json(again), json(machine));
    assert.equal(json(graph), graphBefore);
  });

  test(`${name}: the backend source-mapping precheck accepts the model and keeps its hash`, () => {
    const ir = analysed(file);
    const lowered = lower(ir, entry, {});
    assert.equal(lowered.kind, "supported");
    const model = lowered.model;
    const stored = json(model);
    assert.equal(sourceMappingValid(model, ir), true);
    assert.equal(json(model), stored);
    // A second check must not see a model changed by the first.
    assert.equal(sourceMappingValid(model, ir), true);
    assert.equal(json(model), stored);
  });
}

test("executionSafe flows that call an operation keep the execution assumption", () => {
  const ir = analysed(fixture);
  const lowered = lower(ir, "stampOnce", {});
  assert.equal(lowered.kind, "supported");
  assert.ok(
    lowered.model.properties.some((p) => p.name === "executionSafe") ||
      json(lowered.model.machine).includes("executionSafe"),
  );
  assert.ok(
    lowered.model.flow.graph.assumptions.some((a) =>
      a.startsWith("No explicit assertion"),
    ),
  );
  assert.ok(
    lowered.model.assumptions.some((a) =>
      a.startsWith("No explicit assertion"),
    ),
  );
});

for (const [file, entry] of [
  [fixture, "stampOnce"],
  [discovery, "selectSourceTree"],
]) {
  test(`${file.split("/").at(-1)}#${entry}: verify reports no B106 and the baseline verdict`, () => {
    const p = spawnSync(
      process.execPath,
      [
        join(root, "dist/cli/main.js"),
        "verify",
        file,
        "--entry",
        entry,
        "--format",
        "json",
        "--timeout",
        "120s",
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const report = JSON.parse(p.stdout);
    const codes = JSON.stringify(report).match(/"B106"/g) ?? [];
    assert.deepEqual(codes, [], p.stdout.slice(0, 2000));
    const result = report.results.find((r) => r.analysisKind === "behaviour");
    assert.ok(result, p.stdout.slice(0, 2000));
    assert.equal(result.propertyId, `${file}#${entry}/invariant/executionSafe`);
    assert.equal(result.outcome, "no_counterexample");
    assert.equal(result.completion, "complete");
    assert.equal(p.status, 0, p.stdout.slice(0, 2000));
  });
}
