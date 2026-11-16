// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const call = async (c, name, args) => {
  const r = await c.callTool({ name, arguments: args });
  assert.equal(r.isError, undefined, JSON.stringify(r));
  return r.structuredContent ?? JSON.parse(r.content[0].text);
};
test("agent checks report affected plans against the proposed source and preserve uninspected scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-agent-plan-impact-"));
  let client, service;
  const source =
    "type Input = { count: Nat }; flow execute(input: Input) -> Unit { return unit; }";
  try {
    await writeFile(join(root, "main.pym"), source);
    await writeFile(
      join(root, "other.pym"),
      "flow other() -> Unit { return unit; }",
    );
    service = new StudioService(root);
    const first = await service.savePlanItem(
      "",
      {
        ...newPlanItem("A"),
        title: "Run a request",
        acceptance: "Receives a count",
        links: [{ kind: "depends-on", target: "source:main.pym#execute" }],
      },
      "Plan",
      new AbortController().signal,
    );
    await service.savePlanItem(
      first.id,
      {
        ...newPlanItem("B"),
        title: "Independent work",
        acceptance: "Separate",
        links: [{ kind: "depends-on", target: "source:other.pym#other" }],
      },
      "Independent",
      new AbortController().signal,
    );
    await service.close();
    service = null;
    client = new Client({ name: "plan-impact", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const search = await call(client, "read_architecture", {
      section: "search",
      query: "Run a request",
    });
    assert.equal(search.recordMatches[0].id, "plan:A");
    const changed = await call(client, "check_design", {
      file: "main.pym",
      checkScope: "entry",
      buffers: { "main.pym": source.replace("count: Nat", "count: String") },
    });
    assert.equal(changed.planImpact.affectedPlanCount, 1);
    assert.equal(changed.planImpact.outsideScopePlanCount, 1);
    assert.equal(changed.planImpact.items[0].planId, "plan:A");
    assert.equal(changed.planImpact.items[0].kind, "changed-target");
    const details = await call(client, "read_run", {
      runId: changed.runId,
      section: "plan_impact",
    });
    assert.equal(details.items[0].planId, "plan:A");
    const formatting = await call(client, "check_design", {
      file: "main.pym",
      checkScope: "entry",
      buffers: { "main.pym": "// only a comment\n" + source },
    });
    assert.equal(formatting.planImpact.affectedPlanCount, 0);
    const retained = await call(client, "read_run", {
      runId: changed.runId,
      section: "plan_impact",
    });
    assert.equal(retained.architectureRevision, details.architectureRevision);
    assert.deepEqual(retained.items, details.items);
    assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  } finally {
    await client?.close();
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});
