// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
// Run with pc-tools headless after the independent review completes its browser work.
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-resume-body-"));
let app, browser;
try {
  const source = "flow quote(quantity: Nat) -> Bool {return quantity > 0;}";
  await writeFile(join(root, "main.pym"), source);
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
  await page
    .getByRole("button", { name: "Edit inputs and output", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Add an input", exact: true })
    .click();
  await dialog.getByLabel("Input 2 name", { exact: true }).fill("urgent");
  await dialog.getByLabel("Input 2 type", { exact: true }).selectOption("Bool");
  await dialog
    .getByRole("button", { name: "Close and keep form", exact: true })
    .click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(source.replace("> 0", "> 5"));
  await page
    .getByRole("button", { name: "Resume interface form", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Input 2 name", { exact: true })).toHaveValue(
    "urgent",
  );
  await dialog
    .getByRole("button", { name: "Preview interface changes", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Interface changes" }),
  ).toContainText("urgent: Bool");
  await dialog
    .getByRole("button", { name: "Apply to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(editor).toContainText("quantity > 5");
  await expect(editor).toContainText("urgent: Bool");
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  // The same saved form must explain a renamed component, not lose the draft.
  await page
    .getByRole("button", { name: "Edit inputs and output", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close and keep form", exact: true })
    .click();
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "flow price(quantity: Nat, urgent: Bool) -> Bool {return quantity > 5;}",
  );
  await page
    .getByRole("button", { name: "Resume interface form", exact: true })
    .click();
  const conflict = page.getByRole("dialog", {
    name: "Review changed interface",
  });
  await expect(conflict).toContainText("removed or renamed");
  await expect(
    conflict.getByRole("region", { name: "Saved form changes" }),
  ).toContainText("urgent: Bool");
  await conflict
    .getByLabel("Current component")
    .selectOption({ label: "price" });
  await expect(
    conflict.getByRole("region", { name: "Current contract" }),
  ).toContainText("price(");
  await conflict
    .getByRole("button", {
      name: "Continue reviewing saved changes",
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Component name", { exact: true }),
  ).toHaveValue("price");
  await dialog
    .getByRole("button", { name: "Close and keep form", exact: true })
    .click();
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  console.log(
    "Renamed component comparison preserves saved fields and explicitly selects its current identity. An unfinished signature edit survives a body change; resuming keeps both the saved form fields and the newest handwritten body.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
