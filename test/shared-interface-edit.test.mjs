import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import {
  describeSignature,
  describeTypeDefinition,
  rewriteSignature,
} from "../dist/studio/signature.js";
import { readSourceEditPreview } from "../dist/studio/interface-data.js";
test("shared error edit previews the owning file and rechecking exposes the incomplete consumer", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-shared-edit-"));
  try {
    const types = join(root, "types.pym"),
      main = join(root, "main.pym");
    const typesText = "// retain this type context\ntype Errors = Declined;\n";
    const text =
      'import "types.pym";\nop send() -> Result<Nat, Errors>;\nflow run() -> Nat {\n  // handwritten outcomes\n  call send() as result;\n  match result { Ok(value) => { return value; } Declined => { return 0; } }\n}\n';
    await writeFile(types, typesText);
    await writeFile(main, text);
    const { ir, report } = analyseFile(main);
    assert.deepEqual(
      report.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    const d = describeSignature(ir, main + "#run");
    const shared = describeTypeDefinition(
      ir,
      d.types.find((t) => t.name === "Errors").symbolId,
    );
    assert.equal(shared.symbolId, types + "#Errors");
    const preview = readSourceEditPreview(
      rewriteSignature(
        ir,
        d.symbolId,
        {
          ...d,
          typeEdits: [
            {
              symbolId: shared.symbolId,
              definition: {
                ...shared.definition,
                variants: [
                  ...shared.definition.variants,
                  { name: "OutcomeUnknown" },
                ],
              },
            },
          ],
        },
        d.sourceHash,
      ),
    );
    assert.equal(preview.files.length, 1);
    assert.equal(preview.files[0].file, types);
    assert.equal(preview.files[0].before, typesText);
    assert.equal(preview.text, text);
    assert.ok(preview.affected.some((d) => d.name === "run"));
    assert.equal(await readFile(types, "utf8"), typesText);
    await writeFile(types, preview.files[0].text);
    const errors = analyseFile(main).report.diagnostics;
    assert.ok(
      errors.some((d) => /OutcomeUnknown/.test(d.message)),
      JSON.stringify(errors),
    );
    assert.equal(await readFile(main, "utf8"), text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("new inline record becomes a declaration without replacing the handwritten body", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-new-type-"));
  try {
    const main = join(root, "main.pym");
    const text = "flow run() -> Bool { return true; }\n";
    await writeFile(main, text);
    const { ir } = analyseFile(main);
    const d = describeSignature(ir, main + "#run");
    const preview = rewriteSignature(
      ir,
      d.symbolId,
      {
        ...d,
        inputs: [
          {
            name: "customer",
            type: {
              kind: "record",
              name: "Customer",
              fields: [{ name: "name", type: "String" }],
            },
          },
        ],
      },
      d.sourceHash,
    );
    assert.match(preview.text, /type Customer = \{ name: String \};/);
    assert.match(
      preview.text,
      /flow run\(customer: Customer\) -> Bool \{ return true; \}/,
    );
    await writeFile(main, preview.text);
    assert.deepEqual(
      analyseFile(main).report.diagnostics.filter(
        (d) => d.severity === "error",
      ),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("nominal identities cannot be switched by spelling and unchanged value modes preserve header comments", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-type-identity-"));
  try {
    const main = join(root, "main.pym");
    const text =
      "type Customer = { id: Nat };\nflow run(// keep input documentation\n customer: Customer) -> Bool { return true; }";
    await writeFile(main, text);
    const { ir } = analyseFile(main);
    const d = describeSignature(ir, main + "#run");
    assert.equal(d.inputs[0].type.symbolId, main + "#Customer");
    const input = { ...d.inputs[0] };
    delete input.mode;
    assert.equal(
      rewriteSignature(ir, d.symbolId, { ...d, inputs: [input] }, d.sourceHash)
        .text,
      text,
    );
    assert.throws(
      () =>
        rewriteSignature(
          ir,
          d.symbolId,
          {
            ...d,
            inputs: [
              {
                ...input,
                type: { ...input.type, symbolId: "another-file#Customer" },
              },
            ],
          },
          d.sourceHash,
        ),
      /uniquely available/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
