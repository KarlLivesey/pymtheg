// SPDX-License-Identifier: MIT
import "./isolated-config.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
test("real MCP agrees with negative-list trials, surfaces mixed caller findings and retains partial code", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-mcp-loop-sound-"));
  let client;
  try {
    client = new Client({ name: "loop-soundness", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const call = async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      assert.equal(r.isError, undefined, JSON.stringify(r));
      return r.structuredContent ?? JSON.parse(r.content[0].text);
    };
    const source =
      "op r(q: Int) -> Unit requires q >= 0; flow f(xs: List<Int>) -> Unit bound xs <= 3 { for x in xs { call r(x); } return unit; }";
    const checked = await call("check_design", {
      file: "lists.pym",
      buffers: { "lists.pym": source },
    });
    const properties = await call("read_run", {
      runId: checked.runId,
      section: "properties",
    });
    const property = properties.items.find((p) =>
      p.propertyId.includes("/call-contract/"),
    );
    assert.ok(property);
    assert.equal(property.outcome, "counterexample");
    assert.equal(property.witnessValidation, "source_replayed");
    const trial = await call("try_inputs", {
      runId: checked.runId,
      entry: "f",
      inputs: { xs: ["-5"] },
    });
    assert.equal(trial.result.completion, "violated");
    assert.match(trial.result.message, /Call precondition failed/);
    assert.equal(trial.result.violation.code, "precondition");
    assert.equal(trial.result.violation.span.file, "lists.pym");
    assert.equal(
      trial.result.violation.span.start,
      source.indexOf("call r(x)"),
    );
    assert.equal(trial.result.violation.condition.file, "lists.pym");
    assert.equal(
      trial.result.violation.condition.start,
      source.indexOf("q >= 0"),
    );
    const echoRun = await call("check_design", {
      file: "echo.pym",
      buffers: {
        "echo.pym":
          "type D = { file: String }; flow echo(d: D) -> D { return d; }",
      },
    });
    const echo = await call("try_inputs", {
      runId: echoRun.runId,
      entry: "echo",
      inputs: { d: { file: "/literal/model/value" } },
    });
    assert.equal(echo.result.completion, "complete");
    assert.equal(echo.result.output.fields.file, "/literal/model/value");
    const mixed = await call("check_design", {
      file: "mixed.pym",
      buffers: {
        "mixed.pym":
          "op r(patient: String, q: Nat) -> Unit requires q > 0; flow f(patient: String, n: Nat) -> Unit { call r(patient,n); return unit; }",
      },
    });
    const findings = await call("read_run", {
      runId: mixed.runId,
      section: "findings",
    });
    assert.ok(
      findings.items.some(
        (d) => d.code === "C004" && /source inputs.*n.*0/.test(d.message),
      ),
    );
    const unsupported = await call("check_design", {
      file: "unknown.pym",
      buffers: {
        "unknown.pym":
          'op r(s: String) -> Unit requires s != "" effects(remote.Net); flow f(s: String) -> Unit effects(remote.Net) { call r(s); return unit; }',
      },
    });
    const unresolved = await call("read_run", {
      runId: unsupported.runId,
      section: "findings",
    });
    assert.ok(
      unresolved.items.some(
        (d) => d.code === "C007" && /unresolved/.test(d.why),
      ),
    );
    await assert.rejects(access(join(root, "lists.pym")), { code: "ENOENT" });
    await writeFile(
      join(root, "good.ts"),
      "export function ready(){return true;}",
    );
    await writeFile(join(root, "vendor.js"), " ".repeat(2 * 1024 * 1024 + 1));
    await call("observe_implementation", {
      files: ["good.ts", "vendor.js"],
      label: "Partially captured",
      expectedRevision: null,
      trust: "source-only",
    });
    const graph = await call("read_implementation", {
      section: "graph",
      mode: "existing",
    });
    assert.equal(graph.coverage.declarations, "partial");
    assert.ok(graph.items.some((n) => n.name === "ready"));
    assert.match(
      graph.limitations.join("\n"),
      /vendor.js.*2 MiB|2 MiB.*vendor.js/,
    );
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
