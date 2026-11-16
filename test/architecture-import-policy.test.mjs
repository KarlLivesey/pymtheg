// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {
  folderInventory,
  withImportInventory,
  preserveInventoryLocation,
} from "../dist/architecture/import-policy.js";
test("folder inventory shares text formats and records every excluded entry", () => {
  const result = folderInventory([
    { path: "design/API.JSON", bytes: 50 },
    { path: "README.md", bytes: 10 },
    { path: "node_modules/lib/readme.md", bytes: 300 },
    { path: ".git/config.json", bytes: 20 },
    { path: "logo.png", bytes: 99 },
  ]);
  assert.deepEqual(result.included, ["README.md", "design/API.JSON"]);
  assert.equal(result.bytes, 60);
  assert.equal(result.excluded.length, 3);
  const docs = withImportInventory(
    [{ path: ".pymtheg-import.json", text: "original metadata" }],
    "selected folder",
    result.excluded,
  );
  assert.equal(docs.length, 2);
  assert.equal(docs[0].text, "original metadata");
  assert.equal(docs[1].path, ".pymtheg-imports/selected%20folder.json");
  assert.deepEqual(JSON.parse(docs[1].text).excluded, [
    "logo.png (outside text-document import formats)",
  ]);
});
test("transport-hidden runtime paths do not create metadata drift or rewrite legacy inventories", () => {
  const documents = [{ path: "README.md", text: "# Project" }];
  const privatePaths = [
    ".pymtheg (generated/private directory)",
    ".git (generated/private directory)",
    ".pymtheg.json (outside text-document import formats)",
  ];
  const visiblePaths = ["src (outside selected documentation scope)"];
  const cli = withImportInventory(
    documents,
    "/project",
    [...privatePaths, ...visiblePaths],
    "docs",
  );
  const browser = withImportInventory(
    documents,
    "project",
    visiblePaths,
    "docs",
  );
  assert.deepEqual(preserveInventoryLocation(cli, browser, "docs"), cli);
  const legacy = structuredClone(cli);
  const meta = JSON.parse(legacy[1].text);
  legacy[1].text = JSON.stringify(
    { ...meta, excluded: [...privatePaths, ...visiblePaths] },
    null,
    2,
  );
  assert.deepEqual(preserveInventoryLocation(legacy, browser, "docs"), legacy);
  const repointed = withImportInventory(
    documents,
    "/moved/project",
    visiblePaths,
    "docs",
  );
  assert.notEqual(
    preserveInventoryLocation(legacy, repointed, "docs")[1].text,
    legacy[1].text,
  );
  const changed = withImportInventory(
    [...documents, { path: "docs/new.md", text: "# New" }],
    "project",
    visiblePaths,
    "docs",
  );
  assert.equal(preserveInventoryLocation(legacy, changed, "docs").length, 3);
});
test("inventory enforces size limits before file contents are read", () => {
  assert.throws(
    () => folderInventory([{ path: "huge.md", bytes: 16 * 1024 * 1024 + 1 }]),
    /16 MiB/,
  );
  assert.throws(
    () =>
      folderInventory(
        Array.from({ length: 5 }, (_, i) => ({
          path: i + ".md",
          bytes: 16 * 1024 * 1024,
        })),
      ),
    /64 MiB/,
  );
  assert.throws(
    () =>
      withImportInventory(
        Array.from({ length: 4096 }, (_, i) => ({ path: i + ".md", text: "" })),
        "source",
        [],
      ),
    /4,095/,
  );
});

test("folder imports share a visible-document policy across transports and retain legacy hidden content", async () => {
  const { mergeArchitectureImport } = await import(
    "../dist/architecture/import-merge.js"
  );
  const full = folderInventory([
    { path: "README.md", bytes: 5 },
    { path: ".hidden.md", bytes: 12 },
    { path: "docs/.secret.md", bytes: 10 },
  ]);
  const picker = folderInventory([{ path: "README.md", bytes: 5 }]);
  assert.deepEqual(full.included, picker.included);
  assert.deepEqual(
    withImportInventory(
      [{ path: "README.md", text: "# Hi" }],
      "repo",
      full.excluded,
      "docs",
    ),
    withImportInventory(
      [{ path: "README.md", text: "# Hi" }],
      "repo",
      picker.excluded,
      "docs",
    ),
  );
  const source = { id: "docs", label: "Docs", kind: "folder" };
  const original = mergeArchitectureImport(
    [],
    [
      { path: "README.md", text: "# Hi" },
      { path: ".hidden.md", text: "Keep me" },
    ],
    source,
  ).documents;
  const refreshed = mergeArchitectureImport(
    original,
    [{ path: "README.md", text: "# Hi" }],
    source,
    "refresh",
  );
  assert.equal(
    refreshed.documents.find((d) => d.path === ".hidden.md")?.text,
    "Keep me",
  );
});
