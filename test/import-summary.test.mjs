import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("human import preview lists source changes without committing the architecture", () => {
  const root = mkdtempSync(join(tmpdir(), "pym-import-text-"));
  try {
    const source = join(root, "source"),
      project = join(root, "project");
    mkdirSync(source);
    mkdirSync(project);
    writeFileSync(join(source, "decisions.md"), "# Design\nRetain backups.");
    const run = spawnSync(
      process.execPath,
      [
        "dist/cli/main.js",
        "import-architecture",
        source,
        "--into",
        project,
        "--preview",
        "--format",
        "text",
      ],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /preview — no changes saved/);
    assert.match(run.stdout, /Added:/);
    assert.match(run.stdout, /decisions.md/);
    assert.doesNotMatch(run.stdout, /^\{/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
