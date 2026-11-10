import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-trial-ui-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  await page.goto(app.url);
  await page.getByRole("button", { name: "Start with a recipe" }).click();
  await page
    .getByRole("button", { name: /Define a reusable decision/ })
    .click();
  await page
    .getByRole("button", { name: "Create and check", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Try inputs and see the result", exact: true })
    .click();
  await page.getByLabel("Try input age", { exact: true }).fill("17");
  await page
    .getByRole("button", { name: "Run these inputs", exact: true })
    .click();
  await expect(page.locator(".trial-result")).toContainText("false");
  await page.getByLabel("Try input age", { exact: true }).fill("18");
  await page
    .getByRole("button", { name: "Run these inputs", exact: true })
    .click();
  await expect(page.locator(".trial-result")).toContainText("true");
  await page.getByLabel("Check as I edit").uncheck();
  await page.locator(".cm-content").press("ControlOrMeta+End");
  await page.keyboard.insertText(
    "\n// Keep input guidance visible during edits",
  );
  await expect(
    page.getByRole("complementary", { name: "Inputs and output" }),
  ).toContainText("Last checked interface");
  await expect(
    page.getByRole("complementary", { name: "Inputs and output" }),
  ).toContainText("age");
  await page.locator(".cm-content").press("ControlOrMeta+f");
  await expect(page.locator(".cm-search")).toBeVisible();
  await page.locator('.cm-search input[name="search"]').fill("eligible");
  console.log(
    "First-use decision: 17 returns false, 18 returns true; last-checked inputs stay visible while editing; editor Find opens.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
