import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
test("emit produces a real model and snapshot-qualified source map", () => {
  const dir = mkdtempSync(join(tmpdir(), "pym-emit-"));
  try {
    const out = join(dir, "task.qnt");
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
        out,
        "--format",
        "json",
      ],
      { encoding: "utf8" },
    );
    assert.ifError(p.error);
    assert.equal(p.status, 0, p.stdout);
    const r = JSON.parse(p.stdout),
      map = JSON.parse(readFileSync(out + ".map.json", "utf8"));
    assert.equal(map.snapshotId, r.snapshot.id);
    assert.ok(readFileSync(out, "utf8").includes("module generated"));
    assert.ok(map.events.some((e) => e.source === "runJob"));
    assert.ok(map.sources[0].text.includes("machine TaskRunner"));
    assert.equal(r.artifacts.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("typed structured flow cannot silently emit a successful empty model", () => {
  const dir = mkdtempSync(join(tmpdir(), "pym-no-emit-"));
  try {
    const out = join(dir, "invalid.qnt");
    const p = spawnSync(
      process.execPath,
      [
        "dist/cli/main.js",
        "emit",
        "examples/mvp/algorithm.pym",
        "--entry",
        "nestedScan",
        "--target",
        "quint",
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
