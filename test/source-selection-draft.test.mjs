// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const signal = () => new AbortController().signal;

test("durable source selections survive cache eviction and restart without a review acknowledgement", async () => {
  const root = mkdtempSync(join(tmpdir(), "pym-durable-selection-"));
  let service = new StudioService(root);
  try {
    const file = join(root, "source.pym");
    const source =
      "flow charge() -> Bool { return true; }\nflow unrelated() -> Nat { return 0; }";
    writeFileSync(file, source);
    const page = await service.sourceContractPage({}, signal());
    const choice = service.sourceSelection(page.snapshotId, [
      "source:source.pym#charge",
    ]);
    for (let i = 1; i <= 4; i++) {
      writeFileSync(file, source.replace("return 0", "return " + i));
      await service.sourceContractPage({}, signal());
    }
    const draft = {
      ...newPlanItem("R1"),
      title: "Charge once",
      links: [{ kind: "depends-on", target: "source:source.pym#charge" }],
      sourceSelections: { "source:source.pym#charge": choice },
    };
    await service.close();
    service = new StudioService(root);
    const saved = await service.savePlanItem(
      "",
      draft,
      "Restore selected source",
      signal(),
    );
    const record = await service.architectureRecord(saved.id, "plan:R1");
    assert.ok(record.data.sourceExpectations["source:source.pym#charge"]);
    assert.equal(record.data.sourceReviewSelection, undefined);
    assert.equal(record.data.sourceSelections, undefined);
    writeFileSync(file, source.replace("return true", "return false"));
    await assert.rejects(
      service.savePlanItem(
        saved.id,
        { ...draft, id: "R2" },
        "Changed source",
        signal(),
      ),
      /component or a dependency changed/,
    );
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("adding a freshly selected link never acknowledges an existing changed link", async () => {
  const root = mkdtempSync(join(tmpdir(), "pym-selection-independent-"));
  const service = new StudioService(root);
  try {
    const file = join(root, "source.pym");
    const source =
      "flow first() -> Bool { return true; }\nflow second() -> Bool { return true; }";
    writeFileSync(file, source);
    const saved = await service.savePlanItem(
      "",
      {
        ...newPlanItem("R1"),
        title: "Two links",
        links: [{ kind: "depends-on", target: "source:source.pym#first" }],
      },
      "First link",
      signal(),
    );
    const record = await service.architectureRecord(saved.id, "plan:R1");
    writeFileSync(
      file,
      source.replace(
        "first() -> Bool { return true",
        "first() -> Bool { return false",
      ),
    );
    const page = await service.sourceContractPage({}, signal());
    const target = "source:source.pym#second";
    const next = await service.savePlanItem(
      saved.id,
      {
        ...record.data,
        links: [...record.data.links, { kind: "depends-on", target }],
        sourceSelections: {
          [target]: service.sourceSelection(page.snapshotId, [target]),
        },
      },
      "Second link",
      signal(),
      { document: record.entity.document, originalId: "R1" },
    );
    assert.ok(
      (await service.architectureWork(next.id)).some(
        (w) =>
          w.id === "plan:R1" &&
          w.kind === "changed-target" &&
          w.target === "source:source.pym#first",
      ),
    );
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
