import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  rm,
  readFile,
  access,
  symlink,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const signal = new AbortController().signal;
test("reviewing and saving a source-only requirement clears attention without stale document-link duplicates", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-source-authority-"));
  const service = new StudioService(root);
  try {
    const file = join(root, "main.pym"),
      source = "flow limit(n: Nat) -> Bool { return n <= 50; }";
    await writeFile(file, source);
    let revision = await service.savePlanItem(
      "",
      {
        ...newPlanItem("R"),
        kind: "requirement",
        title: "Keep threshold",
        status: "accepted",
        acceptance: "Respect the reviewed threshold",
        links: [{ kind: "depends-on", target: "source:main.pym#limit" }],
      },
      "Plan",
      signal,
    );
    assert.deepEqual(await service.architectureWork(revision.id, signal), []);
    await writeFile(file, source.replace("50", "40"));
    let work = await service.architectureWork(revision.id, signal);
    assert.equal(work.filter((i) => i.kind === "changed-target").length, 1);
    const record = await service.architectureRecord(revision.id, "plan:R");
    const current = await service.captureSourceContracts(signal);
    revision = await service.savePlanItem(
      revision.id,
      { ...record.data, sourceReviewSnapshot: current.snapshotId },
      "Review",
      signal,
      { document: record.entity.document, originalId: "R" },
    );
    assert.deepEqual(await service.architectureWork(revision.id, signal), []);
    const graph = await service.implementationGraph({ mode: "gaps" }, signal);
    assert.ok(
      !graph.items
        .find((i) => i.id === "plan:R")
        .statuses.includes("design-changed"),
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("a new source buffer can preview nested folders and creates them only on explicit save", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-new-source-dir-"));
  const outside = await mkdtemp(join(tmpdir(), "pym-outside-dir-"));
  const service = new StudioService(root);
  try {
    const file = await service.path("design/core/main.pym", true);
    assert.equal(file, join(root, "design/core/main.pym"));
    await assert.rejects(access(join(root, "design")));
    const source = "flow main() -> Unit { return unit; }\n";
    await service.save("design/core/main.pym", source, null);
    assert.equal(await readFile(file, "utf8"), source);
    await symlink(outside, join(root, "escape"));
    await assert.rejects(
      service.save("escape/nested/bad.pym", source, null),
      /outside project root/,
    );
    await assert.rejects(access(join(outside, "nested")));
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
