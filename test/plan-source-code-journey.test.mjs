// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";

test("source review, code gaps and retained versions stay distinct through a rolling design change", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-plan-source-code-"));
  let service = new StudioService(root);
  const signal = new AbortController().signal;
  try {
    const source =
      "type Order = { amount: Nat }; flow charge(order: Order) -> Bool { return order.amount > 0; }";
    const implementation =
      "export function charge(order: { amount: bigint }): boolean { return order.amount > 0n; }";
    await writeFile(join(root, "pay.pym"), source);
    await writeFile(join(root, "pay.ts"), implementation);
    let revision = await service.savePlanItem(
      "",
      {
        ...newPlanItem("R1"),
        title: "Check payment amount",
        acceptance: "Accept a positive amount",
        links: [{ kind: "depends-on", target: "source:pay.pym#charge" }],
      },
      "Plan payment",
      signal,
    );
    revision = await service.observeImplementation(
      {
        files: ["pay.ts"],
        label: "Initial code",
        expectedRevision: revision.id,
      },
      signal,
    );
    const gap = await service.implementationGraph(
      { mode: "gaps", query: "Check payment amount" },
      signal,
    );
    const code = await service.implementationGraph(
      { mode: "existing", query: "charge" },
      signal,
    );
    assert.equal(gap.items[0].status, "unlinked");
    revision = await service.linkImplementation(
      {
        revision: revision.id,
        planId: gap.items[0].id,
        planHash: gap.items[0].planHash,
        nodeId: code.items[0].id,
        observationId: code.observationId,
        note: "Compare this implementation with the reviewed input contract",
      },
      signal,
    );
    const retained = revision.id;
    assert.equal(
      (
        await service.implementationGraph(
          { mode: "gaps", query: "Check payment amount" },
          signal,
        )
      ).items[0].status,
      "body-present",
    );
    const database = join(root, ".pymtheg/shared", "architecture.sqlite");
    const beforeReads = await readFile(database);
    await writeFile(
      join(root, "pay.pym"),
      source.replace("amount: Nat", "amount: Int"),
    );
    const attention = await service.architectureWork(retained, signal);
    assert.ok(
      attention.some(
        (item) =>
          item.id === "plan:R1" &&
          item.kind === "changed-target" &&
          item.target === "source:pay.pym#Order",
      ),
    );
    const historical = await service.implementationGraph(
      {
        mode: "gaps",
        query: "Check payment amount",
        planRevision: retained,
        codeRevision: retained,
      },
      signal,
    );
    assert.ok(historical.items[0].statuses.includes("design-changed"));
    assert.match(historical.items[0].reason, /changed/);
    assert.match(historical.meaning, /proves implementation correctness/);
    assert.deepEqual(
      await readFile(database),
      beforeReads,
      "Reading source attention and retained comparisons does not rewrite history",
    );
    const record = await service.architectureRecord(retained, "plan:R1");
    const fresh = await service.captureSourceContracts(signal);
    revision = await service.savePlanItem(
      retained,
      { ...record.data, sourceReviewSnapshot: fresh.snapshotId },
      "Accept signed payment input",
      signal,
      { document: record.entity.document, originalId: "R1" },
    );
    assert.ok(
      !(await service.architectureWork(revision.id, signal)).some(
        (item) => item.id === "plan:R1" && item.kind === "changed-target",
      ),
    );
    assert.equal(
      (
        await service.implementationGraph(
          { mode: "gaps", query: "Check payment amount" },
          signal,
        )
      ).items[0].status,
      "plan-changed",
    );
    await service.close();
    service = new StudioService(root);
    assert.equal(
      (
        await service.implementationGraph(
          { mode: "gaps", query: "Check payment amount" },
          signal,
        )
      ).items[0].status,
      "plan-changed",
    );
    assert.equal(
      (
        await service.implementationGraph(
          {
            mode: "gaps",
            query: "Check payment amount",
            planRevision: retained,
            codeRevision: retained,
          },
          signal,
        )
      ).items[0].status,
      "design-changed",
    );
    assert.equal(await readFile(join(root, "pay.ts"), "utf8"), implementation);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
