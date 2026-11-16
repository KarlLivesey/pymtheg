// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import {
  describeSignature,
  describeTypeDefinition,
} from "../dist/studio/signature.js";
test("large checked catalogue returns identities without expanding unrelated definitions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-type-catalogue-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(
      file,
      Array.from(
        { length: 1000 },
        (_, i) => `type Record${i} = {id: Nat, name: String};`,
      ).join("\n") + "\nflow main(value: Record0) -> Bool {return true;}",
    );
    const { ir, report } = analyseFile(file);
    assert.deepEqual(
      report.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    const signature = describeSignature(ir, file + "#main");
    assert.equal(signature.types.length, 1000);
    assert.ok(signature.types.every((t) => !Object.hasOwn(t, "definition")));
    assert.equal(new Set(signature.types.map((t) => t.symbolId)).size, 1000);
    const type = describeTypeDefinition(ir, file + "#Record999");
    assert.equal(type.snapshotId, signature.snapshotId);
    assert.equal(type.sourceHash, signature.sourceHash);
    assert.deepEqual(type.definition, {
      kind: "record",
      name: "Record999",
      fields: [
        { name: "id", type: "Nat" },
        { name: "name", type: "String" },
      ],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
