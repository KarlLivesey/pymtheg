// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "pym-import-"));
  try {
    for (const [name, src] of Object.entries(files))
      writeFileSync(join(dir, name), src);
    const p = spawnSync(
      process.execPath,
      ["dist/cli/main.js", "check", join(dir, "main.pym"), "--format", "json"],
      { encoding: "utf8" },
    );
    assert.ifError(p.error);
    return { code: p.status, r: JSON.parse(p.stdout) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("diamond imports load and parse exactly once", () => {
  const x = project({
    "main.pym":
      'import "a.pym"; import "b.pym"; flow f() -> Unit { let x = policy(2); }',
    "a.pym": 'import "common.pym";',
    "b.pym": 'import "common.pym";',
    "common.pym": "rule policy(x: Int) -> Bool = x > 0;",
  });
  assert.equal(x.code, 0);
  assert.equal(x.r.measurements.parses, 4);
  assert.equal(x.r.measurements.files, 4);
});
test("cycles, duplicate declarations and ambiguous imports are diagnosed", () => {
  const cycle = project({
    "main.pym": 'import "a.pym"; flow f() -> Unit {}',
    "a.pym": 'import "main.pym";',
  });
  assert.ok(cycle.r.diagnostics.some((d) => d.code === "L002"));
  const dup = project({
    "main.pym": "rule a() -> Bool = true; rule a() -> Bool = false;",
  });
  assert.equal(dup.code, 1);
  const amb = project({
    "main.pym":
      'import "a.pym"; import "b.pym"; flow f() -> Unit { let x = a(); }',
    "a.pym": "rule a() -> Bool = true;",
    "b.pym": "rule a() -> Bool = false;",
  });
  assert.ok(amb.r.diagnostics.some((d) => d.message.includes("Ambiguous")));
});
test("same spelling with different resolved module identifiers does not merge copies", () => {
  const x = project({
    "main.pym": 'import "a.pym"; import "b.pym";',
    "a.pym": "rule policy() -> Bool = true; rule usesA() -> Bool = policy();",
    "b.pym": "rule policy() -> Bool = false; rule usesB() -> Bool = policy();",
  });
  assert.ok(!x.r.diagnostics.some((d) => d.code === "D001"));
});
