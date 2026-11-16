// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
test("removing one source link preserves a broken retained root and removes only the detached dependency expectations", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-plan-subset-"));
  let service = new StudioService(root);
  const signal = new AbortController().signal;
  try {
    await writeFile(
      join(root, "a.pym"),
      "type Customer = { name: String }; flow a(x: Customer) -> Bool { return true; }",
    );
    await writeFile(
      join(root, "b.pym"),
      "type Asset = { id: Nat }; flow b(x: Asset) -> Bool { return true; }",
    );
    const saved = await service.savePlanItem(
      "",
      {
        ...newPlanItem("P"),
        title: "Plan A and B",
        links: [
          { kind: "supports", target: "source:a.pym#a" },
          { kind: "supports", target: "source:b.pym#b" },
        ],
      },
      "Plan",
      signal,
    );
    const original = await service.architectureRecord(saved.id, "plan:P");
    await unlink(join(root, "a.pym"));
    const updated = await service.savePlanItem(
      saved.id,
      {
        ...original.data,
        status: "superseded",
        links: [{ kind: "supports", target: "source:a.pym#a" }],
      },
      "Detach B",
      signal,
      { document: original.entity.document, originalId: "P" },
    );
    await service.close();
    service = new StudioService(root);
    const record = await service.architectureRecord(updated.id, "plan:P");
    assert.equal(
      record.data.sourceExpectations["source:a.pym#a"],
      original.data.sourceExpectations["source:a.pym#a"],
    );
    assert.equal(
      record.data.sourceExpectations["source:a.pym#Customer"],
      original.data.sourceExpectations["source:a.pym#Customer"],
    );
    assert.equal(record.data.sourceExpectations["source:b.pym#b"], undefined);
    assert.equal(
      record.data.sourceExpectations["source:b.pym#Asset"],
      undefined,
    );
    const issues = await service.architectureWork(updated.id, signal);
    assert.ok(
      issues.some(
        (i) =>
          i.id === "plan:P" &&
          i.kind === "broken-link" &&
          i.target === "source:a.pym#a",
      ),
    );
    assert.ok(
      !issues.some(
        (i) => i.id === "plan:P" && i.target?.startsWith("source:b.pym#"),
      ),
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
