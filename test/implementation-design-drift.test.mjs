import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
test("retained design source and live drift agree across gaps, comparison and MCP", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-design-drift-"));
  let service = new StudioService(root),
    client;
  const signal = new AbortController().signal;
  try {
    const source = "flow limit(qty: Nat) -> Bool { return qty <= 50; }";
    await writeFile(join(root, "limit.pym"), source);
    await writeFile(
      join(root, "limit.ts"),
      "export function limit(qty:number):boolean { return qty<=50; }",
    );
    let saved = await service.savePlanItem(
      "",
      {
        ...newPlanItem("P"),
        title: "Limit quantity",
        links: [{ kind: "depends-on", target: "source:limit.pym#limit" }],
      },
      "Plan",
      signal,
    );
    await service.observeImplementation(
      { files: ["limit.ts"], label: "Before", expectedRevision: saved.id },
      signal,
    );
    let page = await service.implementationGraph({ mode: "gaps" }, signal);
    const node = (
      await service.implementationGraph({ mode: "existing" }, signal)
    ).items[0];
    for (const id of ["plan:P", "source:limit.pym#limit"]) {
      page = await service.implementationGraph({ mode: "gaps" }, signal);
      const row = page.items.find((r) => r.id === id);
      await service.linkImplementation(
        {
          revision: page.activeRevision,
          planId: id,
          nodeId: node.id,
          planHash: row.planHash,
          observationId: page.observationId,
          note: "Review",
        },
        signal,
      );
    }
    page = await service.implementationGraph({ mode: "gaps" }, signal);
    assert.ok(page.items.every((i) => !i.statuses.includes("design-changed")));
    await writeFile(join(root, "limit.pym"), source.replace("50", "40"));
    await writeFile(
      join(root, "limit.ts"),
      "export function limit(qty:number):boolean { return qty<=40; }",
    );
    await service.observeImplementation(
      {
        files: ["limit.ts"],
        label: "After",
        expectedRevision: page.activeRevision,
      },
      signal,
    );
    page = await service.implementationGraph(
      { mode: "gaps", detailId: "source:limit.pym#limit" },
      signal,
    );
    assert.match(page.detail.text, /qty <= 50/);
    assert.ok(!page.detail.text.includes('"kind"'));
    for (const id of ["plan:P", "source:limit.pym#limit"]) {
      const row = page.items.find((i) => i.id === id);
      assert.ok(row.statuses.includes("design-changed"));
      assert.ok(row.statuses.includes("code-changed"));
      const compared = await service.implementationComparison(
        {
          planRevision: page.planRevision,
          codeRevision: page.codeRevision,
          planId: id,
          nodeId: node.id,
        },
        signal,
      );
      assert.ok(
        compared.design.issues.some((i) => i.kind === "changed-target"),
      );
      assert.match(compared.design.current[0].source, /qty <= 40/);
      if (id.startsWith("source:"))
        assert.match(compared.plan.text, /qty <= 50/);
    }
    await service.close();
    service = null;
    client = new Client({ name: "design-drift", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const result = await client.callTool({
      name: "read_implementation",
      arguments: { section: "graph", mode: "gaps" },
    });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const live = result.structuredContent ?? JSON.parse(result.content[0].text);
    assert.ok(
      live.items
        .find((i) => i.id === "plan:P")
        .statuses.includes("design-changed"),
    );
  } finally {
    await client?.close();
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});
