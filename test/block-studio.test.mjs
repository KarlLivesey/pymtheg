// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { blockDocumentSchema } from "../dist/studio/block-document.js";
test("block API projects the checked unsaved snapshot without source writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-block-api-"));
  let app;
  try {
    const file = join(root, "main.pym"),
      original = "flow main() -> Unit { return unit; }";
    await writeFile(file, original);
    app = await startStudio({ path: root });
    const done = new Promise((resolve) => {
      const off = app.service.subscribe((e) => {
        if (e.kind === "run" && e.run.status === "completed") {
          off();
          resolve(e.run);
        }
      });
    });
    const text = "flow main() -> Unit { for i in 7 { return unit; } }";
    await app.service.start({
      clientId: "blocks",
      revision: 1,
      file: "main.pym",
      buffers: { "main.pym": text },
      kind: "check",
      entry: "main",
      seed: "42",
      maxSteps: 5,
      maxSamples: 5,
    });
    const run = await done;
    const response = await fetch(new URL("/api/blocks", app.url), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + app.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ runId: run.id, file: "main.pym" }),
    });
    assert.equal(response.status, 200);
    const model = blockDocumentSchema.parse(await response.json());
    assert.equal(model.text, text);
    const f = model.blocks[0].sections[0].blocks[0].fields[0];
    assert.equal(model.text.slice(f.span.start, f.span.end), "7");
    assert.equal(await readFile(file, "utf8"), original);
    await assert.rejects(
      app.service.blockDocument(run.id, "../outside.pym"),
      /outside project root/,
    );
    await assert.rejects(
      app.service.blockDocument("expired", "main.pym"),
      /Check the current source/,
    );
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
