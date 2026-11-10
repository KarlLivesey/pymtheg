import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-deleted-buffer-ui-"));
let app, browser;
try {
  const file = join(root, "a.pym");
  await writeFile(file, "flow alpha() -> Bool { return true; }");
  await writeFile(join(root, "b.pym"), "flow beta() -> Bool { return false; }");
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  const files = page.getByRole("navigation", { name: "Source files" });
  const editor = page.locator(".cm-content");
  await files.getByRole("button", { name: /a.pym/ }).click();
  await expect(editor).toContainText("alpha");
  await page.getByLabel("Check as I edit").uncheck();
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n// retained unsaved work");
  await expect(editor).toContainText("retained unsaved work");
  await unlink(file);
  await files.getByRole("button", { name: /b.pym/ }).click();
  await expect(editor).toContainText("beta");
  const loaded = page.waitForResponse((response) =>
    response.url().includes("/api/source?file=a.pym"),
  );
  await files.getByRole("button", { name: /a.pym/ }).click();
  await loaded;
  await expect(
    page
      .locator('[role="alert"], [role="dialog"]')
      .filter({ hasText: /deleted on disk|File not found/i })
      .first(),
  ).toBeVisible();
  assert.match(await editor.innerText(), /retained unsaved work/);
  const dialog = page.getByRole("dialog", {
    name: "This file was deleted on disk",
  });
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/deleted-buffer-options.png"),
    fullPage: true,
  });
  await dialog.getByLabel("Save copy path").fill("rescued.pym");
  const copied = page.waitForResponse((response) =>
    response.url().endsWith("/api/save"),
  );
  await dialog
    .getByRole("button", { name: "Save separate copy", exact: true })
    .click();
  assert.equal((await copied).status(), 200);
  await expect(dialog).toHaveCount(0);
  assert.match(
    await readFile(join(root, "rescued.pym"), "utf8"),
    /retained unsaved work/,
  );
  await assert.rejects(readFile(file), { code: "ENOENT" });
  await page
    .getByRole("button", { name: "Review save options", exact: true })
    .click();
  const recreated = page.waitForResponse((response) =>
    response.url().endsWith("/api/save"),
  );
  await dialog
    .getByRole("button", { name: "Save to this path again", exact: true })
    .click();
  assert.equal((await recreated).status(), 200);
  await expect(dialog).toHaveCount(0);
  assert.match(await readFile(file, "utf8"), /retained unsaved work/);
  console.log(
    "A deleted dirty file reopens its retained buffer; save-copy and explicit recreation both preserve the unsaved text.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
