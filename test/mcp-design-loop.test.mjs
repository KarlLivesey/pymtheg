// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeWorkspace } from "../dist/project/workspace.js";
import { connect } from "./fixtures/mcp-graph/client.mjs";
const machine =
  "machine Counter { state n: Nat in 0..2 = 0; event add when n < 2 { n = n + 1; } invariant bounded = n <= 2; }";
const good = machine + "\nflow next(n: Nat) -> Nat { return n + 1; }\n";
test("MCP-only design loop: ordinary source edits, diagnostic/hint, check, try without runId, verify and simulate", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-r1c-design-"));
  let s;
  try {
    await initializeWorkspace(root, "MCP design loop");
    s = await connect(root);
    await writeFile(
      join(root, "counter.pym"),
      good.replace("n + 1; }\n", "n - 1; }\n"),
    );
    const bad = await s.call("check_design", { file: "counter.pym" });
    assert.ok(bad.findings.errors > 0);
    const findings = await s.call("read_run", {
      runId: bad.runId,
      section: "findings",
    });
    assert.ok(findings.items.some((d) => d.code === "T002"));
    assert.match(JSON.stringify(findings.items), /Nat|natural/);
    assert.ok(findings.items.some((d) => d.nextStep));
    const invalid = await s.call("try_inputs", {
      file: "counter.pym",
      entry: "next",
      inputs: { n: "1" },
    });
    assert.equal(invalid.result.completion, "incomplete");
    await writeFile(join(root, "counter.pym"), good);
    const checked = await s.call("check_design", { file: "counter.pym" });
    assert.equal(checked.exitStatus, 0);
    const trial = await s.call("try_inputs", {
      file: "counter.pym",
      entry: "next",
      inputs: { n: "41" },
    });
    assert.equal(trial.result.completion, "complete");
    assert.equal(String(trial.result.output), "42");
    const old = await s.call("try_inputs", {
      runId: checked.runId,
      entry: "next",
      inputs: { n: "9" },
    });
    assert.equal(String(old.result.output), "10");
    const overlay = await s.call("try_inputs", {
      file: "unsaved.pym",
      buffers: { "unsaved.pym": "flow twice(n: Nat) -> Nat { return n + n; }" },
      entry: "twice",
      inputs: { n: "3" },
    });
    assert.equal(String(overlay.result.output), "6");
    await writeFile(
      join(root, "contract.pym"),
      "op charge(n: Nat) -> Unit requires n > 0; flow pay(n: Nat) -> Unit { call charge(n); return unit; }",
    );
    const violation = await s.call("try_inputs", {
      file: "contract.pym",
      entry: "pay",
      inputs: { n: "0" },
    });
    assert.equal(violation.result.completion, "violated");
    assert.equal(violation.result.violation.code, "precondition");
    for (const method of ["verify", "simulate"]) {
      const run = await s.call("explore_behaviour", {
        file: "counter.pym",
        entry: "Counter",
        method,
        maxSteps: 4,
        maxSamples: 10,
        seed: "42",
      });
      assert.equal(run.results.exhaustive, method === "verify");
      if (method === "simulate") assert.match(run.meaning, /not exhaustive/);
      const properties = await s.call("read_run", {
        runId: run.runId,
        section: "properties",
      });
      const evidence = properties.items.filter(
        (p) => p.analysisKind === "behaviour",
      );
      assert.ok(evidence.length);
      assert.ok(evidence.every((p) => p.exhaustive === (method === "verify")));
      assert.ok(
        evidence.every(
          (p) =>
            p.completion === "complete" && p.outcome === "no_counterexample",
        ),
        JSON.stringify(properties),
      );
      assert.ok(
        evidence.every(
          (p) =>
            p.method ===
            (method === "verify" ? "finite_model_check" : "simulation"),
        ),
      );
    }
    if (process.env.R1C_EVIDENCE)
      await writeFile(
        join(process.env.R1C_EVIDENCE, "design-loop.json"),
        JSON.stringify(s.log, null, 2) + "\n",
      );
  } finally {
    await s?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("every documented MCP call executes as written, including explicit legacy refusals", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-r1c-docs-"));
  let s;
  try {
    await initializeWorkspace(root, "Documented MCP examples");
    s = await connect(root);
    const markdown = await readFile("docs/mcp.md", "utf8");
    const blocks = [
      ...markdown.matchAll(/```js\n\/\/ verified-mcp\n([\s\S]*?)```/g),
    ].map((m) => m[1]);
    assert.ok(blocks.length > 0);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const refuse = async (name, args) => {
      const r = await s.raw(name, args);
      assert.equal(r.result.isError, true, JSON.stringify(r));
      return r;
    };
    await new AsyncFunction(
      "call",
      "write",
      "expect",
      "refuse",
      blocks.join("\n"),
    )(
      s.call,
      (file, text) => writeFile(join(root, file), text),
      (condition) => assert.ok(condition),
      refuse,
    );
    const tools = (await s.client.listTools()).tools.map((t) => t.name);
    const exercised = new Set(s.log.map((e) => e.name));
    assert.deepEqual(
      tools.filter((name) => !exercised.has(name)),
      [],
      "Every registered tool needs an executed documentation example",
    );
    if (process.env.R1C_EVIDENCE)
      await writeFile(
        join(process.env.R1C_EVIDENCE, "documented-calls.json"),
        JSON.stringify(
          s.log.map((e) => ({
            name: e.name,
            args: e.args,
            bytes: e.bytes,
            isError: e.isError,
          })),
          null,
          2,
        ) + "\n",
      );
  } finally {
    await s?.close();
    await rm(root, { recursive: true, force: true });
  }
});
