// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import { lower, replay } from "../dist/behaviour/model.js";
import { canonicalState, explore, sample } from "../dist/behaviour/explore.js";
import { runExplore } from "../dist/behaviour/explore-runner.js";
function fixture(source) {
  const dir = mkdtempSync(join(tmpdir(), "pym-explore-"));
  try {
    const file = join(dir, "main.pym");
    writeFileSync(file, source);
    const { ir } = analyseFile(file);
    assert.deepEqual(ir.diagnostics, []);
    const plan = lower(ir, "M");
    assert.equal(plan.kind, "supported");
    return { model: plan.model, ir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const branching = `machine M {
  state n: Nat in 0..4 = 0;
  event advance when n < 4 { n = n + 1; }
  event shortcut when n == 0 { n = 3; }
  invariant safe = n < 4;
  invariant bounded = n <= 4;
}`;

test("exhaustive exact counts, deadlock stutter, and all properties pass", () => {
  const { ir } = analyseFile("test/fixtures/explore/counter.pym");
  const { model } = lower(ir, "Counter");
  const result = explore(model);
  assert.equal(result.completion, "complete");
  assert.deepEqual(result.properties, [
    { property: "bounded", verdict: "passed" },
  ]);
  assert.equal(result.domain.verdict, "passed");
  assert.deepEqual(result.measurements, {
    statesVisited: 5,
    transitionsTaken: 5,
    depthReached: 4,
    samples: 0,
  });
  assert.equal(
    explore(model, { stateBudget: 5 }).completion,
    "complete",
    "exact capacity can still finish",
  );
});
test("per-property verdicts, deterministic shortest witness, source replay", () => {
  const { model } = fixture(branching);
  const result = explore(model);
  assert.deepEqual(explore(model), result);
  const failed = result.properties.find((p) => p.property === "safe");
  assert.equal(failed.verdict, "violated");
  assert.equal(failed.trace.length - 1, 2);
  assert.equal(replay(model, failed.trace).valid, true);
  assert.deepEqual(
    failed.trace.map((t) => t.values.n),
    [0n, 3n, 4n],
  );
  assert.equal(
    result.properties.find((p) => p.property === "bounded").verdict,
    "passed",
  );
});
test("budget never passes unviolated properties and retains validated violations", () => {
  const { model } = fixture(branching);
  const result = explore(model, { stateBudget: 2 });
  assert.equal(result.completion, "state_budget");
  assert.equal(result.measurements.statesVisited, 2);
  assert.ok(
    [...result.properties, result.domain].every(
      (p) => p.verdict === "incomplete",
    ),
  );
  const initialFailure = fixture(
    `machine M { state n: Nat in 0..4 = 0; event next when n < 4 { n = n + 1; } invariant fail = false; invariant hold = true; }`,
  ).model;
  const limited = explore(initialFailure, { stateBudget: 1 });
  assert.equal(
    limited.properties.find((p) => p.property === "fail").verdict,
    "violated",
  );
  assert.equal(
    limited.properties.find((p) => p.property === "hold").verdict,
    "incomplete",
  );
  assert.equal(limited.properties[0].trace.length, 1);
});
test("domain violation is separate, replayed, and leaves other claims unresolved", () => {
  const { model } = fixture(
    `machine M { state n: Nat in 0..1 = 0; event next when n <= 1 { n = n + 1; } invariant hold = true; invariant fail = n <= 1; }`,
  );
  const result = explore(model);
  assert.equal(result.completion, "domain_boundary");
  assert.equal(result.domain.verdict, "violated");
  assert.equal(
    result.properties.find((p) => p.property === "hold").verdict,
    "incomplete",
  );
  assert.equal(
    result.properties.find((p) => p.property === "fail").verdict,
    "violated",
  );
  assert.equal(replay(model, result.domain.trace).domainViolations.length, 1);
  assert.equal(result.measurements.statesVisited, 3);
});
test("sampler fixed seed fixes walks; samples never claim exhaustive pass", () => {
  const { model } = fixture(branching);
  const options = { seed: "42", maxSteps: 8, maxSamples: 40 };
  const result = sample(model, options);
  assert.deepEqual(sample(model, options), result);
  assert.notEqual(
    sample(model, { ...options, seed: "43" }).sampling.fingerprint,
    result.sampling.fingerprint,
  );
  assert.equal(result.measurements.samples, 40);
  assert.equal(
    result.properties.find((p) => p.property === "safe").verdict,
    "violated",
  );
  assert.equal(
    result.properties.find((p) => p.property === "bounded").verdict,
    "no_violation_found",
  );
  assert.equal(result.domain.verdict, "no_violation_found");
  for (const p of result.properties.filter((p) => p.trace))
    assert.equal(replay(model, p.trace).valid, true);
  assert.ok(
    !JSON.stringify(result, (_, v) =>
      typeof v === "bigint" ? String(v) : v,
    ).includes('"passed"'),
  );
});
test("indexed equality guards preserve event order, reversed guards and simultaneous updates", () => {
  const { model } = fixture(`machine M {
    state x: Nat in 0..1 = 0; state y: Nat in 0..1 = 1;
    event a when 0 == x { x = y; y = x; }
    event b when x == 0 { x = 1; }
    event c when x == 1 && y == 0 { y = 1; }
    invariant fail = x == 0;
  }`);
  const result = explore(model);
  assert.equal(result.measurements.statesVisited, 3);
  assert.deepEqual(result.properties[0].trace.at(-1).values, { x: 1n, y: 0n });
  assert.equal(replay(model, result.properties[0].trace).valid, true);
  assert.equal(
    canonicalState({ b: true, a: 1n }),
    canonicalState({ a: 1n, b: true }),
  );
  assert.notEqual(canonicalState({ a: 1n }), canonicalState({ a: "1" }));
});
test("failed replay is an engine error, never a counterexample", () => {
  const { model } = fixture(branching);
  const broken = {
    ...model,
    events: model.events.map((e) => ({ ...e, index: 99 })),
  };
  const result = explore(broken);
  assert.equal(result.completion, "engine_error");
  assert.match(result.error, /replay/);
  assert.ok(
    result.properties.every((p) => p.verdict === "incomplete" && !p.trace),
  );
});
test("flow violation needs original IR for source replay", () => {
  const dir = mkdtempSync(join(tmpdir(), "pym-explore-flow-"));
  try {
    const file = join(dir, "main.pym");
    writeFileSync(file, "flow f() -> Unit { assert false; return unit; }");
    const { ir } = analyseFile(file);
    const plan = lower(ir, "f");
    assert.equal(plan.kind, "supported");
    assert.equal(explore(plan.model).completion, "engine_error");
    const result = explore(plan.model, {}, ir);
    assert.equal(result.completion, "complete");
    const violation = result.properties.find((p) => p.verdict === "violated");
    assert.equal(replay(plan.model, violation.trace, ir).valid, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
function controlledClock() {
  let callback,
    cleared = false;
  return {
    now: () => 100,
    setTimeout: (fn) => {
      callback = fn;
      return 1;
    },
    clearTimeout: (handle) => {
      assert.equal(handle, 1);
      cleared = true;
    },
    fire: () => callback(),
    get cleared() {
      return cleared;
    },
  };
}
// 2^53 states: no natural completion can race the readiness-triggered cancellation.
const enormous = () =>
  fixture(
    `machine M { state n: Nat in 0..9007199254740991 = 0; event next when n < 9007199254740991 { n = n + 1; } invariant hold = true; }`,
  );
test("real worker/production runner cancels only after readiness, with no timing assumptions", async () => {
  const { model } = enormous();
  const controller = new AbortController(),
    clock = controlledClock();
  let ready = false;
  const output = await runExplore(
    {
      method: "exhaustive",
      model,
      options: { stateBudget: Number.MAX_SAFE_INTEGER },
    },
    {
      clock,
      signal: controller.signal,
      onReady: () => {
        ready = true;
        queueMicrotask(() => controller.abort());
      },
    },
  );
  assert.equal(ready, true);
  assert.equal(output.result.completion, "cancelled");
  assert.equal(output.result.measurements, null);
  assert.ok(
    [...output.result.properties, output.result.domain].every(
      (p) => p.verdict === "incomplete",
    ),
  );
  assert.equal(clock.cleared, true);
});
test("controlled timeout terminates real worker; successful workers return direct engine results", async () => {
  const { model } = enormous(),
    clock = controlledClock();
  const timeout = await runExplore(
    { method: "exhaustive", model },
    { clock, onReady: () => clock.fire() },
  );
  assert.equal(timeout.result.completion, "timed_out");
  assert.equal(timeout.result.domain.verdict, "incomplete");
  assert.equal(clock.cleared, true);
  const small = fixture(branching);
  const request = { method: "exhaustive", ...small };
  assert.deepEqual(
    (await runExplore(request)).result,
    explore(small.model, {}, small.ir),
  );
  const sampled = {
    method: "sample",
    ...small,
    options: { seed: "42", maxSteps: 4, maxSamples: 5 },
  };
  assert.deepEqual(
    (await runExplore(sampled)).result,
    sample(small.model, sampled.options, small.ir),
  );
});
test("invalid options fail explicitly and pre-aborted runs stay incomplete", async () => {
  const { model } = fixture(branching);
  assert.equal(explore(model, { stateBudget: 0 }).completion, "engine_error");
  assert.equal(
    sample(model, { seed: "a", maxSteps: -1, maxSamples: 1 }).completion,
    "engine_error",
  );
  let ready = false;
  const result = await runExplore(
    { method: "exhaustive", model },
    {
      signal: AbortSignal.abort(),
      onReady: () => {
        ready = true;
      },
    },
  );
  assert.equal(result.result.completion, "cancelled");
  assert.equal(ready, false);
});
