import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  rename,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { ArchitectureStore } from "../dist/architecture/store.js";
const cli = resolve("dist/cli/main.js");
const run = (...args) => {
  const r = spawnSync(process.execPath, [cli, "import-architecture", ...args], {
    encoding: "utf8",
  });
  assert.ifError(r.error);
  return r;
};
test("a moved source retains its identity and refreshes through an explicit source ID", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-relocate-"));
  try {
    const source = join(root, "old"),
      moved = join(root, "new"),
      into = join(root, "workspace");
    await mkdir(source);
    await mkdir(into);
    await writeFile(join(source, "plan.md"), "Original");
    let r = run(
      source,
      "--into",
      into,
      "--name",
      "First",
      "--source-name",
      "Service design",
    );
    assert.equal(r.status, 0, r.stderr);
    const result = JSON.parse(r.stdout),
      sourceId = result.changes.sources[0].id;
    const unchanged = run(source, "--into", into);
    assert.equal(unchanged.status, 0, unchanged.stdout + unchanged.stderr);
    assert.equal(JSON.parse(unchanged.stdout).unchanged, true);
    assert.equal(JSON.parse(unchanged.stdout).committed, false);
    assert.equal(JSON.parse(unchanged.stdout).revision, result.revision);
    const retained = await ArchitectureStore.open(into, { readOnly: true });
    try {
      assert.equal(retained.revisions().length, 1);
      const registry = JSON.parse(
        retained.document(result.revision, ".pymtheg-sources.json").text,
      );
      assert.equal(registry.sources[0].label, "Service design");
    } finally {
      retained.close();
    }
    const named = run(
      source,
      "--into",
      into,
      "--name",
      "Explicit equal checkpoint",
    );
    assert.equal(named.status, 0);
    assert.notEqual(JSON.parse(named.stdout).revision, result.revision);
    await rename(source, moved);
    const ambiguous = run(moved, "--into", into);
    assert.equal(ambiguous.status, 3);
    assert.match(ambiguous.stderr, /may have moved/);
    assert.match(ambiguous.stderr, /--source-id/);
    await writeFile(join(moved, "plan.md"), "Changed after move");
    r = run(moved, "--into", into, "--source-id", sourceId, "--name", "Moved");
    assert.equal(r.status, 0, r.stderr);
    const refreshed = JSON.parse(r.stdout);
    const subsequent = run(moved, "--into", into);
    assert.equal(subsequent.status, 0, subsequent.stdout + subsequent.stderr);
    assert.equal(JSON.parse(subsequent.stdout).revision, refreshed.revision);
    assert.equal(
      JSON.parse(subsequent.stdout).changes.sources[0].label,
      "Service design",
    );
    assert.equal(refreshed.changes.sources.length, 1);
    assert.equal(refreshed.changes.sources[0].id, sourceId);
    const store = await ArchitectureStore.open(into, { readOnly: true });
    try {
      assert.equal(
        store.document(store.read().id, "plan.md").text,
        "Changed after move",
      );
    } finally {
      store.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
