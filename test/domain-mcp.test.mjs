// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("MCP preserves a source-mapped range counterexample and its trace after a corrected run", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-domain-agent-"));
  let client;
  const source =
    "machine Counter {\n state n: Nat in 0..2 = 0;\n event inc when true {\n  n = n + 1;\n }\n invariant small = n <= 2;\n}\n";
  try {
    await writeFile(join(root, "counter.pym"), source);
    client = new Client({ name: "range-evidence-test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const call = async (name, arguments_) => {
      const answer = await client.callTool({ name, arguments: arguments_ });
      assert.equal(answer.isError, undefined, JSON.stringify(answer));
      return answer.structuredContent ?? JSON.parse(answer.content[0].text);
    };
    const run = await call("explore_behaviour", {
      file: "counter.pym",
      entry: "Counter",
      method: "simulate",
      maxSteps: 8,
      maxSamples: 100,
    });
    assert.equal(run.exitStatus, 1);
    const properties = await call("read_run", {
      runId: run.runId,
      section: "properties",
    });
    const domain = properties.items.find((p) =>
      p.propertyId.endsWith("/state-domains"),
    );
    assert.equal(domain.completion, "complete");
    assert.equal(domain.witnessValidation, "source_replayed");
    const findings = await call("read_run", {
      runId: run.runId,
      section: "findings",
    });
    const finding = findings.items.find((f) => f.code === "B011");
    assert.equal(finding.location.line, 4);
    assert.match(finding.nextStep, /guard/);
    const trace = await call("read_run", {
      runId: run.runId,
      section: "trace",
      propertyId: domain.propertyId,
    });
    assert.equal(trace.total, 4);
    assert.deepEqual(
      trace.steps.slice(1).map((s) => s.operation),
      ["inc", "inc", "inc"],
    );
    assert.equal(String(trace.steps.at(-1).values.n), "3");
    const fixed = await call("explore_behaviour", {
      file: "counter.pym",
      buffers: { "counter.pym": source.replace("when true", "when n < 2") },
      entry: "Counter",
      method: "simulate",
      maxSteps: 8,
      maxSamples: 100,
    });
    assert.equal(fixed.exitStatus, 0);
    const retained = await call("read_run", {
      runId: run.runId,
      section: "trace",
      propertyId: domain.propertyId,
    });
    assert.deepEqual(retained.steps, trace.steps);
    assert.equal(await readFile(join(root, "counter.pym"), "utf8"), source);
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
