import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, unlink, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { initializeWorkspace } from "../dist/project/workspace.js";
import { previewProjectDocumentation } from "../dist/project/documents.js";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";

test("removing the last tracked document produces an explicit refresh instead of an empty-project result", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-last-document-"));
  const signal = new AbortController().signal;
  let service;
  try {
    await mkdir(join(root, "docs"));
    await writeFile(
      join(root, "docs/design.md"),
      "# Design\nRetain me in history.",
    );
    const { workspace } = await initializeWorkspace(root);
    const initial = await previewProjectDocumentation(
      root,
      workspace,
      true,
      signal,
    );
    assert.equal(initial.status, "imported");
    await unlink(join(root, "docs/design.md"));
    const preview = await previewProjectDocumentation(
      root,
      workspace,
      false,
      signal,
    );
    assert.equal(preview.status, "preview");
    assert.ok(preview.changes.removed.includes("docs/design.md"));
    assert.deepEqual(preview.changes.changed, []);
    assert.ok(
      preview.review.summary.changed.some((path) =>
        path.startsWith(".pymtheg-imports/"),
      ),
    );
    const saved = await previewProjectDocumentation(
      root,
      workspace,
      true,
      signal,
    );
    assert.equal(saved.status, "imported");
    assert.ok(saved.changes.removed.includes("docs/design.md"));
    const unchanged = await previewProjectDocumentation(
      root,
      workspace,
      true,
      signal,
    );
    assert.equal(unchanged.status, "unchanged");
    assert.equal(unchanged.revision, saved.revision);
    service = new StudioService(root);
    assert.equal(
      (await service.architectureDocument(initial.revision, "docs/design.md"))
        .text,
      "# Design\nRetain me in history.",
    );
    assert.ok(
      !(await service.architectureOverview()).index.documents.some(
        (d) => d.path === "docs/design.md",
      ),
    );
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("human init output names removed documentation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-removal-cli-"));
  try {
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs/a.md"), "# A");
    await writeFile(join(root, "docs/b.md"), "# B");
    const run = () =>
      spawnSync(
        process.execPath,
        [resolve("dist/cli/main.js"), "init", root, "--import-docs"],
        { encoding: "utf8" },
      );
    assert.equal(run().status, 0);
    await unlink(join(root, "docs/a.md"));
    const refreshed = run();
    assert.equal(refreshed.status, 0, refreshed.stderr);
    assert.match(refreshed.stdout, /1 removed/);
    assert.match(refreshed.stdout, /docs\/a\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("last-document removal still requires review when a native plan links to it", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-linked-document-removal-"));
  const service = new StudioService(root);
  const signal = new AbortController().signal;
  try {
    await mkdir(join(root, "docs"));
    await writeFile(
      join(root, "docs/design.md"),
      "# Design\nKeep acceptance criteria.",
    );
    const { workspace } = await initializeWorkspace(root);
    await previewProjectDocumentation(root, workspace, true, signal, {
      service,
    });
    const index = (await service.architectureOverview()).index;
    const target = index.entities.find(
      (entity) =>
        entity.kind === "document" && entity.document === "docs/design.md",
    );
    assert.ok(target);
    const saved = await service.savePlanItem(
      index.id,
      {
        ...newPlanItem("R1"),
        title: "Preserve requirement",
        links: [{ kind: "depends-on", target: target.id }],
      },
      "Link plan",
      signal,
    );
    await unlink(join(root, "docs/design.md"));
    const preview = await previewProjectDocumentation(
      root,
      workspace,
      true,
      signal,
      { service },
    );
    assert.equal(preview.status, "needs_review");
    assert.equal(preview.committed, false);
    assert.ok(preview.newlyBrokenAuthoredLinks.length > 0);
    assert.equal(
      (await service.architectureOverview()).activeRevision,
      saved.id,
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
