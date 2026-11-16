// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";

test("moved and renamed source is only suggested and replacement preserves other expectations", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-source-repair-")),
    s = new StudioService(root),
    signal = new AbortController().signal;
  try {
    const source =
      "flow charge() -> Bool { return true; }\nflow unchanged() -> Bool { return true; }";
    await writeFile(join(root, "old.pym"), source);
    let saved = await s.savePlanItem(
      "",
      {
        ...newPlanItem("R1"),
        title: "Charge once",
        links: [
          { kind: "depends-on", target: "source:old.pym#charge" },
          { kind: "depends-on", target: "source:old.pym#unchanged" },
        ],
      },
      "Links",
      signal,
    );
    await writeFile(
      join(root, "old.pym"),
      "flow unchanged() -> Bool { return false; }",
    );
    await writeFile(
      join(root, "new.pym"),
      "flow capture() -> Bool { return true; }\nflow decoy() -> Bool { return false; }",
    );
    const page = await s.sourceContractPage({}, signal);
    const detail = await s.sourceContractDetail(
      {
        id: "source:old.pym#charge",
        snapshotId: page.snapshotId,
        revision: saved.id,
        planId: "plan:R1",
      },
      signal,
    );
    assert.equal(detail.current, null);
    assert.deepEqual(
      detail.replacements.map((c) => c.id),
      ["source:new.pym#capture"],
    );
    assert.match(detail.replacements[0].reason, /apart from its name/);
    const record = await s.architectureRecord(saved.id, "plan:R1");
    assert.equal(record.data.links[0].target, "source:old.pym#charge");
    const replacement = "source:new.pym#capture";
    const repaired = await s.savePlanItem(
      saved.id,
      {
        ...record.data,
        links: [
          { kind: "depends-on", target: replacement },
          record.data.links[1],
        ],
        sourceSelections: {
          [replacement]: s.sourceSelection(page.snapshotId, [replacement]),
        },
      },
      "Reviewed replacement",
      signal,
      { document: record.entity.document, originalId: "R1" },
    );
    const work = await s.architectureWork(repaired.id);
    assert.ok(
      work.some(
        (w) =>
          w.kind === "changed-target" &&
          w.target === "source:old.pym#unchanged",
      ),
    );
    assert.ok(!work.some((w) => w.target === "source:old.pym#charge"));
    await rename(join(root, "new.pym"), join(root, "moved.pym"));
    const moved = await s.sourceContractPage({}, signal);
    const movedDetail = await s.sourceContractDetail(
      {
        id: replacement,
        snapshotId: moved.snapshotId,
        revision: repaired.id,
        planId: "plan:R1",
      },
      signal,
    );
    assert.ok(
      movedDetail.replacements.some((c) => c.id === "source:moved.pym#capture"),
    );
  } finally {
    await s.close();
    await rm(root, { recursive: true, force: true });
  }
});
