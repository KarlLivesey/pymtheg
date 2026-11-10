import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import { describeTypeDefinition } from "../dist/studio/signature.js";
import { readSourceEditPreview } from "../dist/studio/interface-data.js";

test("a standalone shape adds and removes fields without a callable or source writes", async () => {
  const { rewriteType } = await import("../dist/studio/type-edit.js");
  const root = await mkdtemp(join(tmpdir(), "pym-type-edit-"));
  try {
    const file = join(root, "types.pym");
    const source =
      "// Shared request\ntype Request = { count: Nat, // quota\n label: String }; // public contract\n";
    await writeFile(file, source);
    const { ir } = analyseFile(file);
    const original = describeTypeDefinition(ir, file + "#Request");
    const edited = {
      ...original.definition,
      fields: [
        { name: "count", type: "Nat" },
        { name: "enabled", type: "Bool" },
      ],
    };
    const preview = readSourceEditPreview(
      rewriteType(ir, original.symbolId, edited, original.sourceHash),
    );
    assert.match(preview.text, /enabled: Bool/);
    assert.doesNotMatch(preview.text, /label: String/);
    assert.match(preview.text, /Previous Request.count comment/);
    assert.match(preview.text, /\/\/ quota/);
    assert.match(preview.text, /public contract/);
    assert.equal(preview.notices.length, 2);
    assert.equal(await readFile(file, "utf8"), source);
    const checked = analyseFile(file, () => {}, {
      buffers: { [file]: preview.text },
    });
    assert.deepEqual(checked.report.diagnostics, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone outcome additions identify callers and expose missing handlers", async () => {
  const { rewriteType } = await import("../dist/studio/type-edit.js");
  const root = await mkdtemp(join(tmpdir(), "pym-type-callers-"));
  try {
    const types = join(root, "types.pym"),
      main = join(root, "main.pym");
    await writeFile(types, "type Errors = Failed;\n");
    await writeFile(
      main,
      'import "types.pym"; op send() -> Result<Unit, Errors>; flow main() -> Result<Unit, Errors> { call send() as r; match r { Ok(value) => { return Ok(value); } Failed => { return Failed; } } }',
    );
    const { ir } = analyseFile(main);
    const original = describeTypeDefinition(ir, types + "#Errors");
    const next = {
      ...original.definition,
      variants: [...original.definition.variants, { name: "Unknown" }],
    };
    const preview = rewriteType(
      ir,
      original.symbolId,
      next,
      original.sourceHash,
    );
    assert.ok(preview.affected.some((d) => d.name === "main"));
    const checked = analyseFile(main, () => {}, {
      buffers: { [types]: preview.text },
    });
    assert.ok(
      checked.report.diagnostics.some(
        (d) => d.code === "C002" && /Unknown/.test(d.message),
      ),
    );
    assert.throws(
      () => rewriteType(ir, original.symbolId, next, "stale"),
      /snapshot/,
    );
    assert.throws(
      () =>
        rewriteType(
          ir,
          original.symbolId,
          { ...next, name: "Renamed" },
          original.sourceHash,
        ),
      /name/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a recovered region cannot produce a complete affected-definition claim", async () => {
  const { rewriteType } = await import("../dist/studio/type-edit.js");
  const root = await mkdtemp(join(tmpdir(), "pym-type-partial-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(
      file,
      "type Request = { id: Nat }; flow broken() -> Unit { call ; }",
    );
    const { ir } = analyseFile(file),
      original = describeTypeDefinition(ir, file + "#Request");
    const preview = rewriteType(
      ir,
      original.symbolId,
      {
        ...original.definition,
        fields: [
          ...original.definition.fields,
          { name: "label", type: "String" },
        ],
      },
      original.sourceHash,
    );
    assert.equal(preview.affectedComplete, false);
    assert.ok(
      preview.notices.some((notice) => /recovered syntax/.test(notice)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
