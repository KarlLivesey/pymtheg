import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
test("unsaved buffers use the real compiler without overwriting disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "pym-buffers-"));
  try {
    const file = join(dir, "main.pym"),
      source =
        "op tick() -> Unit cost calls exact 1; flow f() -> Unit { call tick(); }";
    writeFileSync(file, source);
    const saved = analyseFile(file);
    const edited = analyseFile(file, () => {}, {
      root: dir,
      buffers: {
        [file]: source.replace("call tick();", "call tick(); call tick();"),
      },
    });
    assert.equal(readFileSync(file, "utf8"), source);
    assert.notEqual(saved.ir.snapshot.id, edited.ir.snapshot.id);
    assert.equal(
      edited.report.results.find((r) => r.propertyId.includes("#f/cost/"))
        .witnessOrDerivation.maximum,
      "2",
    );
    assert.equal(edited.ir.snapshot.measurements.parses, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("project root rejects imports outside its boundary", () => {
  const dir = mkdtempSync(join(tmpdir(), "pym-root-"));
  try {
    const file = join(dir, "main.pym");
    writeFileSync(file, 'import "../secret.pym"; flow f() -> Unit {}');
    const x = analyseFile(file, () => {}, {
      root: dir,
      buffers: {
        [join(dir, "..", "secret.pym")]: "rule secret() -> Bool = true;",
      },
    });
    assert.ok(x.report.diagnostics.some((d) => d.code === "L001"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
