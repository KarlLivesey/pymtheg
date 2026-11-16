// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioService } from "../dist/studio/service.js";
test("a grouped catalogue rechecks an initially empty file outside its browsing inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-empty-cache-")),
    service = new StudioService(root),
    signal = new AbortController().signal;
  try {
    await writeFile(
      join(root, "root.pym"),
      "flow root() -> Unit { return unit; }",
    );
    await writeFile(join(root, "later.pym"), "");
    const project = await service.project();
    // This is the same bounded-inventory condition as a selected file beyond the browsing cap.
    const selection = {
      project: {
        ...project,
        files: project.files.filter((f) => f.path === "root.pym"),
      },
      additionalFiles: ["later.pym"],
    };
    const first = await service.captureSourceContracts(
      signal,
      "root.pym",
      selection,
    );
    assert.equal(
      first.entries.some((e) => e.name === "later"),
      false,
    );
    await writeFile(
      join(root, "later.pym"),
      "flow later() -> Unit { return unit; }",
    );
    const current = await service.captureSourceContracts(
      signal,
      "root.pym",
      selection,
    );
    assert.equal(
      current.entries.some((e) => e.name === "later"),
      true,
    );
    assert.notEqual(current.snapshotId, first.snapshotId);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
