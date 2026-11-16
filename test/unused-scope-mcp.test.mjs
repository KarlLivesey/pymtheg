// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
test("MCP retains the real trace alongside an unused-scope warning", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-unused-scope-mcp-"));
  let client;
  try {
    await writeFile(
      join(root, "main.pym"),
      "op mk() -> Int ensures result > 5; op need(v: Int) -> Int requires v > 0; flow main() -> Int { call mk() as c; let k = c - 10; call need(k) as d; return d; }",
    );
    client = new Client({ name: "unused-scope", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const call = async (name, args) => {
      const response = await client.callTool({ name, arguments: args });
      assert.equal(response.isError, undefined, JSON.stringify(response));
      return response.structuredContent ?? JSON.parse(response.content[0].text);
    };
    const run = await call("explore_behaviour", {
      file: "main.pym",
      entry: "main",
      method: "simulate",
      scope: { results: { mk: ["6"], need: ["1"] } },
      maxSteps: 20,
      maxSamples: 100,
      timeoutMs: 45000,
    });
    assert.equal(run.exitStatus, 1);
    const properties = await call("read_run", {
      runId: run.runId,
      section: "properties",
    });
    const witness = properties.items.find(
      (item) =>
        item.outcome === "counterexample" && item.analysisKind === "behaviour",
    );
    assert.ok(witness);
    assert.equal(witness.witnessValidation, "source_replayed");
    assert.ok(
      properties.items.some(
        (item) =>
          item.analysisKind === "scope-validation" &&
          item.completion === "incomplete",
      ),
    );
    const trace = await call("read_run", {
      runId: run.runId,
      section: "trace",
      propertyId: witness.propertyId,
    });
    assert.ok(trace.steps.length > 1);
    assert.ok(
      trace.steps.some((step) => String(step.operation).includes("need")),
    );
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
