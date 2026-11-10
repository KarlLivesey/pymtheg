import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
test("a large project can capture forty linked roots and their shared import in one snapshot", async () => {
  const root = mkdtempSync(join(tmpdir(), "pym-many-roots-")),
    service = new StudioService(root),
    signal = new AbortController().signal;
  try {
    for (let i = 0; i < 2050; i++)
      writeFileSync(join(root, `noise${i}.pym`), "");
    writeFileSync(join(root, "shared.pym"), "type Input = { n: Nat };");
    const links = [];
    for (let i = 0; i < 40; i++) {
      writeFileSync(
        join(root, `part${i}.pym`),
        `import "shared.pym"; flow part${i}(input: Input) -> Nat { return input.n; }`,
      );
      links.push({ kind: "supports", target: `source:part${i}.pym#part${i}` });
    }
    const saved = await service.savePlanItem(
      "",
      { ...newPlanItem("Large"), title: "Many components", links },
      "Capture grouped source",
      signal,
    );
    const data = await service.architectureDocument(
      saved.id,
      ".pymtheg-source-contracts.json",
    );
    const catalogue = JSON.parse(data.text);
    assert.equal(new Set(catalogue.entries.map((e) => e.snapshotId)).size, 1);
    assert.equal(catalogue.entries.filter((e) => e.name === "Input").length, 1);
    assert.equal(catalogue.entries.filter((e) => e.kind === "flow").length, 40);
    const record = await service.architectureRecord(saved.id, "plan:Large");
    assert.equal(Object.keys(record.data.sourceRoots).length, 40);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
