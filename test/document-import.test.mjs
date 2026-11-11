import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readArchitectureFolder } from "../dist/architecture/store.js";
import {
  indexArchitecture,
  architectureDetail,
} from "../dist/architecture/model.js";
import { architectureHeadings } from "../dist/architecture/headings.js";
import { folderInventory } from "../dist/architecture/import-policy.js";
import {
  documentationDirectory,
  projectDocumentationPath,
} from "../dist/shared/document-selection.js";
import { renderImportSummary } from "../dist/cli/import-summary.js";
const fixtures = resolve("test/fixtures/document-import");
const defaults = {
  directory: documentationDirectory,
  file: projectDocumentationPath,
};

test("default project selection imports doc/RST with linkable sections and unchanged docs/Markdown", async () => {
  const loaded = await readArchitectureFolder(fixtures, defaults);
  assert.deepEqual(
    loaded.documents.map((d) => d.path),
    ["doc/guide.rst", "docs/legacy.md"],
  );
  const index = indexArchitecture(loaded.documents);
  const headings = index.entities.filter((e) => e.kind === "heading");
  assert.deepEqual(
    headings.map((e) => e.name),
    [
      "Project guide",
      "Requirements",
      "Operations",
      "Existing guide",
      "Details",
    ],
  );
  const requirement = headings.find((e) => e.name === "Requirements");
  const rst = loaded.documents[0];
  assert.equal(
    architectureDetail(rst, requirement.pointer),
    "Requirements\n------------\n\nKeep the original document.\n",
  );
  assert.equal(
    headings.find((e) => e.name === "Existing guide").id,
    "heading:docs/legacy.md#existing-guide",
  );
  assert.equal(loaded.skipped.counts["unsupported-type"], 1);
  assert.equal(loaded.skipped.counts["outside-selection"], 1);
});

test("a single named file imports with original source text and sections", async () => {
  const loaded = await readArchitectureFolder(join(fixtures, "doc/guide.rst"));
  assert.equal(loaded.documents[0].path, "guide.rst");
  assert.match(loaded.documents[0].text, /Project guide\n=============/);
  assert.equal(
    indexArchitecture(loaded.documents).entities.filter(
      (e) => e.kind === "heading",
    ).length,
    3,
  );
  assert.equal(loaded.skipped.total, 0);
});

test("explicit include overrides default scope; exclude wins and is reported", async () => {
  const options = {
    ...defaults,
    include: ["engineering/**", "doc/", "docs/*.md"],
    exclude: ["doc/**"],
  };
  const loaded = await readArchitectureFolder(fixtures, options);
  assert.deepEqual(
    loaded.documents.map((d) => d.path),
    ["docs/legacy.md", "engineering/plan.txt"],
  );
  assert.ok(
    loaded.skipped.paths.some(
      (p) => p.path === "doc/guide.rst" && p.reason === "excluded",
    ),
  );
  const inventory = folderInventory(
    [
      { path: "doc/guide.rst", bytes: 10 },
      { path: "docs/legacy.md", bytes: 20 },
      { path: "engineering/plan.txt", bytes: 30 },
    ],
    "project-documents",
    options,
  );
  assert.deepEqual(
    inventory.included,
    loaded.documents.map((d) => d.path),
  );
  assert.equal(inventory.skipped.counts.excluded, 1);
  assert.deepEqual(
    (await readArchitectureFolder(fixtures, { include: [] })).documents,
    [],
  );
});

test("skip reports group reasons, bound paths, and state directory counts", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-document-import-"));
  try {
    for (let i = 0; i < 105; i++)
      await writeFile(
        join(scratch, `${i}.pdf`),
        "original unsupported fixture",
      );
    await writeFile(join(scratch, "large.md"), "");
    await truncate(join(scratch, "large.md"), 16 * 1024 * 1024 + 1);
    const loaded = await readArchitectureFolder(scratch);
    assert.equal(loaded.documents.length, 0);
    assert.equal(loaded.skipped.counts["unsupported-type"], 105);
    assert.equal(loaded.skipped.counts["too-large"], 1);
    assert.equal(loaded.skipped.total, 106);
    assert.equal(loaded.skipped.paths.length, 100);
    assert.equal(loaded.skipped.truncated, 6);
    const rendered = renderImportSummary({
      committed: false,
      changes: { added: [], changed: [], removed: [] },
      skipped: loaded.skipped,
    });
    assert.match(rendered, /unsupported-type: 105/);
    assert.match(rendered, /path limit 100/);
    assert.match(rendered, /6 paths omitted/);
    assert.match(rendered, /directory counts exclude uninspected descendants/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("RST section hierarchy and duplicate slugs preserve original spans", () => {
  const text =
    "=========\nTop title\n=========\n\nBody.\n\nChild\n-----\n\nChild body.\n\nChild\n-----\n\nOther body.\n";
  const headings = architectureHeadings(text, "plan.rst");
  assert.deepEqual(
    headings.map((h) => [h.title, h.level, h.slug]),
    [
      ["Top title", 1, "top-title"],
      ["Child", 2, "child"],
      ["Child", 2, "child-1"],
    ],
  );
  assert.equal(headings[0].text, text);
  assert.equal(headings[1].end, headings[2].line);
  assert.equal(
    architectureHeadings(
      "Literal::\n\n    Example\n    =======\n",
      "example.rst",
    ).length,
    0,
  );
});

test("glob matching supports zero-depth **, ?, literals, and rejects escaping paths", async () => {
  const loaded = await readArchitectureFolder(fixtures, {
    include: ["**/legac?.md"],
  });
  assert.deepEqual(
    loaded.documents.map((d) => d.path),
    ["docs/legacy.md"],
  );
  assert.throws(
    () =>
      folderInventory([{ path: "docs/legacy.md", bytes: 1 }], "all-text", {
        include: ["../*"],
      }),
    /relative paths/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readArchitectureFolder(fixtures, { signal: controller.signal }),
    { name: "AbortError" },
  );
});

test("RST heading identities survive a refresh with an unrelated section inserted", async () => {
  const { prepareHeadingIdentities, identifiedHeadings } = await import(
    "../dist/architecture/heading-identities.js"
  );
  const loaded = await readArchitectureFolder(join(fixtures, "doc/guide.rst"));
  const current = prepareHeadingIdentities([], loaded.documents);
  const before = identifiedHeadings(current).headings.get("guide.rst");
  const next = prepareHeadingIdentities(current, [
    {
      path: "guide.rst",
      text:
        loaded.documents[0].text +
        "\nAppendix\n--------\n\nAdditional information.\n",
    },
  ]);
  const after = identifiedHeadings(next).headings.get("guide.rst");
  for (const heading of before)
    assert.equal(after.find((h) => h.title === heading.title).id, heading.id);
  assert.equal(after.length, 4);
});

test("upload preflight rejects oversized files with the too-large discovery reason", () => {
  assert.throws(
    () => folderInventory([{ path: "large.rst", bytes: 16 * 1024 * 1024 + 1 }]),
    (error) => {
      assert.match(error.message, /16 MiB/);
      assert.equal(error.skipped.counts["too-large"], 1);
      assert.equal(error.skipped.paths[0].path, "large.rst");
      return true;
    },
  );
});
