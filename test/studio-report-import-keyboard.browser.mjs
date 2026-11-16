// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { analyseFile } from "../dist/analysis/index.js";
import { json } from "../dist/shared/identity.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-keyboard-import-"));
let app, browser;
try {
  const file = join(root, "main.pym");
  await writeFile(file, "flow main() -> Bool { return true; }");
  const report = analyseFile(file).report;
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.setDefaultTimeout(0);
  // Enable interception before navigation/keyboard interaction. waitForEvent
  // alone subscribes asynchronously and can lose the native chooser under load.
  page.on("filechooser", () => {});
  await page.goto(app.url);
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue("main");
  console.log("Initial source check is ready.");
  const setup = page.getByRole("button", {
    name: "Project setup",
    exact: true,
  });
  await setup.focus();
  await page.keyboard.press("Tab");
  assert.equal(
    (await page.locator(":focus").innerText()).trim(),
    "Import check report",
  );
  console.log("Keyboard focus reached report import.");
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (
    await chooser
  ).setFiles({
    name: "report.json",
    mimeType: "application/json",
    buffer: Buffer.from(json(report)),
  });
  console.log("Report file selected through the keyboard-opened chooser.");
  await page.waitForFunction(
    () =>
      !!document.querySelector(".snapshot-banner") ||
      !!document.querySelector(".error-message"),
  );
  assert.equal(
    await page.locator(".error-message").count(),
    0,
    await page.locator(".error-message").allTextContents(),
  );
  await expect(page.locator(".snapshot-banner")).toContainText(
    "Imported report. Its recorded evidence has not been rerun in this session.",
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/keyboard-report-import.png"),
    fullPage: true,
  });
  console.log(
    "At 390px, Tab reaches report import, Enter opens the chooser, and a real report imports as historical evidence.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
