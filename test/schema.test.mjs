import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const validate = new Ajv({ allErrors: true }).compile(
  JSON.parse(readFileSync("docs/report.schema.json", "utf8")),
);
test("CLI JSON satisfies independent published schema for errors, unknowns and costs", () => {
  for (const file of [
    "examples/mvp/algorithm.pym",
    "examples/mvp/files-buggy.pym",
    "examples/mvp/checkout.pym",
  ]) {
    const p = spawnSync(
      process.execPath,
      ["dist/cli/main.js", "check", file, "--format", "json"],
      { encoding: "utf8" },
    );
    assert.ifError(p.error);
    const r = JSON.parse(p.stdout);
    assert.equal(validate(r), true, JSON.stringify(validate.errors));
    for (const property of r.results)
      assert.equal(property.scope.snapshotHash, r.snapshot.id);
  }
});
test("schema rejects incomplete evidence dressed up as established", () => {
  const p = spawnSync(
      process.execPath,
      [
        "dist/cli/main.js",
        "check",
        "examples/mvp/algorithm.pym",
        "--format",
        "json",
      ],
      { encoding: "utf8" },
    ),
    r = JSON.parse(p.stdout);
  r.results[0].completion = "incomplete";
  r.results[0].outcome = "established";
  assert.equal(validate(r), false);
});
