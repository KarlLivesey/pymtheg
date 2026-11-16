// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { setupProject } from "../dist/project/setup.js";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const root = await mkdtemp(join(tmpdir(), "pym-setup-conflict-ui-")),
  expect = baseExpect.configure({ timeout: 0 });
let app, browser;
try {
  await writeFile(join(root, "README.md"), "# Decision\nOriginal");
  const initialized = await setupProject(
    root,
    "Shared planning",
    true,
    new AbortController().signal,
  );
  app = await startStudio({ path: root });
  await app.service.editArchitectureDocument(
    initialized.documentation.revision,
    "README.md",
    "# Decision\nLocal review",
    "Local edit",
    new AbortController().signal,
  );
  await writeFile(join(root, "README.md"), "# Decision\nIncoming revision");
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Project setup", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Set up this project" });
  await dialog
    .getByRole("button", { name: "Review project setup", exact: true })
    .click();
  const conflicts = dialog.getByRole("region", {
    name: "Resolve import conflicts",
  });
  await expect(conflicts).toContainText("README.md");
  await conflicts.getByText("Your current version", { exact: true }).click();
  await conflicts.getByText("Incoming version", { exact: true }).click();
  await expect(conflicts).toContainText("Local review");
  await expect(conflicts).toContainText("Incoming revision");
  await conflicts
    .getByLabel("Keep which version of README.md?")
    .selectOption("keep-both");
  await conflicts
    .getByRole("button", { name: "Review resolved import", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Resolve import conflicts" }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Import 1 document", exact: true })
    .click();
  await expect(dialog).toContainText("imported into this project");
  const overview = await app.service.architectureOverview();
  const documents = await Promise.all(
    overview.index.documents.map((d) =>
      app.service.architectureDocument(overview.index.id, d.path),
    ),
  );
  assert.ok(documents.some((d) => d.text === "# Decision\nLocal review"));
  assert.ok(documents.some((d) => d.text === "# Decision\nIncoming revision"));
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/setup-conflict-resolved.png"),
    fullPage: true,
  });
  console.log(
    "Project setup resolves a real local/upstream conflict in place, previews keep-both, then explicitly imports while retaining both versions.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
