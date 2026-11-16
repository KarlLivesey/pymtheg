// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { directoryMayContainSource } from "../dist/shared/source-policy.js";
import { sourceIncluded } from "../dist/language/source-selection.js";
test("directory pruning preserves eligible source paths under supported glob forms", () => {
  const patterns = [
    "src/**/*.pym",
    "**/*.pym",
    "pkg/{left,right}/*.pym",
    "src/[abc]/*.pym",
    "src/main.pym",
    "./src/**/*.pym",
    "pkg/a*/file.pym",
  ];
  const paths = [
    "src/main.pym",
    "src/a/one.pym",
    "src/a/b/two.pym",
    "pkg/left/file.pym",
    "pkg/right/file.pym",
    "pkg/alpha/file.pym",
    "docs/notes.pym",
  ];
  for (const pattern of patterns)
    for (const path of paths)
      if (sourceIncluded(path, { include: [pattern] })) {
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i++)
          assert.equal(
            directoryMayContainSource(parts.slice(0, i).join("/"), {
              include: [pattern],
            }),
            true,
            pattern + " must retain " + path,
          );
      }
  assert.equal(
    directoryMayContainSource("archive", { include: ["src/**/*.pym"] }),
    false,
  );
  assert.equal(
    directoryMayContainSource("src/nested", { include: ["src/main.pym"] }),
    false,
  );
  assert.equal(directoryMayContainSource("anything"), true);
});
