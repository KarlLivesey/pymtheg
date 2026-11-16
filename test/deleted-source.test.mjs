// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";

test("deleted source can be checked from its retained buffer and recreated explicitly", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-deleted-source-"));
  const service = new StudioService(root);
  try {
    const file = join(root, "main.pym");
    await writeFile(file, "flow main() -> Bool { return true; }");
    const original = await service.sourceFile("main.pym");
    await unlink(file);
    const buffer = "flow main() -> Bool { return false; }";
    await assert.rejects(
      service.save("main.pym", buffer, original.hash),
      /deleted on disk/,
    );
    const complete = Promise.withResolvers();
    const unsubscribe = service.subscribe((event) => {
      if (
        event.kind === "run" &&
        event.run.request.revision === 1 &&
        event.run.status !== "running"
      )
        complete.resolve(event.run);
    });
    try {
      await service.start({
        clientId: "deleted-source-test",
        revision: 1,
        file: "main.pym",
        buffers: { "main.pym": buffer },
        kind: "check",
        entry: "main",
        seed: "42",
        maxSteps: 6,
        maxSamples: 10,
      });
      const run = await complete.promise;
      assert.equal(run.status, "completed", JSON.stringify(run));
      assert.equal(run.report.snapshot.files[0].text, buffer);
      await assert.rejects(readFile(file), { code: "ENOENT" });
    } finally {
      unsubscribe();
    }
    await service.save("main.pym", buffer, null);
    assert.equal(await readFile(file, "utf8"), buffer);
    await assert.rejects(
      service.save("main.pym", "replacement", null),
      /already exists/,
    );
    assert.equal(await readFile(file, "utf8"), buffer);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
