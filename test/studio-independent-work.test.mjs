// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioService } from "../dist/studio/service.js";
test("an architecture write and an input trial can start in the same turn without a shared mutation lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-independent-")),
    app = new StudioService(root);
  try {
    await writeFile(
      join(root, "main.pym"),
      "flow f(value: Nat) -> Nat { return value; }",
    );
    const ready = new Promise((resolve) => {
      const off = app.subscribe((e) => {
        if (e.kind === "run" && e.run.status !== "running") {
          off();
          resolve(e.run);
        }
      });
    });
    await app.start({
      clientId: "test",
      revision: 0,
      file: "main.pym",
      buffers: {},
      kind: "check",
      entry: "f",
      seed: "42",
      maxSteps: 6,
      maxSamples: 10,
    });
    const run = await ready;
    assert.equal(run.status, "completed");
    // Both calls begin synchronously before worker messages can be handled.
    const save = app.importArchitecture(
      "Notes",
      [{ path: "notes.md", text: "A design note" }],
      new AbortController().signal,
    );
    const trial = app.tryInputs(
      run.id,
      "f",
      { value: "42" },
      new AbortController().signal,
    );
    const [saved, result] = await Promise.all([save, trial]);
    assert.equal(result.output, "42");
    assert.ok(saved.documents.some((d) => d.path === "notes.md"));
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
