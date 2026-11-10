import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const jar =
  process.env.PYM_TLC_JAR ?? "/tmp/spec-language-research/tla2tools.jar";
for (const method of ["simulate", "verify"])
  test(
    `MCP ${method}: agent reads a real lost-ack trace then checks the correction`,
    { skip: method === "verify" && !existsSync(jar) },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "pym-mcp-backend-"));
      const source = await readFile("examples/mvp/task-protocol.pym", "utf8");
      await writeFile(join(root, "task.pym"), source);
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        env: { ...process.env, PYM_TLC_JAR: jar },
        stderr: "pipe",
      });
      const client = new Client({ name: "agent-journey", version: "1" });
      const tool = async (name, args) => {
        const r = await client.callTool(
          { name, arguments: args },
          { timeout: 120000 },
        );
        assert.equal(r.isError, undefined, JSON.stringify(r));
        return r.structuredContent;
      };
      try {
        await client.connect(transport);
        const bad = await tool("explore_behaviour", {
          file: "task.pym",
          entry: "retryJob",
          method,
          maxSteps: 30,
          maxSamples: 1000,
          seed: "42",
        });
        const properties = await tool("read_run", {
          runId: bad.runId,
          section: "properties",
        });
        if (properties.items.some((p) => p.completion === "timed_out")) {
          t.skip(
            "Explicit checker budget exhausted; property remains unresolved",
          );
          return;
        }
        const violation = properties.items.find(
          (p) =>
            p.outcome === "counterexample" &&
            p.witnessValidation === "source_replayed",
        );
        assert.ok(violation);
        assert.ok(violation.propertyId.startsWith("task.pym#"));
        if (method === "verify") {
          assert.equal(violation.scope.seed, undefined);
          assert.equal(violation.scope.bounds.maxSamples, undefined);
          assert.equal(violation.scope.bounds.maxSteps, undefined);
        }
        const trace = await tool("read_run", {
          runId: bad.runId,
          section: "trace",
          propertyId: violation.propertyId,
          limit: 50,
        });
        assert.ok(trace.steps.length > 1);
        assert.ok(trace.steps.some((e) => e.operation.includes("perform")));
        assert.ok(
          trace.steps.every((e) => !e.span || e.span.file === "task.pym"),
        );
        const fixed = await tool("explore_behaviour", {
          file: "task.pym",
          entry: "cautiousJob",
          method,
          maxSteps: 30,
          maxSamples: 1000,
          seed: "42",
        });
        const checked = await tool("read_run", {
          runId: fixed.runId,
          section: "properties",
        });
        if (checked.items.some((p) => p.completion === "timed_out")) {
          t.skip(
            "Explicit checker budget exhausted; property remains unresolved",
          );
          return;
        }
        const evidence = checked.items.filter(
          (p) => p.analysisKind === "behaviour",
        );
        assert.ok(evidence.length);
        assert.ok(evidence.every((p) => p.outcome === "no_counterexample"));
        assert.ok(
          evidence.every(
            (p) =>
              p.method ===
              (method === "simulate" ? "simulation" : "finite_model_check"),
          ),
        );
      } finally {
        await client.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
test("MCP trace retrieval preserves native integer states", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-mcp-native-"));
  await writeFile(
    join(root, "counter.pym"),
    "machine Counter { state n: Nat in 0..2 = 0; event add when n < 2 { n = n + 1; } invariant limit = n <= 1; }",
  );
  const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/cli/main.js"), "mcp", root],
      stderr: "pipe",
    }),
    client = new Client({ name: "trace-integers", version: "1" });
  try {
    await client.connect(transport);
    const r = await client.callTool({
      name: "explore_behaviour",
      arguments: {
        file: "counter.pym",
        entry: "Counter",
        method: "simulate",
        maxSteps: 6,
        maxSamples: 100,
      },
    });
    assert.equal(r.isError, undefined);
    const trace = await client.callTool({
      name: "read_run",
      arguments: { runId: r.structuredContent.runId, section: "trace" },
    });
    assert.equal(trace.isError, undefined, JSON.stringify(trace));
    assert.equal(trace.structuredContent.steps.at(-1).values.n, "2");
    assert.ok(
      trace.structuredContent.steps
        .at(-1)
        .changes.some(
          (c) => c.name === "n" && c.before === "1" && c.after === "2",
        ),
    );
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
