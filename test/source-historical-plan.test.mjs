// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";

test("an unchanged historical source link permits a status edit without accepting or erasing its broken expectation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-historical-plan-"));
  let service = new StudioService(root);
  const signal = new AbortController().signal;
  try {
    await writeFile(
      join(root, "pay.pym"),
      "flow refund() -> Bool { return true; }",
    );
    const initial = await service.savePlanItem(
      "",
      {
        ...newPlanItem("B"),
        title: "Refund",
        acceptance: "Observe refund",
        links: [{ kind: "depends-on", target: "source:pay.pym#refund" }],
      },
      "Plan refund",
      signal,
    );
    const record = await service.architectureRecord(initial.id, "plan:B");
    await unlink(join(root, "pay.pym"));
    const updated = await service.savePlanItem(
      initial.id,
      {
        ...record.data,
        status: "superseded",
        title: "Historical refund",
      },
      "Retire refund",
      signal,
      { document: record.entity.document, originalId: "B" },
    );
    await service.close();
    service = new StudioService(root);
    const saved = await service.architectureRecord(updated.id, "plan:B");
    assert.equal(saved.data.status, "superseded");
    assert.deepEqual(saved.data.links, record.data.links);
    assert.deepEqual(
      saved.data.sourceExpectations,
      record.data.sourceExpectations,
    );
    assert.deepEqual(saved.data.sourceHashes, record.data.sourceHashes);
    assert.ok(
      (await service.architectureWork(updated.id, signal)).some(
        (item) => item.id === "plan:B" && item.kind === "broken-link",
      ),
    );
    await writeFile(
      join(root, "new.pym"),
      "flow replacement() -> Bool { return true; }",
    );
    const withNew = await service.savePlanItem(
      updated.id,
      {
        ...saved.data,
        links: [
          ...saved.data.links,
          { kind: "depends-on", target: "source:new.pym#replacement" },
        ],
      },
      "Add replacement alongside history",
      signal,
      { document: saved.entity.document, originalId: "B" },
    );
    const combined = await service.architectureRecord(withNew.id, "plan:B");
    assert.equal(
      combined.data.sourceExpectations["source:pay.pym#refund"],
      record.data.sourceExpectations["source:pay.pym#refund"],
    );
    assert.ok(combined.data.sourceExpectations["source:new.pym#replacement"]);
    assert.ok(
      (await service.architectureWork(withNew.id, signal)).some(
        (item) =>
          item.id === "plan:B" &&
          item.kind === "broken-link" &&
          item.target === "source:pay.pym#refund",
      ),
    );
    await assert.rejects(
      service.savePlanItem(
        withNew.id,
        {
          ...newPlanItem("new"),
          title: "Invalid new link",
          links: record.data.links,
        },
        "New missing link",
        signal,
      ),
      /missing|unavailable|removed|renamed/,
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
