import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
const run = (...args) => {
  const r = spawnSync(
    process.execPath,
    [resolve("dist/cli/main.js"), ...args],
    { encoding: "utf8" },
  );
  assert.ifError(r.error);
  return r;
};
test("human invocation failures explain the action without phantom source locations or snapshot summaries", () => {
  for (const command of ["check", "scaffold"]) {
    const result = run(command, "/tmp/does-not-exist-pymtheg-error-test.pym");
    assert.equal(result.status, 3, result.stdout + result.stderr);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /Source file was not found:.*Check the import path/,
    );
    assert.doesNotMatch(
      result.stderr,
      /I001|ENOENT|snapshot unavailable|:0 error/,
    );
  }
  const invalid = run("not-a-command");
  assert.equal(invalid.status, 3);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /Commands:.*studio/);
  assert.doesNotMatch(invalid.stderr, /I001|snapshot unavailable/);
  const json = run(
    "check",
    "/tmp/does-not-exist-pymtheg-error-test.pym",
    "--format",
    "json",
  );
  assert.equal(JSON.parse(json.stdout).session.state, "Failed");
});

test("missing entry guidance names available flows without polluting stdout", () => {
  const result = run("simulate", "examples/mvp/algorithm.pym");
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Available entries:.*nestedScan/);
});

test("every command accepts help before validating its missing arguments", () => {
  for (const command of [
    "init",
    "import-architecture",
    "mcp",
    "studio",
    "scaffold",
  ]) {
    const result = run(command, "--help");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /init \[DIRECTORY\]/);
    assert.match(result.stdout, /--import-docs/);
    assert.match(result.stdout, /--source-name/);
    assert.match(result.stdout, /--resolutions/);
    assert.match(
      result.stdout,
      /mcp \[PROJECT_DIRECTORY\] \[--plugin TARGET=PATH\]/,
    );
  }
});

test("missing imports explain the source path without raw filesystem errors", () => {
  const root = mkdtempSync(join(tmpdir(), "pym-import-explanation-"));
  try {
    const file = join(root, "main.pym");
    writeFileSync(
      file,
      'import "../../missing-outside/design.pym";\nflow main() -> Unit { return unit; }',
    );
    const run = spawnSync(
      process.execPath,
      ["dist/cli/main.js", "check", file],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 1);
    assert.match(
      run.stdout + run.stderr,
      /Source file was not found.*Check the import path/,
    );
    assert.doesNotMatch(run.stdout + run.stderr, /ENOENT|lstat/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
