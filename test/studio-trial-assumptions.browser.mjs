// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
// Copy into test/ and run only through pc-tools headless.
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-trial-assumptions-ui-"));
let app, browser;
try {
  await writeFile(
    join(root, "main.pym"),
    "op fetch() -> Unit effects(remote.Store) atomic; flow main() -> Bool effects(remote.Store) { call fetch(); return true; }",
  );
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
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue("main");
  await page.getByRole("button", { name: "Try inputs", exact: true }).click();
  const panel = page.getByRole("region", { name: "Try inputs", exact: true });
  await panel
    .getByRole("button", { name: "Run these inputs", exact: true })
    .click();
  await expect(panel.locator(".trial-result")).toContainText("true");
  await panel
    .locator("summary")
    .filter({ hasText: "Assumptions for this example" })
    .click();
  await expect(panel.locator(".trial-result")).toContainText(
    "environment contracts",
  );
  await expect(panel.locator(".trial-result")).toContainText(
    "atomic boundary explicitly assumed",
  );
  await expect(panel.locator(".trial-result")).toContainText(
    "cancellation is not injected",
  );
  console.log(
    "The returned model value shows its environmental and cancellation assumptions.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
