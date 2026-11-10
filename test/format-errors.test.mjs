import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { formatSource, FormatSyntaxError } from "../dist/language/format.js";
test("formatter reports the first real syntax location and does not write malformed files", () => {
  const root = mkdtempSync(join(tmpdir(), "pym-format-error-"));
  try {
    for (const newline of ["\n", "\r\n"]) {
      const source = ["// 🔎", "flow bad( {", "}"].join(newline);
      const file = join(root, "bad.pym");
      assert.throws(
        () => formatSource(file, source),
        (e) =>
          e instanceof FormatSyntaxError &&
          /bad.pym:2:\d+ P002:/.test(e.message),
      );
      writeFileSync(file, source);
      for (const flag of ["--check", "--write"]) {
        const run = spawnSync(
          process.execPath,
          ["dist/cli/main.js", "fmt", file, flag],
          { encoding: "utf8" },
        );
        assert.ifError(run.error);
        assert.equal(run.status, 1, run.stderr);
        assert.equal(run.stdout, "");
        assert.match(run.stderr, /bad.pym:2:\d+ P002:/);
        assert.doesNotMatch(run.stderr, /I001|snapshot unavailable/);
        assert.equal(readFileSync(file, "utf8"), source);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formatter check reports a positive line for a missing final newline", () => {
  const root = mkdtempSync(join(tmpdir(), "pym-format-newline-"));
  try {
    const file = join(root, "main.pym");
    writeFileSync(file, "flow main() -> Unit { return unit; }");
    const run = spawnSync(
      process.execPath,
      ["dist/cli/main.js", "fmt", file, "--check"],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 1, run.stderr);
    assert.doesNotMatch(run.stdout + run.stderr, /:0\b|line 0/);
    assert.match(run.stdout + run.stderr, /line 1;/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
