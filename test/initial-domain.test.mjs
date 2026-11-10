import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { analyseFile } from "../dist/analysis/index.js";
import { exitStatus } from "../dist/reporting/report.js";
import { lower, evaluate } from "../dist/behaviour/model.js";
const file = "/tmp/initial-domain.pym";
const source = (value) =>
  `machine Counter {\n  state count: Int in 1..2 = ${value};\n  invariant safe = true;\n}\n`;
const model = (text) =>
  analyseFile(file, () => {}, { buffers: { [file]: text } });
test("out-of-range starting constants are located local design errors and block lowering", () => {
  for (const value of ["0", "3", "1 + 2", "-2", "2 * 2"]) {
    const { ir, report } = model(source(value));
    const finding = report.diagnostics.find((d) => d.code === "B012");
    assert.ok(finding, value);
    assert.equal(
      source(value).slice(finding.span.start, finding.span.end),
      value,
    );
    assert.match(finding.message, /outside.*1\.\.2/);
    assert.equal(exitStatus(report), 1);
    assert.equal(lower(ir, "Counter").kind, "incomplete");
  }
  for (const value of ["1", "2", "3 - 1"])
    assert.equal(exitStatus(model(source(value)).report), 0);
  const unknown = model(source('unknown "choose a starting value"'));
  assert.equal(
    unknown.report.diagnostics.some((d) => d.code === "B012"),
    false,
  );
  assert.notEqual(exitStatus(unknown.report), 0);
});
test("initial constant comparison and event replay use the same scalar evaluator", () => {
  const { ir } = model(source("3 - 1"));
  const machine = ir.declarations.find((d) => d.kind === "machine");
  assert.equal(evaluate(machine.states[0].init, {}), 2n);
});
test("CLI and real MCP retain an initial-domain design error instead of an unlocated warning", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-init-domain-"));
  let client;
  try {
    await writeFile(join(root, "main.pym"), source("0"));
    const cli = spawnSync(
      process.execPath,
      [resolve("dist/cli/main.js"), "check", join(root, "main.pym")],
      { encoding: "utf8" },
    );
    assert.equal(cli.status, 1, cli.stdout + cli.stderr);
    assert.match(cli.stdout, /main.pym:2:30.*B012/);
    client = new Client({ name: "initial-domain", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const call = async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      return r.structuredContent ?? JSON.parse(r.content[0].text);
    };
    const run = await call("check_design", { file: "main.pym" });
    assert.equal(run.exitStatus, 1);
    const findings = await call("read_run", {
      runId: run.runId,
      section: "findings",
    });
    assert.ok(findings.items.some((d) => d.code === "B012"));
    const behaviour = await call("explore_behaviour", {
      file: "main.pym",
      entry: "Counter",
      method: "simulate",
    });
    assert.equal(behaviour.exitStatus, 1);
    const result = await call("read_run", {
      runId: behaviour.runId,
      section: "findings",
    });
    assert.ok(result.items.some((d) => d.code === "B012"));
    const pendingSource =
      "op use(n: Nat) -> Unit requires n > 0 effects(remote.Net);\nflow caller(n: Nat) -> Unit effects(remote.Net) {\n  call use(n);\n  return unit;\n}\n";
    await writeFile(join(root, "main.pym"), pendingSource);
    const pendingCli = spawnSync(
      process.execPath,
      [resolve("dist/cli/main.js"), "check", join(root, "main.pym")],
      { encoding: "utf8" },
    );
    assert.equal(pendingCli.status, 2, pendingCli.stdout + pendingCli.stderr);
    assert.match(
      pendingCli.stdout,
      /Establish use precondition at .*main.pym:3:3/,
    );
    const pendingRun = await call("check_design", { file: "main.pym" });
    const properties = await call("read_run", {
      runId: pendingRun.runId,
      section: "properties",
    });
    assert.ok(
      properties.items.some((item) =>
        item.outstandingObligations?.some((text) => /main.pym:3:3/.test(text)),
      ),
    );
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
