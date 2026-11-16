// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import AxeBuilder from "@axe-core/playwright";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
const root = await mkdtemp(join(tmpdir(), "pym-gui-setup-")),
  expect = baseExpect.configure({ timeout: 0 });
let app, browser;
try {
  const doc = join(root, "README.md");
  await writeFile(doc, "# Design\nOriginal architecture.");
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Project setup", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Set up this project" });
  await dialog
    .getByLabel("Project name", { exact: true })
    .fill("A friendly project");
  await dialog
    .getByRole("button", { name: "Create project workspace", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Existing documentation" }),
  ).toContainText("1 existing document");
  assert.equal((await app.service.architectureOverview()).index, null);
  await writeFile(doc, "# Design\nReviewed newer architecture.");
  await dialog
    .getByRole("button", { name: "Import 1 document", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "changed after this preview",
  );
  await dialog
    .getByRole("button", { name: "Review project setup", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Import 1 document", exact: true })
    .click();
  await expect(dialog).toContainText("imported into this project");
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(accessibility.violations, []);
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/project-setup-imported.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Continue designing", exact: true })
    .click();
  await expect(page.locator(".project-title")).toHaveText("A friendly project");
  await page
    .getByRole("button", { name: "Documents and decisions", exact: true })
    .click();
  await page.getByRole("button", { name: /README.md/ }).click();
  await expect(page.locator("body")).toContainText(
    "Reviewed newer architecture.",
  );
  await page.setViewportSize({ width: 850, height: 1000 });
  await expect(
    page.getByRole("button", { name: "Project setup", exact: true }),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "Project setup must not introduce horizontal page overflow",
  );
  console.log(
    "GUI setup names the project, shows an import preview, rejects stale documents, imports a fresh preview, and stays reachable at narrow width.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
