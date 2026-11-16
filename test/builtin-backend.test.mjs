// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import { lower, replay } from "../dist/behaviour/model.js";
import { runBackend } from "../dist/backends/adapter.js";
const file = "test/fixtures/builtin-backend/branching.pym";
const options = {
  entry: "M",
  seed: "42",
  maxSteps: 6,
  maxSamples: 40,
  timeoutMs: 120000,
  scopeFile: null,
};
const run = (
  ir,
  extra = {},
  signal = new AbortController().signal,
  hooks = {},
) => runBackend(ir, { ...options, ...extra }, signal, hooks);
const property = (records, name) =>
  records.find((r) => r.propertyId.endsWith("/" + name));
test("default adapter uses worker BFS, preserves shortest replay and independent holding property", async () => {
  const { ir } = analyseFile(file);
  const records = await run(ir);
  const failed = property(records, "safe");
  assert.equal(failed.outcome, "counterexample");
  assert.equal(failed.witnessValidation, "source_replayed");
  assert.deepEqual(
    failed.witnessOrDerivation.states.map((s) => s.values.n),
    [0n, 3n, 4n],
  );
  assert.equal(
    replay(lower(ir, "M").model, failed.witnessOrDerivation.states, ir).valid,
    true,
  );
  const holding = property(records, "bounded");
  assert.equal(holding.outcome, "no_counterexample");
  assert.equal(holding.completion, "complete");
  assert.equal(holding.witnessOrDerivation.verdict, "passed");
  assert.equal(holding.measurements.distinctStates, 5);
});
test("state budget is named and unresolved, not a safety pass", async () => {
  const { ir } = analyseFile(file);
  const records = await run(ir, { stateBudget: 2 });
  assert.ok(
    records.every(
      (r) => r.outcome === "inconclusive" && r.completion === "incomplete",
    ),
  );
  assert.ok(
    records.every((r) =>
      r.outstandingObligations.some((s) => s.includes("stateBudget=2")),
    ),
  );
});
test("sample results preserve deterministic seed, counts and fingerprints and never claim exhaustive pass", async () => {
  const { ir } = analyseFile(file);
  const first = await run(ir, { method: "sample" });
  const second = await run(ir, { method: "sample" });
  assert.deepEqual(
    first.map((r) => r.witnessOrDerivation),
    second.map((r) => r.witnessOrDerivation),
  );
  assert.ok(
    first.every(
      (r) =>
        r.method === "simulation" && r.witnessOrDerivation.verdict !== "passed",
    ),
  );
  assert.equal(
    property(first, "bounded").witnessOrDerivation.sampling.maxSamples,
    40,
  );
  assert.equal(property(first, "bounded").measurements.samples, 40);
  assert.equal(property(first, "bounded").scope.seed, "42");
});
test("production coordinator cancellation, controlled timeout and worker errors map every property to unresolved; worker errors are failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pym-builtin-cancel-"));
  try {
    const huge = join(dir, "huge.pym");
    // 2^53 reachable states: this worker cannot naturally finish before cancellation.
    writeFileSync(
      huge,
      `machine M { state n: Nat in 0..9007199254740991 = 0; event next when n < 9007199254740991 { n = n + 1; } invariant hold = true; }`,
    );
    const { ir } = analyseFile(huge);
    for (const kind of ["cancelled", "timed_out", "engine_error"]) {
      const controller = new AbortController();
      let fire,
        ready = false,
        cleared = false;
      const clock = {
        now: () => 100,
        setTimeout: (fn) => {
          fire = fn;
          return 1;
        },
        clearTimeout: () => {
          cleared = true;
        },
      };
      const records = await run(
        ir,
        { stateBudget: Number.MAX_SAFE_INTEGER },
        controller.signal,
        {
          clock,
          onReady: () => {
            ready = true;
            if (kind === "cancelled") queueMicrotask(() => controller.abort());
            else if (kind === "timed_out") fire();
            else throw Error("controlled worker hook failure");
          },
        },
      );
      assert.equal(ready, true);
      assert.equal(cleared, true);
      assert.ok(records.every((r) => r.outcome === "inconclusive"));
      assert.ok(
        records.every(
          (r) => r.completion === (kind === "engine_error" ? "failed" : kind),
        ),
      );
      assert.ok(
        records.every((r) =>
          r.diagnostics.some(
            (d) =>
              d.code ===
              { cancelled: "B130", timed_out: "B124", engine_error: "B104" }[
                kind
              ],
          ),
        ),
      );
      assert.ok(
        records.every(
          (r) =>
            r.measurements.distinctStates === undefined &&
            !r.witnessOrDerivation.states,
        ),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("default CLI verify and simulate need no external program on PATH", () => {
  const env = { ...process.env, PATH: "" };
  for (const command of ["verify", "simulate"]) {
    const output = spawnSync(
      process.execPath,
      [
        "dist/cli/main.js",
        command,
        "test/fixtures/explore/counter.pym",
        "--entry",
        "Counter",
        "--format",
        "json",
      ],
      { env, encoding: "utf8" },
    );
    assert.equal(output.status, 0, output.stderr + output.stdout);
    const records = JSON.parse(output.stdout).results.filter(
      (r) => r.analysisKind === "behaviour",
    );
    assert.ok(records.length > 0);
    assert.ok(
      records.every(
        (r) =>
          r.toolVersions.engine === "builtin" &&
          r.completion === "complete" &&
          r.outcome === "no_counterexample",
      ),
    );
    assert.ok(
      records.every(
        (r) =>
          r.method ===
          (command === "verify" ? "finite_model_check" : "simulation"),
      ),
    );
  }
});

test("sampler preflight remains a simulation result", async () => {
  const { ir } = analyseFile(file);
  const records = await run(ir, { entry: "Missing", method: "sample" });
  assert.equal(records[0].method, "simulation");
  assert.equal(records[0].completion, "unsupported");
  assert.equal(records[0].outcome, "inconclusive");
});
