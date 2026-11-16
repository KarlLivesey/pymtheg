// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { setupProject } from "../dist/project/setup.js";
import { StudioService } from "../dist/studio/service.js";

test("init can resolve a real document conflict without switching workflows or losing either version", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-setup-review-"));
  const signal = new AbortController().signal;
  let service;
  try {
    await writeFile(join(root, "README.md"), "# Decision\nOriginal");
    const initial = await setupProject(root, "Shared plan", true, signal);
    service = new StudioService(root);
    await service.editArchitectureDocument(
      initial.documentation.revision,
      "README.md",
      "# Decision\nLocal review",
      "Local edit",
      signal,
    );
    await service.close();
    service = null;
    await writeFile(join(root, "README.md"), "# Decision\nIncoming revision");
    const cli = (...args) =>
      spawnSync(
        process.execPath,
        [
          resolve("dist/cli/main.js"),
          "init",
          root,
          "--import-docs",
          "--format",
          "json",
          ...args,
        ],
        { encoding: "utf8" },
      );
    const blocked = cli();
    assert.equal(blocked.status, 2, blocked.stderr);
    const preview = JSON.parse(blocked.stdout).documentation;
    assert.equal(preview.status, "needs_review");
    assert.equal(preview.review.conflicts.length, 1);
    const conflict = preview.review.conflicts[0];
    const choices = join(root, ".choices.json");
    await writeFile(
      choices,
      JSON.stringify([
        {
          path: conflict.path,
          localHash: conflict.localHash,
          incomingHash: conflict.incomingHash,
          choice: "keep-both",
        },
      ]),
    );
    const done = cli("--resolutions", choices);
    assert.equal(done.status, 0, done.stderr + done.stdout);
    service = new StudioService(root);
    const current = (await service.architectureOverview()).index;
    const bodies = await Promise.all(
      current.documents.map((d) =>
        service.architectureDocument(current.id, d.path),
      ),
    );
    assert.ok(bodies.some((d) => d.text === "# Decision\nLocal review"));
    assert.ok(bodies.some((d) => d.text === "# Decision\nIncoming revision"));
    assert.equal(
      await readFile(join(root, "README.md"), "utf8"),
      "# Decision\nIncoming revision",
    );
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI refresh keeps the document selection established by init", async () => {
  const { mkdir } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "pym-source-profile-"));
  let service;
  try {
    await mkdir(join(root, "docs"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "README.md"), "# Project");
    await writeFile(join(root, "docs", "design.md"), "# Plan");
    await writeFile(join(root, "package.json"), '{"private":true}');
    await writeFile(join(root, "src", "code.pym"), "flow main() -> Unit {}");
    const initial = await setupProject(
      root,
      "Same source",
      true,
      new AbortController().signal,
    );
    const refreshed = spawnSync(
      process.execPath,
      [
        resolve("dist/cli/main.js"),
        "import-architecture",
        root,
        "--into",
        root,
      ],
      { encoding: "utf8" },
    );
    assert.equal(refreshed.status, 0, refreshed.stderr + refreshed.stdout);
    const response = JSON.parse(refreshed.stdout);
    assert.equal(response.unchanged, true, JSON.stringify(response));
    assert.equal(response.revision, initial.documentation.revision);
    service = new StudioService(root);
    const overview = await service.architectureOverview();
    assert.equal(overview.sources.length, 1);
    assert.equal(overview.sources[0].selection, "project-documents");
    assert.ok(
      !overview.index.documents.some(
        (d) => d.path === "package.json" || d.path === "src/code.pym",
      ),
    );
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});
