// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
const file =
  "resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; Closed -> Closed; } type E = Failed; op open() -> Result<File, E> effects(state.File) creates result; ";
function report(source) {
  const dir = mkdtempSync(join(tmpdir(), "pym-own-"));
  try {
    const path = join(dir, "x.pym");
    writeFileSync(path, source);
    return analyseFile(path).report;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("resource-producing Results are handled and cleaned on every declared exit", () => {
  const r = report(
    file +
      "flow main() -> Result<Unit,E> effects(state.File) { call open() as r; match r { Ok(f) => { transition f -> Closed; return Ok(unit); } Failed => { return Failed; } } } on cancel { transition f -> Closed; }",
  );
  assert.deepEqual(
    r.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assert.equal(
    r.results.find((x) => x.analysisKind === "ownership-lifecycle").outcome,
    "established",
  );
});
test("a resource-returning call still exposes an error-branch leak", () => {
  const r = report(
    file +
      "flow main() -> Unit effects(state.File) { call open() as r; match r { Ok(f) => { return unit; } Failed => { return unit; } } } on cancel { transition f -> Closed; }",
  );
  assert.ok(r.diagnostics.some((d) => d.code === "O004"));
});
