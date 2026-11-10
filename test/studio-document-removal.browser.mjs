import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { initializeWorkspace } from "../dist/project/workspace.js";
import { previewProjectDocumentation } from "../dist/project/documents.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-document-removal-ui-"));
let app, browser;
try {
  await mkdir(join(root, "docs"));
  await writeFile(
    join(root, "docs/design.md"),
    "# Design\nOriginal retained text.",
  );
  const { workspace } = await initializeWorkspace(root);
  const initial = await previewProjectDocumentation(
    root,
    workspace,
    true,
    new AbortController().signal,
  );
  app = await startStudio({ path: root });
  await unlink(join(root, "docs/design.md"));
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 960 },
  });
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Project setup", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Set up this project" });
  await dialog
    .getByRole("button", { name: "Review project setup", exact: true })
    .click();
  const changes = dialog.getByRole("region", { name: "Documentation changes" });
  await expect(changes).toContainText("0 added, 0 changed, 1 removed");
  await expect(changes).not.toContainText(".pymtheg-imports");
  await expect(changes).toContainText("docs/design.md");
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/document-removal-preview.png",
    ),
    fullPage: true,
  });
  // The submit label changes while the request is pending. Its disappearance
  // does not mean the removal has committed; wait for the response first.
  const removal = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/project/initialize") &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Apply document removals", exact: true })
    .click();
  assert.equal((await removal).status(), 200);
  await expect(
    dialog.getByRole("button", { name: "Importing documents…", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", {
      name: "Apply document removals",
      exact: true,
    }),
  ).toHaveCount(0);
  assert.ok(
    !(await app.service.architectureOverview()).index.documents.some(
      (doc) => doc.path === "docs/design.md",
    ),
  );
  assert.equal(
    (await app.service.architectureDocument(initial.revision, "docs/design.md"))
      .text,
    "# Design\nOriginal retained text.",
  );
  console.log(
    "Studio previews the last document removal explicitly, applies it on request and preserves its prior revision.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
