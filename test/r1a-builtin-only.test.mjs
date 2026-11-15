// R1-A: options for another command are refused, engine errors exit 3, sampled
// runs say they are not exhaustive (text and JSON), and doctor probes what the
// product actually loads.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nodeCheck } from "../dist/project/doctor.js";
import { StudioService } from "../dist/studio/service.js";
import { AgentWorkspace } from "../dist/mcp/workspace.js";

const cliFile = resolve("dist/cli/main.js");
const failWorker = resolve("test/fixtures/r1a/fail-explore-worker.mjs");
const counter = "test/fixtures/explore/counter.pym";
const cli = (args, { preload, cwd, main = cliFile } = {}) => {
  const result = spawnSync(
    process.execPath,
    [...(preload ? ["--import", preload] : []), main, ...args],
    { encoding: "utf8", cwd, maxBuffer: 64 * 1024 * 1024 },
  );
  assert.ifError(result.error);
  return result;
};
const behaviour = (stdout) =>
  JSON.parse(stdout).results.filter((r) => r.analysisKind === "behaviour");

test("options that belong to another command are refused", () => {
  for (const [args, message] of [
    [
      ["verify", counter, "--entry", "Counter", "--seed", "1"],
      /--seed is available for simulate only/,
    ],
    [
      ["check", counter, "--seed", "1"],
      /--seed is available for simulate only/,
    ],
    [
      ["verify", counter, "--entry", "Counter", "--max-steps", "3"],
      /--max-steps is available for simulate only/,
    ],
    [
      ["check", counter, "--max-samples", "3"],
      /--max-samples is available for simulate only/,
    ],
    [
      ["simulate", counter, "--entry", "Counter", "--state-budget", "10"],
      /--state-budget is available for verify only/,
    ],
    [
      ["check", counter, "--state-budget", "10"],
      /--state-budget is available for verify only/,
    ],
    [
      ["check", counter, "--target", "json"],
      /--target is available for emit only/,
    ],
    [
      ["verify", counter, "--entry", "Counter", "--target", "json"],
      /--target is available for emit only/,
    ],
  ]) {
    const result = cli(args);
    assert.equal(result.status, 3, args.join(" ") + result.stderr);
    assert.match(result.stderr, message, args.join(" "));
  }
});
test("the removed external-engine options are unknown", () => {
  for (const option of ["--backend", "--tlc-jar", "--quint"]) {
    const result = cli(["verify", counter, "--entry", "Counter", option, "x"]);
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, new RegExp(`Unknown option ${option}`));
  }
});
test("a built-in worker error is a B104 failure with exit 3, never a verdict", () => {
  for (const command of ["verify", "simulate"]) {
    const result = cli(
      [command, counter, "--entry", "Counter", "--format", "json"],
      { preload: failWorker },
    );
    assert.equal(result.status, 3, result.stdout + result.stderr);
    const records = behaviour(result.stdout);
    assert.ok(records.length > 0);
    for (const r of records) {
      assert.equal(r.completion, "failed");
      assert.equal(r.outcome, "inconclusive");
      assert.equal(r.exhaustive, false);
      assert.ok(
        r.diagnostics.some((d) => d.code === "B104" && d.severity === "error"),
      );
    }
  }
});
test("text output marks a sampled pass as not exhaustive", () => {
  const sampled = cli(["simulate", counter, "--entry", "Counter"]);
  assert.equal(sampled.status, 0, sampled.stderr);
  assert.match(
    sampled.stdout,
    /no_counterexample \(simulation, sampled, not exhaustive\)/,
  );
  assert.doesNotMatch(sampled.stdout, /\(simulation, complete\)/);
  const verified = cli(["verify", counter, "--entry", "Counter"]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(
    verified.stdout,
    /no_counterexample \(finite_model_check, complete\)/,
  );
});
test("CLI JSON: exhaustive is false for every sampled or stopped search and true only for a completed verify", () => {
  const sampled = behaviour(
    cli(["simulate", counter, "--entry", "Counter", "--format", "json"]).stdout,
  );
  assert.ok(sampled.length > 0);
  for (const r of sampled) {
    assert.equal(r.method, "simulation");
    assert.equal(r.completion, "complete");
    assert.equal(r.outcome, "no_counterexample");
    assert.equal(r.exhaustive, false);
  }
  const verified = behaviour(
    cli(["verify", counter, "--entry", "Counter", "--format", "json"]).stdout,
  );
  assert.ok(
    verified.every((r) => r.exhaustive === true && r.completion === "complete"),
  );
  const budget = behaviour(
    cli([
      "verify",
      counter,
      "--entry",
      "Counter",
      "--state-budget",
      "2",
      "--format",
      "json",
    ]).stdout,
  );
  assert.ok(
    budget.every(
      (r) => r.exhaustive === false && r.completion === "incomplete",
    ),
  );
});
const machine =
  "machine Counter { state n: Nat in 0..4 = 0; event advance when n < 4 { n = n + 1; } invariant bounded = n <= 4; }\n";
test("MCP and Studio results carry the same exhaustive field", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-r1a-exhaustive-"));
  try {
    await writeFile(join(root, "main.pym"), machine);
    const agent = new AgentWorkspace(root);
    for (const [kind, expected] of [
      ["simulate", false],
      ["verify", true],
    ]) {
      const run = await agent.run(
        { kind, file: "main.pym", buffers: {}, entry: "Counter", scope: {} },
        new AbortController().signal,
      );
      const summary = agent.summary(run);
      assert.equal(summary.exitStatus, 0);
      assert.equal(summary.results.exhaustive, expected);
      if (kind === "simulate") assert.match(summary.meaning, /not exhaustive/);
      const records = run.report.results.filter(
        (r) => r.analysisKind === "behaviour",
      );
      assert.ok(
        records.length > 0 && records.every((r) => r.exhaustive === expected),
      );
    }
    const studio = new StudioService(root);
    for (const [kind, expected] of [
      ["simulate", false],
      ["verify", true],
    ]) {
      const finished = new Promise((resolve) => {
        const off = studio.subscribe((e) => {
          if (
            e.kind === "run" &&
            e.run.status !== "running" &&
            e.run.request.kind === kind
          ) {
            off();
            resolve(e.run);
          }
        });
      });
      await studio.start({
        clientId: "r1a",
        revision: 0,
        file: "main.pym",
        buffers: {},
        kind,
        entry: "Counter",
        seed: "42",
        maxSteps: 6,
        maxSamples: 20,
      });
      const run = await finished;
      assert.equal(run.status, "completed");
      const records = run.report.results.filter(
        (r) => r.analysisKind === "behaviour",
      );
      assert.ok(
        records.length > 0 && records.every((r) => r.exhaustive === expected),
        kind,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("doctor's Node check accepts 24 or newer and refuses older versions", () => {
  for (const version of ["v24.0.0", "v24.21.0", "v25.2.1", "v26.0.0"]) {
    const check = nodeCheck(version);
    assert.equal(check.status, "ready", version);
    assert.match(check.detail, /24 or newer/);
  }
  for (const version of ["v23.11.0", "v22.0.0"]) {
    const check = nodeCheck(version);
    assert.equal(check.status, "incompatible", version);
    assert.match(check.detail, /not supported: Pymtheg needs Node 24 or newer/);
  }
});
const doctor = (options) => {
  const result = cli(["doctor", "--format", "json"], options);
  return {
    status: result.status,
    report: JSON.parse(result.stdout),
    stderr: result.stderr,
  };
};
const byName = (report) =>
  Object.fromEntries(report.checks.map((c) => [c.name, c]));
test("doctor reports the engines, storage and every code graph language as ready", () => {
  const { status, report, stderr } = doctor();
  const checks = byName(report);
  for (const name of [
    "Node",
    "Verifier",
    "Simulator",
    "Storage",
    "Go code graph",
    "Rust code graph",
    "TypeScript code graph",
  ])
    assert.equal(checks[name]?.status, "ready", JSON.stringify(checks[name]));
  assert.equal(report.ready, true);
  assert.equal(status, 0, stderr);
});
test("doctor exits 3 when an engine probe fails", () => {
  const { status, report } = doctor({ preload: failWorker });
  const checks = byName(report);
  assert.equal(checks.Verifier.status, "failed");
  assert.equal(checks.Simulator.status, "failed");
  assert.equal(report.ready, false);
  assert.equal(status, 3);
});
test("doctor exits 3 when the vendored Rust grammar is missing or corrupt", async () => {
  // A copy of the built product, so the language module resolves its own
  // grammar relative to its compiled file exactly as an installed package does.
  const root = await mkdtemp(join(tmpdir(), "pym-r1a-doctor-"));
  try {
    await cp("dist", join(root, "dist"), { recursive: true });
    await cp("grammars", join(root, "grammars"), { recursive: true });
    await cp("package.json", join(root, "package.json"));
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    const project = join(root, "project");
    await mkdir(project);
    const main = join(root, "dist/cli/main.js");
    const grammar = join(root, "grammars/rust/tree-sitter-rust.wasm");
    const control = doctor({ main, cwd: project });
    assert.equal(byName(control.report)["Rust code graph"].status, "ready");
    assert.equal(control.status, 0, JSON.stringify(control.report));
    for (const damage of ["corrupt", "missing"]) {
      if (damage === "corrupt") await writeFile(grammar, "not a wasm module");
      else await rm(grammar);
      const { status, report } = doctor({ main, cwd: project });
      const checks = byName(report);
      assert.equal(checks["Rust code graph"].status, "failed", damage);
      assert.equal(checks["Go code graph"].status, "ready", damage);
      assert.equal(report.ready, false);
      assert.equal(status, 3, damage);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
