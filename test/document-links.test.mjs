// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { documentLink } from "../dist/studio/document-links.js";
test("reader links preserve the selected collection and never invent filesystem navigation", () => {
  const paths = new Set(["docs/intro.md", "design/choices.md", "docs/café.md"]);
  assert.deepEqual(
    documentLink("docs/intro.md", "../design/choices.md#durability", paths),
    { kind: "document", path: "design/choices.md", fragment: "durability" },
  );
  assert.deepEqual(documentLink("docs/intro.md", "#inputs", paths), {
    kind: "document",
    path: "docs/intro.md",
    fragment: "inputs",
  });
  assert.deepEqual(documentLink("docs/intro.md", "caf%C3%A9.md", paths), {
    kind: "document",
    path: "docs/café.md",
    fragment: "",
  });
  for (const href of [
    "../../secret.md",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "//tracker.test/x",
    "bad%",
    "absent.md",
    "..%2f..%2fetc/passwd",
    "../design\\choices.md",
  ])
    assert.equal(
      documentLink("docs/intro.md", href, paths).kind,
      "unavailable",
      href,
    );
  assert.deepEqual(
    documentLink("docs/intro.md", "https://example.test/design", paths),
    { kind: "external", href: "https://example.test/design" },
  );
});
