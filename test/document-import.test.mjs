import test from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { readArchitectureFolder } from "../dist/architecture/store.js";
import {
  indexArchitecture,
  architectureDetail,
} from "../dist/architecture/model.js";
import { architectureHeadings } from "../dist/architecture/headings.js";
import {
  folderInventory,
  withImportInventory,
} from "../dist/architecture/import-policy.js";
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
  assert.deepEqual(inventory.excluded, [
    "doc/guide.rst (outside text-document import formats)",
  ]);
  assert.ok(
    loaded.excluded.every((path) =>
      path.endsWith(" (outside text-document import formats)"),
    ),
  );
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
    const loaded = await readArchitectureFolder(scratch);
    assert.equal(loaded.documents.length, 0);
    assert.equal(loaded.skipped.counts["unsupported-type"], 105);
    assert.equal(loaded.skipped.total, 105);
    assert.equal(loaded.skipped.paths.length, 100);
    assert.equal(loaded.skipped.truncated, 5);
    const rendered = renderImportSummary({
      committed: false,
      changes: { added: [], changed: [], removed: [] },
      skipped: loaded.skipped,
    });
    assert.match(rendered, /unsupported-type: 105/);
    assert.match(rendered, /path limit 100/);
    assert.match(rendered, /5 paths omitted/);
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

