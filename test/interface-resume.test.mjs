import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import {
  describeSignature,
  describeTypeDefinition,
  resumeSignature,
  rewriteSignature,
} from "../dist/studio/signature.js";
import { readInterfaceDraft } from "../dist/studio/interface-data.js";
const original =
  "type Customer = {id: Nat};\nflow quote(value: Nat) -> Bool {return value > 0;}";
test("saved interface fields resume across body edits but preserve the newest body when applied", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-interface-resume-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(file, original);
    const ir = analyseFile(file).ir,
      d = describeSignature(ir, file + "#quote");
    const draft = readInterfaceDraft({
      file: "main.pym",
      symbolId: d.symbolId,
      snapshotId: d.snapshotId,
      baseline: { signature: d, headerHash: d.headerHash, types: [] },
      edit: { ...d, inputs: [...d.inputs, { name: "urgent", type: "Bool" }] },
    });
    await writeFile(file, original.replace("value > 0", "value > 5"));
    const current = analyseFile(file).ir,
      resumed = resumeSignature(current, draft);
    assert.deepEqual(resumed.conflicts, []);
    assert.equal(resumed.draft.snapshotId, current.snapshot.id);
    const applied = rewriteSignature(
      current,
      d.symbolId,
      resumed.draft.edit,
      resumed.description.sourceHash,
    );
    assert.match(applied.text, /urgent: Bool/);
    assert.match(applied.text, /value > 5/);
    await writeFile(file, applied.text);
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
test("changed header comments, actual contracts and edited type comments refuse automatic resume", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-interface-conflict-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(file, original);
    const ir = analyseFile(file).ir,
      d = describeSignature(ir, file + "#quote");
    const customer = describeTypeDefinition(ir, file + "#Customer");
    const edit = {
      ...d,
      inputs: [...d.inputs, { name: "urgent", type: "Bool" }],
      typeEdits: [
        {
          symbolId: customer.symbolId,
          definition: {
            ...customer.definition,
            fields: [
              ...customer.definition.fields,
              { name: "label", type: "String" },
            ],
          },
        },
      ],
    };
    const draft = readInterfaceDraft({
      file: "main.pym",
      symbolId: d.symbolId,
      snapshotId: d.snapshotId,
      baseline: {
        signature: d,
        headerHash: d.headerHash,
        types: [
          {
            symbolId: customer.symbolId,
            definition: customer.definition,
            declarationHash: customer.declarationHash,
          },
        ],
      },
      edit,
    });
    for (const text of [
      original.replace("value: Nat", "value: Int"),
      original.replace("(value:", "(// retain new header explanation\n value:"),
    ]) {
      await writeFile(file, text);
      const result = resumeSignature(analyseFile(file).ir, draft);
      assert.ok(result.conflicts.some((c) => c.includes("inputs, output")));
      assert.deepEqual(result.draft.edit, draft.edit);
    }
    await writeFile(
      file,
      original.replace(
        "{id: Nat}",
        "{// retain new type explanation\n id: Nat}",
      ),
    );
    const result = resumeSignature(analyseFile(file).ir, draft);
    assert.ok(result.conflicts.some((c) => c.includes("Shared type Customer")));
    assert.deepEqual(result.draft.edit, draft.edit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("old drafts without baseline remain usable at their own snapshot and explicit after drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-interface-legacy-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(file, original);
    const ir = analyseFile(file).ir,
      d = describeSignature(ir, file + "#quote");
    const draft = {
      file: "main.pym",
      symbolId: d.symbolId,
      snapshotId: d.snapshotId,
      edit: d,
    };
    assert.deepEqual(resumeSignature(ir, draft).conflicts, []);
    await writeFile(file, original + "\n// later");
    assert.match(
      resumeSignature(analyseFile(file).ir, draft).conflicts[0],
      /no saved contract baseline/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renamed components return retained drafts and explicit current candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-renamed-form-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(file, original);
    const before = describeSignature(analyseFile(file).ir, file + "#quote");
    const draft = readInterfaceDraft({
      file: "main.pym",
      symbolId: before.symbolId,
      snapshotId: before.snapshotId,
      baseline: { signature: before, headerHash: before.headerHash, types: [] },
      edit: {
        ...before,
        inputs: [...before.inputs, { name: "urgent", type: "Bool" }],
      },
    });
    await writeFile(file, original.replace("flow quote", "flow price"));
    const resumed = resumeSignature(analyseFile(file).ir, draft);
    assert.equal(resumed.description, null);
    assert.match(resumed.conflicts[0], /removed or renamed/);
    assert.deepEqual(
      resumed.candidates.map((c) => c.name),
      ["price"],
    );
    assert.deepEqual(resumed.draft, draft);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
