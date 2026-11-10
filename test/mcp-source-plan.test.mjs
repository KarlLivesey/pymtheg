import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";

test("MCP source comparison uses an explicit plan and never treats an absent baseline as unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-mcp-source-plan-"));
  let service = new StudioService(root),
    client;
  try {
    const source =
      "type Money = { cents: Nat }; type Order = { total: Money }; flow charge(order: Order) -> Bool { return order.total.cents > 0; }";
    await writeFile(join(root, "pay.pym"), source);
    const item = (id) => ({
      ...newPlanItem(id),
      title: id,
      links: [{ kind: "depends-on", target: "source:pay.pym#charge" }],
    });
    let saved = await service.savePlanItem(
      "",
      item("A"),
      "A",
      new AbortController().signal,
    );
    saved = await service.savePlanItem(
      saved.id,
      item("B"),
      "B",
      new AbortController().signal,
    );
    await writeFile(
      join(root, "pay.pym"),
      source.replace("cents: Nat", "cents: Int"),
    );
    const a = await service.architectureRecord(saved.id, "plan:A");
    const capture = await service.sourceContractPage(
      {},
      new AbortController().signal,
    );
    saved = await service.savePlanItem(
      saved.id,
      { ...a.data, sourceReviewSnapshot: capture.snapshotId },
      "Review A",
      new AbortController().signal,
      { document: a.entity.document, originalId: "A" },
    );
    await service.close();
    service = null;
    client = new Client({ name: "source-plan-test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const call = async (args) => {
      const result = await client.callTool({
        name: "read_architecture",
        arguments: args,
      });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return result.structuredContent ?? JSON.parse(result.content[0].text);
    };
    const standalone = await call({
      section: "source_contract",
      id: "source:pay.pym#charge",
    });
    assert.equal(standalone.changedDependencies, null);
    assert.match(standalone.comparisonReason, /No plan baseline/);
    const old = await call({
      section: "source_contract",
      id: "source:pay.pym#charge",
      planId: "plan:B",
    });
    assert.deepEqual(old.changedDependencies, ["source:pay.pym#Money"]);
    assert.deepEqual(old.dependencyPaths, [
      {
        target: "source:pay.pym#Money",
        via: [
          "source:pay.pym#charge",
          "source:pay.pym#Order",
          "source:pay.pym#Money",
        ],
        truncated: false,
      },
    ]);
    assert.equal(old.recordedAtReview, true);
    const record = await call({ section: "record", id: "plan:B" });
    assert.equal(Object.hasOwn(record.entity, "searchText"), false);
    const reviewed = await call({
      section: "source_contract",
      id: "source:pay.pym#charge",
      planId: "plan:A",
    });
    assert.deepEqual(reviewed.changedDependencies, []);
    const missing = await call({
      section: "source_contract",
      id: "source:pay.pym#absent",
    });
    assert.equal(missing.current, null);
    assert.equal(missing.complete, false);
    assert.equal(missing.changedDependencies, null);
  } finally {
    await client?.close();
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});
