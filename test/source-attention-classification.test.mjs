import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";

test("unrelated syntax failures do not disguise a removed declaration or invalidate a checked detail", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-plan-classification-"));
  const service = new StudioService(root);
  const signal = new AbortController().signal;
  try {
    const source = (name) =>
      `flow keep() -> Bool { return true; } flow ${name}() -> Bool { return false; }`;
    await writeFile(join(root, "pay.pym"), source("refund"));
    await writeFile(
      join(root, "other.pym"),
      "flow other() -> Bool { return true; }",
    );
    let revision = "";
    for (const [id, target] of [
      ["B", "source:pay.pym#refund"],
      ["C", "source:other.pym#other"],
    ]) {
      revision = (
        await service.savePlanItem(
          revision,
          {
            ...newPlanItem(id),
            title: id,
            acceptance: "Observe the result",
            links: [{ kind: "depends-on", target }],
          },
          "Add " + id,
          signal,
        )
      ).id;
    }
    await writeFile(join(root, "pay.pym"), source("refundOnce"));
    await writeFile(join(root, "other.pym"), "flow other( {");
    const work = await service.architectureWork(revision, signal);
    assert.ok(
      work.some((item) => item.id === "plan:B" && item.kind === "broken-link"),
      JSON.stringify(work),
    );
    assert.ok(
      !work.some(
        (item) => item.id === "plan:B" && item.kind === "unknown-link-review",
      ),
    );
    assert.ok(
      work.some(
        (item) => item.id === "plan:C" && item.kind === "unknown-link-review",
      ),
    );
    const page = await service.sourceContractPage({}, signal);
    const detail = await service.sourceContractDetail(
      { id: "source:pay.pym#keep", snapshotId: page.snapshotId },
      signal,
    );
    assert.equal(detail.complete, true);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a deleted imported type remains an explicit broken dependency", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-plan-import-deleted-"));
  const service = new StudioService(root);
  const signal = new AbortController().signal;
  try {
    await writeFile(join(root, "types.pym"), "type Money = { amount: Nat };");
    await writeFile(
      join(root, "pay.pym"),
      'import "types.pym"; flow pay(money: Money) -> Bool { return true; }',
    );
    const saved = await service.savePlanItem(
      "",
      {
        ...newPlanItem("P"),
        title: "Payment",
        acceptance: "Observe the result",
        links: [{ kind: "depends-on", target: "source:pay.pym#pay" }],
      },
      "Add payment",
      signal,
    );
    await unlink(join(root, "types.pym"));
    const work = await service.architectureWork(saved.id, signal);
    assert.ok(
      work.some(
        (item) =>
          item.kind === "broken-link" &&
          item.target === "source:types.pym#Money",
      ),
      JSON.stringify(work),
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
