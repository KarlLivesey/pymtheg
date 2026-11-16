// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { branchReview } from "../dist/architecture/branches.js";
test("legacy pair-only reviews are visible read-only and their IDs survive writable migration", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-v6-review-"));
  let local, remote;
  try {
    for (const folder of ["local", "remote"]) await mkdir(join(root, folder));
    local = await ArchitectureStore.open(join(root, "local"));
    remote = await ArchitectureStore.open(join(root, "remote"));
    local.save("Base", "test", [{ path: "design.md", text: "base" }]);
    remote.importHistory(local.exportHistory());
    const current = local.save("Local", "test", [
        { path: "design.md", text: "local" },
      ]),
      other = remote.save("Other", "test", [
        { path: "design.md", text: "remote" },
      ]);
    local.importHistory(remote.exportHistory());
    local.reviewBranch(other.id, current.id);
    local.close();
    local = null;
    remote.close();
    remote = null;
    const directory = join(root, "local", ".pymtheg/shared"),
      path = join(directory, "architecture.sqlite");
    const db = new DatabaseSync(path);
    db.exec("DROP TABLE acknowledgement_records; PRAGMA user_version=6");
    db.close();
    const before = await readFile(path),
      filesBefore = await readdir(directory);
    local = await ArchitectureStore.open(join(root, "local"), {
      readOnly: true,
    });
    const history = local.reviewHistory(other.id, 0, 20);
    assert.equal(history.total, 1);
    assert.equal(history.items[0].reviewer, undefined);
    assert.equal(
      local.revisions(false).find((r) => r.id === other.id).reviewRecordCount,
      1,
    );
    const id = history.items[0].id;
    assert.match(id, /^[a-f0-9]{64}$/);
    local.close();
    local = null;
    assert.deepEqual(await readFile(path), before);
    assert.deepEqual(await readdir(directory), filesBefore);
    local = await ArchitectureStore.open(join(root, "local"));
    local.withdrawBranchReview(id, current.id, {
      reviewer: "Karl",
      reason: "Recheck required",
    });
    assert.equal(
      branchReview(local.revisions(), current.id).find((r) => r.id === other.id)
        .reviewed,
      false,
    );
    assert.equal(
      local.withdrawalHistory(id).items[0].reason,
      "Recheck required",
    );
    assert.equal(local.document(current.id, "design.md").text, "local");
  } finally {
    local?.close();
    remote?.close();
    await rm(root, { recursive: true, force: true });
  }
});
