import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeWorkspace } from "../dist/project/workspace.js";
import {
  projectDocumentation,
  previewProjectDocumentation,
} from "../dist/project/documents.js";
import { StudioService } from "../dist/studio/service.js";
import { newPlanItem } from "../dist/architecture/planning.js";
test("documentation discovery offers existing design text without importing build output or creating a saved architecture", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-init-docs-"));
  try {
    await mkdir(join(root, "docs"));
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "README.md"), "# Design\nKeep this exact text.");
    await writeFile(
      join(root, "docs", "architecture.json"),
      '{"unknownField":{"keep":true}}',
    );
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(
      join(root, "dist", "generated.md"),
      "not a design document",
    );
    const initialized = await initializeWorkspace(root);
    assert.deepEqual(
      (await projectDocumentation(root)).documents.map((d) => d.path),
      ["README.md", "docs/architecture.json"],
    );
    const preview = await previewProjectDocumentation(
      root,
      initialized.workspace,
      false,
      new AbortController().signal,
    );
    assert.equal(preview.status, "preview");
    assert.equal(preview.committed, false);
    await assert.rejects(
      access(join(root, ".pymtheg-architecture", "architecture.sqlite")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("explicit documentation import retains source and preserves native planning across refresh", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-init-import-"));
  let service;
  try {
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "design.md"), "# Design\nInitial plan");
    const initialized = await initializeWorkspace(root);
    const first = await previewProjectDocumentation(
      root,
      initialized.workspace,
      true,
      new AbortController().signal,
    );
    assert.equal(first.status, "imported");
    service = new StudioService(root);
    const current = (await service.architectureOverview()).index;
    await service.savePlanItem(
      current.id,
      { ...newPlanItem("R01"), title: "Retain the decision" },
      "Requirement",
      new AbortController().signal,
    );
    await service.close();
    service = null;
    await writeFile(join(root, "docs", "design.md"), "# Design\nRevised plan");
    const refreshed = await previewProjectDocumentation(
      root,
      initialized.workspace,
      true,
      new AbortController().signal,
    );
    assert.equal(refreshed.status, "imported");
    service = new StudioService(root);
    const after = (await service.architectureOverview()).index;
    assert.ok(after.entities.some((e) => e.id === "plan:R01"));
    assert.equal(
      (await service.architectureDocument(after.id, "docs/design.md")).text,
      "# Design\nRevised plan",
    );
    await service.close();
    service = null;
    const unchanged = await previewProjectDocumentation(
      root,
      initialized.workspace,
      true,
      new AbortController().signal,
    );
    assert.equal(unchanged.status, "unchanged");
    assert.equal(unchanged.revision, after.id);
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("cancelled documentation discovery does not publish an architecture", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-init-cancel-"));
  try {
    await writeFile(join(root, "README.md"), "# Design");
    const initialized = await initializeWorkspace(root);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      previewProjectDocumentation(
        root,
        initialized.workspace,
        true,
        controller.signal,
      ),
      /abort/i,
    );
    await assert.rejects(
      access(join(root, ".pymtheg-architecture", "architecture.sqlite")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI init offers a preview, imports only on request and reports unchanged repeats", async () => {
  const { spawnSync } = await import("node:child_process");
  const { resolve } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "pym-init-docs-cli-"));
  try {
    await writeFile(
      join(root, "README.md"),
      "# Design\nRetain original bytes.",
    );
    const cli = (...args) =>
      spawnSync(
        process.execPath,
        [resolve("dist/cli/main.js"), "init", "--format", "json", ...args],
        { cwd: root, encoding: "utf8" },
      );
    const initial = cli();
    assert.equal(initial.status, 0, initial.stderr);
    const preview = JSON.parse(initial.stdout);
    assert.equal(preview.documentation.status, "preview");
    await assert.rejects(
      access(join(root, ".pymtheg-architecture", "architecture.sqlite")),
    );
    const imported = cli("--import-docs");
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(JSON.parse(imported.stdout).documentation.status, "imported");
    const repeated = cli("--import-docs");
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(JSON.parse(repeated.stdout).documentation.status, "unchanged");
    assert.equal(
      JSON.parse(repeated.stdout).workspace.id,
      preview.workspace.id,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
