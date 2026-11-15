import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
test("emit writes the built-in engines' model with snapshot-qualified source mapping", () => {
  const dir = mkdtempSync(join(tmpdir(), "pym-emit-"));
  try {
    const out = join(dir, "task.json");
    const p = spawnSync(
      process.execPath,
      [
        "dist/cli/main.js",
        "emit",
        "examples/mvp/task-buggy.pym",
        "--entry",
        "TaskRunner",
        "--target",
        "json",
        "--out",
        out,
        "--format",
        "json",
      ],
      { encoding: "utf8" },
    );
    assert.ifError(p.error);
    assert.equal(p.status, 0, p.stdout);
    const r = JSON.parse(p.stdout),
      model = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(model.schema, "pymtheg.model/v1");
    assert.equal(model.snapshotId, r.snapshot.id);
    assert.equal(model.machine.name, "TaskRunner");
    assert.ok(model.events.some((e) => e.source === "runJob"));
    assert.ok(model.properties.length > 0);
    assert.deepEqual(
      model.sources.map((s) => s.hash),
      r.snapshot.files.map((s) => s.hash),
    );
    assert.deepEqual(r.artifacts, [out]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("typed structured flow cannot silently emit a successful empty model", () => {
  const dir = mkdtempSync(join(tmpdir(), "pym-no-emit-"));
  try {
    const out = join(dir, "invalid.json");
    const p = spawnSync(
      process.execPath,
      [
        "dist/cli/main.js",
        "emit",
        "examples/mvp/algorithm.pym",
        "--entry",
        "nestedScan",
        "--target",
        "json",
        "--out",
        out,
        "--format",
        "json",
      ],
      { encoding: "utf8" },
    );
    assert.ifError(p.error);
    assert.equal(p.status, 2, p.stdout);
    assert.equal(existsSync(out), false);
    assert.equal(JSON.parse(p.stdout).results.at(-1).completion, "incomplete");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("emit names its one target instead of accepting the removed Quint target", () => {
  const p = spawnSync(
    process.execPath,
    [
      "dist/cli/main.js",
      "emit",
      "examples/mvp/task-buggy.pym",
      "--entry",
      "TaskRunner",
      "--target",
      "quint",
      "--out",
      join(tmpdir(), "never-written.qnt"),
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(p.status, 0);
  assert.match(p.stderr + p.stdout, /emit requires --target json --out PATH/);
});
