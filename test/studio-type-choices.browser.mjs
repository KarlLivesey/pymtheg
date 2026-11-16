// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { waitForRecovery } from "./recovery-ack.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-type-choices-ui-"));
const original = "flow keep() -> Unit { return unit; }\n";
let app, browser;
try {
  await writeFile(join(root, "main.pym"), original);
  app = await startStudio({ path: root });
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
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  await page
    .getByRole("button", { name: "Add to this design", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Add to this design",
    exact: true,
  });
  await dialog.getByRole("button", { name: /^Data shape/ }).click();
  await dialog
    .getByLabel("Data shape record name", { exact: true })
    .fill("Batch");
  await dialog
    .getByRole("button", { name: "Add Data shape field", exact: true })
    .click();
  const fieldType = dialog.getByLabel("Data shape field 2 type", {
    exact: true,
  });
  await expect(fieldType).toHaveValue("unselected");
  await dialog
    .getByLabel("Data shape field 2 name", { exact: true })
    .fill("quantities");
  await dialog
    .getByRole("button", { name: "Preview declaration", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("quantities");
  await expect(dialog.getByRole("alert")).toContainText("choose what");
  await waitForRecovery(
    app,
    (r) =>
      r.context.declarationDraft?.declaration.definition.fields[1].type.kind,
    "unselected",
  );
  await dialog
    .getByRole("button", { name: "Close and keep form", exact: true })
    .click();
  await app.close();
  app = await startStudio({ path: root });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Resume declaration form", exact: true })
    .click();
  await expect(fieldType).toHaveValue("unselected");
  await expect(
    dialog.getByLabel("Data shape field 2 name", { exact: true }),
  ).toHaveValue("quantities");
  await fieldType.selectOption("list");
  const itemType = dialog.getByLabel("Data shape field 2 item type", {
    exact: true,
  });
  await expect(itemType).toHaveValue("unselected");
  await itemType.selectOption("Nat");
  // Explicitly clearing a selected type is also a recoverable choice, never a fallback to Text.
  await itemType.selectOption("unselected");
  await expect(itemType).toHaveValue("unselected");
  await itemType.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await expect(itemType).toHaveValue("Nat");
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog
    .getByRole("button", { name: "Preview declaration", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", {
      name: "New declaration preview",
      exact: true,
    }),
  ).toContainText("quantities: List<Nat>");
  const a11y = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  assert.deepEqual(a11y.violations, []);
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/type-choices-narrow.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Add to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText(
    "quantities: List<Nat>",
  );
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  console.log(
    "New fields and list items require a deliberate type, retain unanswered choices across restart, support keyboard choice and create checked source without writing disk.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
