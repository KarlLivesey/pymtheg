// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeWorkspace } from "../dist/project/workspace.js";
import { previewProjectDocumentation } from "../dist/project/documents.js";
import { startStudio } from "../dist/studio/server.js";
const root = await mkdtemp(join(tmpdir(), "pym-init-ui-")),
  expect = baseExpect.configure({ timeout: 0 });
let app, browser;
try {
  const initialized = await initializeWorkspace(root, "My next app");
  await mkdir(join(root, "src"));
  app = await startStudio({ path: join(root, "src") });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".project-title")).toHaveText("My next app");
  await expect(page.locator(".project-title")).toBeVisible();
  await expect(page.locator(".workspace-name")).toContainText("0 files");
  await page
    .getByRole("button", { name: "Open architecture workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add planning record", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/init-empty-workspace.png"),
    fullPage: true,
  });
  await app.close();
  app = null;
  await mkdir(join(root, "docs"));
  await writeFile(
    join(root, "docs", "architecture.md"),
    "# Storage plan\nAcknowledge writes after durable storage.",
  );
  await previewProjectDocumentation(
    root,
    initialized.workspace,
    true,
    new AbortController().signal,
  );
  app = await startStudio({ path: join(root, "src") });
  await page.goto(app.url);
  await expect(page.locator(".project-title")).toHaveText("My next app");
  await expect(page.locator(".project-title")).toBeVisible();
  await page
    .getByRole("button", { name: "Documents and decisions", exact: true })
    .click();
  await page.getByRole("button", { name: /docs\/architecture.md/ }).click();
  await expect(page.locator("body")).toContainText(
    "Acknowledge writes after durable storage.",
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/init-imported-documents.png"),
    fullPage: true,
  });
  console.log(
    "Initialized project identity appears from a subfolder; an empty workspace offers planning, and explicitly imported documentation remains readable after restart.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
