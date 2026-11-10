import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import {
  describeSignature,
  rewriteSignature,
} from "../dist/studio/signature.js";
const source = `// 😀 hand-written context
rule unrelated() -> Bool = true;
flow route(value: Nat) -> Bool effects(io.Log) bound value <= 100 {
  // Keep this body exactly, including its formatting.
  if value > 10 { return true; }
  return false;
} on cancel { return false; }
`;
test("checked interface edits preserve hand-written body, cancellation, contracts and unrelated declarations", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-signature-edit-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(file, source);
    const { ir } = analyseFile(file);
    const description = describeSignature(ir, file + "#route"),
      hash = ir.snapshot.sources[0].hash;
    assert.equal(
      rewriteSignature(ir, description.symbolId, description, hash).text,
      source,
    );
    const edit = {
      ...description,
      inputs: [
        { name: "value", mode: "value", type: "Int" },
        { name: "note", type: "String" },
      ],
      effects: [{ kind: "io", target: "Audit" }],
    };
    const changed = rewriteSignature(ir, description.symbolId, edit, hash);
    assert.match(
      changed.text,
      /route\(value: Int, note: String\) -> Bool effects\(io.Audit\) bound value <= 100/,
    );
    assert.equal(
      changed.text.slice(changed.text.indexOf("{")),
      source.slice(source.indexOf("{")),
    );
    assert.ok(
      changed.text.startsWith(
        "// 😀 hand-written context\nrule unrelated() -> Bool = true;\n",
      ),
    );
    await writeFile(file, changed.text);
    const checked = analyseFile(file).report;
    assert.deepEqual(
      checked.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    const wrongResult = rewriteSignature(
      ir,
      description.symbolId,
      { ...description, output: "String" },
      hash,
    );
    assert.match(wrongResult.text, /return true/);
    await writeFile(file, wrongResult.text);
    assert.ok(
      analyseFile(file).report.diagnostics.some((d) => d.severity === "error"),
    );
    assert.throws(
      () => rewriteSignature(ir, description.symbolId, edit, "wrong snapshot"),
      /different source snapshot/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("adding effects after a changed result uses source spans without damaging the body", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-signature-effects-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(file, 'flow run() -> Unit { unknown "body decision"; }');
    const { ir } = analyseFile(file),
      description = describeSignature(ir, file + "#run");
    const changed = rewriteSignature(
      ir,
      description.symbolId,
      { ...description, effects: [{ kind: "remote", target: "Payments" }] },
      ir.snapshot.sources[0].hash,
    );
    assert.equal(
      changed.text,
      'flow run() -> Unit effects(remote.Payments) { unknown "body decision"; }',
    );
    await writeFile(file, changed.text);
    assert.deepEqual(
      analyseFile(file).report.diagnostics.filter(
        (d) => d.severity === "error",
      ),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
