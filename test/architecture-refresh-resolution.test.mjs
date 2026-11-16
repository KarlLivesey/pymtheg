// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioService } from "../dist/studio/service.js";
const signal = new AbortController().signal;
const source = { id: "spec", label: "Specification", kind: "upload" };
const doc = (text) => ({ path: "design.md", text });
test("source refresh exposes both versions and applies only reviewed document choices", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-refresh-"));
  const app = new StudioService(root);
  try {
    const first = await app.importArchitecture(
      "original",
      [doc("original")],
      signal,
      { source, mode: "add" },
    );
    await app.editArchitectureDocument(
      first.id,
      "design.md",
      "local",
      "edit",
      signal,
    );
    const input = { documents: [doc("upstream")], source, mode: "refresh" };
    const pending = await app.previewArchitectureImport(
      "review",
      input,
      signal,
    );
    assert.equal(pending.conflicts.length, 1);
    assert.equal(pending.conflicts[0].local, "local");
    assert.equal(pending.conflicts[0].incoming, "upstream");
    await assert.rejects(
      app.commitPreparedArchitectureImport(pending.token, signal),
      /resolve|preview/i,
    );
    const conflict = pending.conflicts[0];
    const ready = await app.previewArchitectureImport(
      "review",
      {
        ...input,
        resolutions: [
          {
            path: conflict.path,
            localHash: conflict.localHash,
            incomingHash: conflict.incomingHash,
            choice: "keep-local",
          },
        ],
      },
      signal,
    );
    assert.equal(ready.conflicts.length, 0);
    const saved = await app.commitPreparedArchitectureImport(
      ready.token,
      signal,
    );
    assert.equal(
      (await app.architectureDocument(saved.id, "design.md")).text,
      "local",
    );
    const unchanged = await app.previewArchitectureImport(
      "again",
      input,
      signal,
    );
    assert.equal(
      unchanged.conflicts.length,
      0,
      "keeping local advances the upstream baseline",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("choices are snapshot-bound, preserve both versions and cannot replace native plans", async () => {
  const { mergeArchitectureImport, withNativeDocuments } = await import(
    "../dist/architecture/import-merge.js"
  );
  const original = mergeArchitectureImport([], [doc("base")], source).documents;
  const current = original.map((d) =>
    d.path === "design.md" ? doc("local") : d,
  );
  const pending = mergeArchitectureImport(
    current,
    [doc("remote")],
    source,
    "refresh",
    { collectConflicts: true },
  );
  const conflict = pending.conflicts[0];
  const resolution = {
    path: conflict.path,
    localHash: conflict.localHash,
    incomingHash: conflict.incomingHash,
    choice: "keep-both",
  };
  const both = mergeArchitectureImport(
    current,
    [doc("remote")],
    source,
    "refresh",
    { resolutions: [resolution] },
  );
  assert.equal(
    both.documents.find((d) => d.path === "design.md").text,
    "local",
  );
  assert.ok(
    both.documents.some(
      (d) => d.path.startsWith("imports/") && d.text === "remote",
    ),
  );
  assert.throws(
    () =>
      mergeArchitectureImport(
        current.map((d) => (d.path === "design.md" ? doc("new edit") : d)),
        [doc("remote")],
        source,
        "refresh",
        { resolutions: [resolution] },
      ),
    /changed since conflict review/,
  );
  const native = withNativeDocuments(
    [{ path: "architecture/plan.json", text: "local plan" }],
    ["architecture/plan.json"],
  );
  const incoming = [{ path: "architecture/plan.json", text: "incoming plan" }];
  const nativeConflict = mergeArchitectureImport(
    native,
    incoming,
    source,
    "add",
    { collectConflicts: true },
  ).conflicts[0];
  assert.deepEqual(nativeConflict.choices, ["keep-local", "keep-both"]);
  assert.throws(
    () =>
      mergeArchitectureImport(native, incoming, source, "add", {
        resolutions: [
          {
            path: nativeConflict.path,
            localHash: nativeConflict.localHash,
            incomingHash: nativeConflict.incomingHash,
            choice: "take-incoming",
          },
        ],
      }),
    /protected/,
  );
  const removed = mergeArchitectureImport(current, [], source, "refresh", {
    collectConflicts: true,
  }).conflicts[0];
  assert.equal(removed.incoming, null);
  for (const choice of removed.choices) {
    const result = mergeArchitectureImport(current, [], source, "refresh", {
      resolutions: [
        {
          path: removed.path,
          localHash: removed.localHash,
          incomingHash: null,
          choice,
        },
      ],
    });
    assert.equal(
      result.documents.some((d) => d.path === "design.md"),
      choice === "keep-local",
    );
  }
});

test("a bundle imported into native planning can preserve both plans explicitly", async () => {
  const { newPlanItem } = await import("../dist/architecture/planning.js");
  const root = await mkdtemp(join(tmpdir(), "pym-bundle-plans-"));
  await mkdir(join(root, "source"));
  await mkdir(join(root, "destination"));
  const sourceApp = new StudioService(join(root, "source")),
    destination = new StudioService(join(root, "destination"));
  try {
    const original = await sourceApp.savePlanItem(
      "",
      { ...newPlanItem("Imported"), title: "Foreign plan", owner: "team" },
      "Source",
      signal,
    );
    const local = await destination.savePlanItem(
      "",
      { ...newPlanItem("Native"), title: "Local plan", owner: "team" },
      "Local",
      signal,
    );
    const bundle = await sourceApp.exportArchitecture(original.id);
    const pending = await destination.previewArchitectureImport(
      "Bring plans",
      { bundle },
      signal,
    );
    assert.equal(pending.conflicts.length, 1);
    const c = pending.conflicts[0];
    const ready = await destination.previewArchitectureImport(
      "Bring plans",
      {
        bundle,
        resolutions: [
          {
            path: c.path,
            localHash: c.localHash,
            incomingHash: c.incomingHash,
            choice: "keep-both",
          },
        ],
      },
      signal,
    );
    assert.equal(ready.conflicts.length, 0);
    const saved = await destination.commitPreparedArchitectureImport(
      ready.token,
      signal,
    );
    assert.ok(saved.entities.some((e) => e.id === "plan:Native"));
    assert.ok(saved.entities.some((e) => e.id === "plan:Imported"));
    assert.equal(
      (await destination.architectureRecord(local.id, "plan:Native")).data
        .title,
      "Local plan",
    );
  } finally {
    await sourceApp.close();
    await destination.close();
    await rm(root, { recursive: true, force: true });
  }
});
