// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const source =
  "resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; }\nflow process(take file: File) -> Unit effects(state.File) { transition file -> Closed; return unit; }";
test("real resource API previews the caller impact and never saves source", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-resource-api-"));
  let app;
  try {
    const file = join(root, "main.pym");
    await writeFile(file, source);
    app = await startStudio({ path: root });
    const done = new Promise((resolve) => {
      const off = app.service.subscribe((e) => {
        if (e.kind === "run" && e.run.status !== "running") {
          off();
          resolve(e.run);
        }
      });
    });
    const run = await app.service.start({
      clientId: "resource-test",
      revision: 0,
      file: "main.pym",
      buffers: {},
      kind: "check",
      entry: "process",
      seed: "42",
      maxSteps: 6,
      maxSamples: 10,
    });
    await done;
    const request = (body) =>
      fetch(new URL("/api/interface", app.url), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + app.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const contextResponse = await request({
      action: "resource",
      runId: run.id,
      symbolId: file + "#File",
    });
    assert.equal(contextResponse.status, 200);
    const context = await contextResponse.json();
    assert.equal(context.schema, "pymtheg.resource-definition/v1");
    const preview = await request({
      action: "preview-resource",
      runId: run.id,
      symbolId: context.symbolId,
      sourceHash: context.sourceHash,
      edit: { ...context.definition, transitions: [] },
    });
    assert.equal(preview.status, 200);
    const change = await preview.json();
    assert.ok(change.affected.some((d) => d.name === "process"));
    assert.doesNotMatch(change.text, /Open -> Closed/);
    assert.equal(await readFile(file, "utf8"), source);
    const stale = await request({
      action: "preview-resource",
      runId: run.id,
      symbolId: context.symbolId,
      sourceHash: "stale",
      edit: context.definition,
    });
    assert.equal(stale.status, 409);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
