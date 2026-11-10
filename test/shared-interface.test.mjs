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
test("shared type edits retain internal comments and explain their new placement", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-type-comments-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(
      file,
      "type Customer = {\n// stable provider ID\nid: Nat,\n// visible customer name\nname: String\n};\nflow inspect(customer: Customer) -> Unit {}",
    );
    const { ir } = analyseFile(file);
    const description = describeSignature(ir, file + "#inspect");
    const changed = rewriteSignature(
      ir,
      description.symbolId,
      {
        ...description,
        typeEdits: [
          {
            symbolId: file + "#Customer",
            definition: {
              kind: "record",
              name: "Customer",
              fields: [
                { name: "id", type: "Nat" },
                { name: "name", type: "String" },
                { name: "active", type: "Bool" },
              ],
            },
          },
        ],
      },
      description.sourceHash,
    );
    assert.match(changed.text, /\/\/ stable provider ID/);
    assert.match(changed.text, /\/\/ visible customer name/);
    assert.match(changed.notices.join(" "), /2 comments retained above/);
    const checked = analyseFile(file, () => {}, {
      buffers: { [file]: changed.text },
    });
    assert.deepEqual(
      checked.report.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    const revised = describeSignature(checked.ir, file + "#inspect");
    const second = rewriteSignature(
      checked.ir,
      revised.symbolId,
      {
        ...revised,
        typeEdits: [
          {
            symbolId: file + "#Customer",
            definition: {
              kind: "record",
              name: "Customer",
              fields: [
                { name: "name", type: "String" },
                { name: "active", type: "Bool" },
              ],
            },
          },
        ],
      },
      revised.sourceHash,
    );
    assert.match(second.notices.join(" "), /Existing comments above this type/);
    assert.match(second.text, /stable provider ID/);
    const fields = Array.from({ length: 20 }, (_, i) => ({
      name: "longField" + i,
      type: "String",
    }));
    const long = rewriteSignature(
      checked.ir,
      revised.symbolId,
      {
        ...revised,
        typeEdits: [
          {
            symbolId: file + "#Customer",
            definition: { kind: "record", name: "Customer", fields },
          },
        ],
      },
      revised.sourceHash,
    );
    assert.match(long.text, /type Customer = \{\n  longField0: String,/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a trailing variant comment retains its original association after new variants are added", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-variant-comment-"));
  try {
    const file = join(root, "main.pym"),
      source =
        "type PayError = Declined | Unavailable; // provider outage\nop charge() -> Result<Bool, PayError>;";
    await writeFile(file, source);
    const { ir } = analyseFile(file),
      d = describeSignature(ir, file + "#charge");
    const changed = rewriteSignature(
      ir,
      d.symbolId,
      {
        ...d,
        typeEdits: [
          {
            symbolId: file + "#PayError",
            definition: {
              kind: "choice",
              name: "PayError",
              variants: [
                { name: "Declined" },
                { name: "Unavailable" },
                { name: "Fraud" },
              ],
            },
          },
        ],
      },
      d.sourceHash,
    );
    assert.ok(changed.text.includes("Previous PayError.Unavailable comment"));
    assert.ok(changed.text.includes("// provider outage"));
    assert.doesNotMatch(changed.text, /Fraud; \/\/ provider outage/);
    assert.ok(changed.notices.some((n) => n.includes("1 comment")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
