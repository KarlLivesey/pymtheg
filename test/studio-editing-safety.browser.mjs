// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
// Readiness and actual content determine correctness, never machine speed.
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-edit-safety-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  await page.goto(app.url);
  await page.getByRole("button", { name: "Start with a recipe" }).click();
  await page.getByRole("button", { name: "Create and check" }).click();
  const coach = page.getByRole("region", { name: "Guided design" });
  await expect(coach).toContainText("600 external calls");
  await page.locator(".cm-content").press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.getByText("Add a block", { exact: true }).click();
  await page.getByRole("button", { name: /Name a reusable decision/ }).click();
  await expect(page.locator(".cm-content")).toContainText(">= 0;");
  await page.getByRole("button", { name: /Check design/ }).click();
  await expect(page.getByText("P002", { exact: true })).toHaveCount(0);
  await page.getByLabel("Check as I edit").uncheck();
  await page.locator(".cm-content").press("ControlOrMeta+End");
  await page.keyboard.insertText("\n// unsaved marker\n");
  await page.getByText("K002", { exact: true }).click();
  await expect(page.getByText("RUN SNAPSHOT", { exact: true })).toBeVisible();
  if (
    (await page.locator(".cm-content").innerText()).match(/rule name/g)
      ?.length > 1
  )
    throw Error("Insertion replayed into snapshot");
  await page.getByRole("button", { name: /Back to editing/ }).click();
  await expect(page.locator(".cm-content")).toContainText("unsaved marker");
  await page.locator(".cm-content").press("ControlOrMeta+End");
  await page.keyboard.insertText("~");
  await page.getByRole("button", { name: /Check design/ }).click();
  await expect(coach).toContainText("budget cannot be checked");
  await expect(coach).not.toContainText("fits the declared budget");
  await expect(coach).not.toContainText("null external");
  await page.getByRole("button", { name: "Create source file" }).click();
  await page
    .getByRole("button", { name: /Define a reusable decision/ })
    .click();
  await page.getByRole("button", { name: "Create and check" }).click();
  await expect(page.locator(".current-file")).toContainText("eligibility.pym");
  await expect(page.locator(".cm-content")).toContainText("rule eligible");
  await expect(page.locator(".cm-content")).not.toContainText("rule name");
  console.log(
    "Editing safety: valid snippet defaults, one-shot document-bound insertion, preserved snapshot, and no budget assurance after syntax errors passed.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
