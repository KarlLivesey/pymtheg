// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
const signal = new AbortController().signal;
test("overlapping sources retain a shared document until its last source removes it", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-shared-sources-")),
    app = new StudioService(root),
    a = { id: "a", label: "Project A", kind: "upload" },
    b = { id: "b", label: "Project B", kind: "upload" },
    shared = { path: "shared.md", text: "Shared design" };
  try {
    await app.importArchitecture(
      "A",
      [shared, { path: "a.md", text: "A" }],
      signal,
      { source: a, mode: "add" },
    );
    const both = await app.importArchitecture(
      "B",
      [shared, { path: "b.md", text: "B" }],
      signal,
      { source: b, mode: "add" },
    );
    const preview = await app.previewArchitectureImport(
      "Refresh A",
      {
        documents: [{ path: "a.md", text: "A updated" }],
        source: a,
        mode: "refresh",
      },
      signal,
    );
    assert.deepEqual(preview.summary.keptShared, ["shared.md"]);
    assert.ok(!preview.summary.removed.includes("shared.md"));
    const one = await app.commitPreparedArchitectureImport(
      preview.token,
      signal,
    );
    assert.equal(
      (await app.architectureDocument(one.id, "shared.md")).text,
      "Shared design",
    );
    const before = one.id;
    await app.importArchitecture(
      "A returns",
      [shared, { path: "a.md", text: "A updated" }],
      signal,
      { source: a, mode: "refresh" },
    );
    const beforeConflict = (await app.architectureOverview()).index.id;
    await assert.rejects(
      app.importArchitecture(
        "Conflicting A",
        [{ ...shared, text: "Incompatible version" }],
        signal,
        { source: a, mode: "refresh" },
      ),
      /another source/,
    );
    assert.equal((await app.architectureOverview()).index.id, beforeConflict);
    await app.importArchitecture(
      "A removes shared",
      [{ path: "a.md", text: "A" }],
      signal,
      { source: a, mode: "refresh" },
    );
    const none = await app.importArchitecture(
      "B removes shared",
      [{ path: "b.md", text: "B" }],
      signal,
      { source: b, mode: "refresh" },
    );
    assert.ok(!none.documents.some((d) => d.path === "shared.md"));
    assert.equal(
      (await app.architectureDocument(both.id, "shared.md")).text,
      "Shared design",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("an unchanged shared upstream version preserves a local edit", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-shared-edit-")),
    app = new StudioService(root),
    shared = { path: "shared.md", text: "Original" },
    a = { id: "a", label: "A", kind: "upload" },
    b = { id: "b", label: "B", kind: "upload" };
  try {
    await app.importArchitecture("A", [shared], signal, {
      source: a,
      mode: "add",
    });
    let state = await app.importArchitecture("B", [shared], signal, {
      source: b,
      mode: "add",
    });
    state = await app.editArchitectureDocument(
      state.id,
      "shared.md",
      "Local design edit",
      "Local edit",
      signal,
    );
    state = await app.importArchitecture("A unchanged", [shared], signal, {
      source: a,
      mode: "refresh",
    });
    assert.equal(
      (await app.architectureDocument(state.id, "shared.md")).text,
      "Local design edit",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
