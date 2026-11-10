import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-recipe-outcomes-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1050 },
  });
  await page.goto(app.url);
  await page.getByRole("button", { name: "Start with a recipe" }).click();
  await page.getByRole("button", { name: /See why a retry/ }).click();
  await page
    .getByRole("button", { name: "Create and check", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Explore retry behaviour", exact: true })
    .click();
  await page.getByRole("button", { name: "Trace", exact: true }).click();
  await expect(page.locator(".trace-controls")).toBeVisible();
  const count = await page.locator(".trace-timeline button").count();
  await page
    .getByRole("button", {
      name: "Go to trace step " + (count - 1),
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "deliveries" })
      .getByRole("cell")
      .last(),
  ).toHaveText("2");
  await page.getByRole("button", { name: "Create source file" }).click();
  await page
    .getByRole("button", { name: /Describe inputs and outputs/ })
    .click();
  await page
    .getByRole("button", { name: "Create and check", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Guided design" })
    .getByRole("button", { name: "Preview types and signatures", exact: true })
    .click();
  await expect(page.locator(".scaffold-preview")).toContainText(
    "function main",
  );
  await expect(page.locator(".scaffold-preview")).toContainText("quantity");
  await expect(page.locator(".scaffold-preview")).toContainText(
    "Open decision",
  );
  console.log(
    "Guided outcomes: retry exposes source-mapped double delivery; unfinished component still produces a readable signature preview.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
