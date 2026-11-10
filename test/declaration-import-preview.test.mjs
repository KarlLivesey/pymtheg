import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import { previewDeclarationImports } from "../dist/studio/declaration-imports.js";
import { readSourceEditPreview } from "../dist/studio/interface-data.js";
import { hash } from "../dist/shared/identity.js";
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "pym-import-preview-"));
  const file = join(root, "main.pym"),
    lib = join(root, "types.pym");
  const main = "flow keep() -> Unit { return unit; }",
    library = "type Order = { id: Nat };";
  try {
    await writeFile(file, main);
    await writeFile(lib, library);
    const { ir } = analyseFile(file);
    const base = {
      ir,
      root,
      file,
      sourceHash: hash(main),
      value: {
        kind: "component",
        signature: {
          name: "process",
          inputs: [
            {
              name: "order",
              type: { kind: "named", name: "Order", symbolId: lib + "#Order" },
            },
          ],
          output: "Unit",
          effects: [],
        },
      },
      selections: [
        { symbolId: lib + "#Order", file: lib, sourceHash: hash(library) },
      ],
      signal: new AbortController().signal,
    };
    await fn({ base, root, file, lib, main, library });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("import preview checks selected type sources in one expanded snapshot without changing files", () =>
  fixture(async ({ base, file, lib, main, library }) => {
    const result = readSourceEditPreview(await previewDeclarationImports(base));
    assert.equal(result.baseSnapshotId, base.ir.snapshot.id);
    assert.notEqual(result.snapshotId, base.ir.snapshot.id);
    assert.deepEqual(result.importedSources, [
      { file: lib, hash: hash(library) },
    ]);
    assert.match(result.text, /import "\.\/types.pym"/);
    assert.equal(await readFile(file, "utf8"), main);
    assert.equal(await readFile(lib, "utf8"), library);
  }));
test("changed, removed and outside-project selections cannot become silent replacements", () =>
  fixture(async ({ base, lib, root }) => {
    await writeFile(lib, "type Order = { changed: Bool };");
    await assert.rejects(
      previewDeclarationImports(base),
      /selected type source changed/,
    );
    await writeFile(lib, "type Replacement = { id: Nat };");
    await assert.rejects(
      previewDeclarationImports({
        ...base,
        selections: [
          {
            ...base.selections[0],
            sourceHash: hash("type Replacement = { id: Nat };"),
          },
        ],
      }),
      /no longer present/,
    );
    await assert.rejects(
      previewDeclarationImports({
        ...base,
        selections: [
          { ...base.selections[0], file: join(root, "..", "elsewhere.pym") },
        ],
      }),
      /inside this project/,
    );
  }));
test("unsaved external type buffers are checked as selected, and cancellation wins", () =>
  fixture(async ({ base, lib }) => {
    const text = "type Order = { unsaved: String };";
    const result = await previewDeclarationImports({
      ...base,
      buffers: { [lib]: text },
      selections: [{ ...base.selections[0], sourceHash: hash(text) }],
    });
    assert.deepEqual(result.importedSources, [{ file: lib, hash: hash(text) }]);
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      previewDeclarationImports({ ...base, signal: abort.signal }),
      /aborted/,
    );
  }));
