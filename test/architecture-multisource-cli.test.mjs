// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const run = (...args) => {
  const result = spawnSync(
    process.execPath,
    [resolve("dist/cli/main.js"), "import-architecture", ...args],
    { encoding: "utf8" },
  );
  assert.ifError(result.error);
  return result;
};
test("multiple source folders have independent inventories and refresh without synthetic conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-multisource-"));
  try {
    for (const path of ["requirements", "decisions", "workspace"])
      await mkdir(join(root, path));
    await writeFile(join(root, "requirements", "req.md"), "# Requirements");
    await writeFile(join(root, "decisions", "adr.md"), "# Decisions");
    for (const source of [
      "requirements",
      "decisions",
      "requirements",
      "decisions",
    ]) {
      const result = run(
        join(root, source),
        "--into",
        join(root, "workspace"),
        "--name",
        source,
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const data = JSON.parse(result.stdout);
      assert.equal(data.committed, true);
      assert.deepEqual(data.newlyBrokenAuthoredLinks, []);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI preview and commit identify native planning links broken by an upstream deletion", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const { newPlanItem } = await import("../dist/architecture/planning.js");
  const root = await mkdtemp(join(tmpdir(), "pym-cli-link-review-"));
  let app;
  try {
    const source = join(root, "source"),
      workspace = join(root, "workspace");
    await mkdir(source);
    await mkdir(workspace);
    await writeFile(
      join(source, "old.md"),
      "## R01 Stable requirement\nKeep accepted work.",
    );
    const first = run(source, "--into", workspace, "--name", "First");
    assert.equal(first.status, 0, first.stdout + first.stderr);
    app = new StudioService(workspace);
    const index = (await app.architectureOverview()).index;
    const heading = index.entities.find((e) => e.kind === "heading");
    await app.savePlanItem(
      index.id,
      {
        ...newPlanItem("D1"),
        title: "Keep this link",
        owner: "team",
        kind: "decision",
        links: [{ kind: "depends-on", target: heading.id }],
      },
      "Plan",
      new AbortController().signal,
    );
    await app.close();
    app = null;
    await rm(join(source, "old.md"));
    const preview = run(source, "--into", workspace, "--preview");
    assert.equal(preview.status, 2, preview.stdout + preview.stderr);
    const proposed = JSON.parse(preview.stdout);
    assert.equal(proposed.newlyBrokenAuthoredLinks[0].name, "Keep this link");
    const refused = run(
      source,
      "--into",
      workspace,
      "--name",
      "Unreviewed deletion",
    );
    assert.equal(refused.status, 2);
    assert.equal(JSON.parse(refused.stdout).committed, false);
    const committed = run(
      source,
      "--into",
      workspace,
      "--name",
      "Deletion review",
      "--allow-broken-links",
    );
    assert.equal(committed.status, 2, committed.stdout + committed.stderr);
    const result = JSON.parse(committed.stdout);
    assert.equal(result.committed, true);
    assert.equal(result.newlyBrokenAuthoredLinks[0].id, "plan:D1");
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
