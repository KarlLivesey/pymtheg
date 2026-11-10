import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const root = await mkdtemp(join(tmpdir(), "pym-reopen-")),
  expect = baseExpect.configure({ timeout: 0 });
let app, browser;
try {
  const file = join(root, "a.pym");
  await writeFile(file, "flow alpha() -> Nat { return 1; }");
  await writeFile(join(root, "b.pym"), "flow beta() -> Nat { return 2; }");
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  const files = page.getByRole("navigation", { name: "Source files" }),
    editor = page.locator(".cm-content");
  await files.getByRole("button", { name: /a.pym/ }).click();
  await expect(editor).toContainText("return 1;");
  await page.getByLabel("Check as I edit").uncheck();
  await writeFile(file, "flow alpha() -> Nat { return 7; }");
  await files.getByRole("button", { name: /b.pym/ }).click();
  await expect(editor).toContainText("beta");
  await files.getByRole("button", { name: /a.pym/ }).click();
  await expect(editor).toContainText("return 7;");
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n// my unsaved work");
  await writeFile(file, "flow alpha() -> Nat { return 9; }");
  await files.getByRole("button", { name: /b.pym/ }).click();
  await expect(editor).toContainText("beta");
  await files.getByRole("button", { name: /a.pym/ }).click();
  const conflict = page.getByRole("dialog", {
    name: "This file changed on disk",
  });
  await expect(conflict).toBeVisible();
  await conflict
    .getByRole("button", { name: "Keep my buffer", exact: true })
    .click();
  await expect(editor).toContainText("my unsaved work");
  await expect(editor).toContainText("return 7;");
  await files.getByRole("button", { name: /a.pym/ }).click();
  await conflict
    .getByRole("button", { name: "Use disk version", exact: true })
    .click();
  await expect(editor).toContainText("return 9;");
  await expect(editor).not.toContainText("my unsaved work");
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/source-reopen.png"),
    fullPage: true,
  });
  console.log(
    "Reopening a clean source loads external edits; dirty source asks and preserves both versions until explicitly resolved.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
