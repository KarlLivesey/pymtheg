import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-reuse-gui-"));
let app, browser;
try {
  const original =
    "type Customer = {id:Nat};\nflow existing(customer: Customer) -> Bool { return true; }\n";
  await writeFile(join(root, "types.pym"), original);
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
  await expect(
    page.getByRole("button", { name: "Edit inputs and output", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create source file", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Describe inputs and outputs/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Component name", { exact: true }).fill("newQuote");
  await dialog.getByLabel("Input 1 name", { exact: true }).fill("customer");
  await expect(
    dialog
      .getByLabel("Input 1 type", { exact: true })
      .locator('option[value="named"]'),
  ).toHaveCount(1);
  await dialog
    .getByLabel("Input 1 type", { exact: true })
    .selectOption("named");
  await dialog
    .getByLabel("Input 1 type name", { exact: true })
    .selectOption("Customer");
  await dialog
    .getByRole("button", { name: "Create and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText(
    'import "./types.pym"',
  );
  await expect(page.locator(".cm-content")).toContainText("customer: Customer");
  const source = await readFile(join(root, "component.pym"), "utf8");
  assert.doesNotMatch(source, /type Customer/);
  assert.equal(await readFile(join(root, "types.pym"), "utf8"), original);
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/reuse-existing-type.png"),
    fullPage: true,
  });
  console.log(
    "New component reuses Customer via an explicit import; the original definition remains byte-identical.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