test("CLI and upload project inventories retain main's exact legacy exclusion strings", async () => {
  const scratch = await mkdtemp(
    join(tmpdir(), "pymtheg-document-import-ledger-"),
  );
  const files = [
    { path: "docs/a.md", text: "# A\n" },
    { path: "README.md", text: "# Readme\n" },
    { path: "package.json", text: "{}\n" },
    { path: "src/x.ts", text: "export {};\n" },
    { path: "notes/n.md", text: "# Notes\n" },
  ];
  try {
    for (const directory of ["docs", "src", "notes"])
      await mkdir(join(scratch, directory));
    for (const file of files)
      await writeFile(join(scratch, file.path), file.text);
    const cli = await readArchitectureFolder(scratch, defaults);
    const upload = folderInventory(
      files.map((file) => ({
        path: file.path,
        bytes: Buffer.byteLength(file.text),
      })),
      "project-documents",
    );
    const expected = [
      "notes (outside selected documentation scope)",
      "package.json (outside text-document import formats)",
      "src (outside selected documentation scope)",
    ];
    assert.deepEqual(cli.excluded, expected);
    assert.deepEqual(upload.excluded, expected);
    // Detailed reasons stay separate from the saved ledger's historical labels.
    assert.ok(
      cli.skipped.paths.some(
        (p) => p.path === "package.json" && p.reason === "outside-selection",
      ),
    );
    const cliSnapshot = withImportInventory(
      cli.documents,
      "project",
      cli.excluded,
      "project-docs",
    );
    const uploadDocuments = upload.included.map((path) =>
      files.find((file) => file.path === path),
    );
    const uploadSnapshot = withImportInventory(
      uploadDocuments,
      "project",
      upload.excluded,
      "project-docs",
    );
    assert.deepEqual(uploadSnapshot, cliSnapshot);
    assert.equal(
      cliSnapshot.at(-1).text,
      JSON.stringify(
        {
          schema: "pymtheg.import/v1",
          source: "project",
          included: ["README.md", "docs/a.md"],
          excluded: expected,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("filesystem import rejects oversized documents and attaches a discovery summary", async () => {
  const scratch = await mkdtemp(
    join(tmpdir(), "pymtheg-document-import-size-"),
  );
  try {
    const file = join(scratch, "large.rst");
    await writeFile(file, "");
    await truncate(file, 16 * 1024 * 1024 + 1);
    for (const input of [scratch, file]) {
      await assert.rejects(readArchitectureFolder(input), (error) => {
        assert.equal(
          error.message,
          "large.rst exceeds the 16 MiB document limit",
        );
        assert.equal(error.skipped.counts["too-large"], 1);
        assert.deepEqual(error.skipped.paths, [
          { path: "large.rst", reason: "too-large", kind: "file" },
        ]);
        return true;
      });
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

for (const [name, text, titles] of [
  [
    "indented title under an overline",
    "=========\n  Title  \n=========\n\nBody\n",
    ["Title"],
  ],
  [
    "short underline with at least four characters",
    "Long title here\n=====\n\nBody\n",
    ["Long title here"],
  ],
  [
    "adjacent section titles without a blank line",
    "Title\n=====\nSub\n---\n\nbody\n",
    ["Title", "Sub"],
  ],
  [
    "literal block content",
    "Literal::\n\n    Title\n    =====\n\n    Body\n",
    [],
  ],
  [
    "code-block directive content",
    ".. code-block:: text\n\n    =========\n      Title\n    =========\n\n    Body\n",
    [],
  ],
  ["transitions", "Paragraph.\n\n---------\n\nMore prose.\n", []],
  [
    "simple tables",
    "=====  =====\nName   Value\n=====  =====\nOne    Two\n=====  =====\n",
    [],
  ],
]) {
  test(`RST recognises ${name} correctly`, () => {
    const headings = architectureHeadings(text, "document.rst");
    assert.deepEqual(
      headings.map((heading) => heading.title),
      titles,
    );
    for (const heading of headings)
      assert.equal(
        heading.text,
        text.split("\n").slice(heading.line, heading.end).join("\n"),
      );
  });
}

test("a legacy Markdown-only heading registry does not falsely warn about retained RST", async () => {
  const { prepareHeadingIdentities, identifiedHeadings } = await import(
    "../dist/architecture/heading-identities.js"
  );
  const markdown = { path: "old.md", text: "# Existing\n\nBody\n" };
  const current = prepareHeadingIdentities([], [markdown]);
  const before = identifiedHeadings(current).headings.get("old.md");
  const documents = [
    ...current,
    { path: "retained.rst", text: "Title\n=====\n\nBody\n" },
  ];
  const result = identifiedHeadings(documents);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.headings.get("old.md"), before);
  assert.equal(result.headings.get("retained.rst").length, 1);
  const registered = prepareHeadingIdentities(current, documents);
  const changed = registered.map((document) =>
    document.path === "retained.rst"
      ? { ...document, text: document.text + "Changed\n" }
      : document,
  );
  assert.match(
    identifiedHeadings(changed).warnings.join("\n"),
    /retained\.rst: heading identity metadata does not match these bytes/,
  );
});

test("FIFOs are reported without changing the legacy ledger or a saved import", async () => {
  const scratch = await mkdtemp(
    join(tmpdir(), "pymtheg-document-import-fifo-"),
  );
  try {
    const source = join(scratch, "source"),
      project = join(scratch, "project");
    await mkdir(join(source, "docs"), { recursive: true });
    await mkdir(project);
    await writeFile(join(source, "docs/a.md"), "# a");
    const runImport = () =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            "dist/cli/main.js",
            "import-architecture",
            source,
            "--into",
            project,
            "--format",
            "json",
          ],
          { encoding: "utf8" },
        ),
      );
    // With ordinary documents this is the same snapshot main saved: no exclusions.
    const baseline = await readArchitectureFolder(source);
    assert.deepEqual(baseline.excluded, []);
    const first = runImport();
    assert.equal(first.committed, true);
    execFileSync("mkfifo", [
      join(source, "docs/pipe.md"),
      join(source, "fifo"),
    ]);
    const loaded = await readArchitectureFolder(source);
    assert.deepEqual(loaded.skipped.paths, [
      { path: "docs/pipe.md", reason: "special-file", kind: "entry" },
      { path: "fifo", reason: "special-file", kind: "entry" },
    ]);
    assert.deepEqual(loaded.excluded, []);
    const upload = folderInventory([{ path: "docs/a.md", bytes: 3 }]);
    assert.deepEqual(upload.excluded, loaded.excluded);
    assert.deepEqual(
      withImportInventory(loaded.documents, source, loaded.excluded),
      withImportInventory(baseline.documents, source, baseline.excluded),
    );
    const refreshed = runImport();
    assert.equal(refreshed.committed, false);
    assert.equal(refreshed.unchanged, true);
    assert.equal(refreshed.revision, first.revision);
    for (const input of [
      join(source, "fifo"),
      relative(process.cwd(), join(source, "fifo")),
    ]) {
      const single = await readArchitectureFolder(input);
      assert.deepEqual(single.excluded, []);
      assert.deepEqual(single.skipped.paths, [
        { path: "fifo", reason: "special-file", kind: "entry" },
      ]);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

for (const title of ["Title #", "Phase {#one}"]) {
  test(`RST title remains literal: ${title}`, () => {
    const text = `${title}\n${"=".repeat(title.length)}\n\nBody\n`;
    const [heading] = architectureHeadings(text, "literal.rst");
    assert.equal(heading.title, title);
    assert.equal(heading.key, title);
    assert.equal(Object.hasOwn(heading, "anchor"), false);
    assert.equal(heading.text, text);
    const indexed = indexArchitecture([
      { path: "literal.rst", text },
    ]).entities.filter((entity) => entity.kind === "heading");
    assert.deepEqual(
      indexed.map((entity) => entity.name),
      [title],
    );
  });
}

for (const punctuation of [
  "?",
  "!",
  "$",
  "%",
  "&",
  "(",
  ")",
  ",",
  "/",
  ";",
  "@",
  "[",
  "\\",
  "]",
  "{",
  "|",
  "}",
]) {
  test(`RST accepts printable ASCII punctuation adornment ${punctuation}`, () => {
    const title = "What now?";
    const headings = architectureHeadings(
      `${title}\n${punctuation.repeat(title.length)}\n\nBody\n`,
      "punctuation.rst",
    );
    assert.deepEqual(
      headings.map((heading) => heading.title),
      [title],
    );
  });
}

for (const title of ["* item one", "- item", "+ item"]) {
  test(`RST bullet item is not a heading: ${title}`, () => {
    assert.deepEqual(architectureHeadings(`${title}\n----\n`, "list.rst"), []);
  });
}

test("RST literal-block marker is not an adornment, and numbered titles remain valid", () => {
  assert.deepEqual(architectureHeadings("Ex\n::\n", "literal.rst"), []);
  assert.deepEqual(
    architectureHeadings("1. Intro\n========\n", "numbered.rst").map(
      (heading) => heading.title,
    ),
    ["1. Intro"],
  );
});

test("Markdown with no registry entry retains main's mismatch warning", async () => {
  const { prepareHeadingIdentities, identifiedHeadings } = await import(
    "../dist/architecture/heading-identities.js"
  );
  const current = prepareHeadingIdentities(
    [],
    [{ path: "old.md", text: "# Existing\n\nBody\n" }],
  );
  const result = identifiedHeadings([
    ...current,
    { path: "missing.md", text: "# Missing\n\nBody\n" },
    { path: "missing.rst", text: "Missing\n=======\n\nBody\n" },
  ]);
  assert.deepEqual(result.warnings, [
    "missing.md: heading identity metadata does not match these bytes; review affected links.",
  ]);
});
