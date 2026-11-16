// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import { contractDocument } from "../dist/contracts/document.js";
import { scaffold } from "../dist/contracts/scaffold.js";
for (const scenario of [
  "empty",
  "partial",
  "multiple-empty",
  "explicit-root",
]) {
  test(`portable omission provenance: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pym-portable-omissions-"));
    try {
      await mkdir(join(root, "nested"));
      const broken = join(root, "broken.pym"),
        nested = join(root, "nested/other.pym");
      await writeFile(broken, "flow charge(input: Nat -> Bool {");
      await writeFile(
        nested,
        scenario === "partial" ? "op read() -> Nat;" : "type Missing = {",
      );
      const options =
        scenario === "explicit-root"
          ? { root }
          : scenario === "empty"
            ? {}
            : { additionalEntries: [nested] };
      const ir = analyseFile(broken, undefined, options).ir;
      const doc = contractDocument(ir);
      assert.equal(doc.sourceRoot, ".");
      assert.deepEqual(
        doc.omitted.map((x) => x.name).sort(),
        scenario === "multiple-empty"
          ? ["broken.pym", "nested/other.pym"]
          : ["broken.pym"],
      );
      assert.ok(
        doc.omitted.every((x) => x.reason.includes("coverage is unknown")),
      );
      if (scenario === "partial")
        assert.equal(doc.declarations[0].span.file, "nested/other.pym");
      for (const target of ["typescript", "rust", "go"]) {
        const out = scaffold(ir, target);
        assert.deepEqual(out.omitted, doc.omitted);
        assert.deepEqual(out.contractManifest.omitted, doc.omitted);
        assert.ok(!JSON.stringify(out).includes(root));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
