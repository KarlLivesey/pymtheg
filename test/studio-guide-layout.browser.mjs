// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-guide-hit-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Start with a recipe", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Describe inputs and outputs/ })
    .click();
  await page.getByLabel("Component name", { exact: true }).fill("refund");
  await page.getByLabel("Input 1 name", { exact: true }).fill("amount");
  await page
    .getByRole("button", { name: "Next: return value", exact: true })
    .click();
  await page.getByLabel("Output type", { exact: true }).selectOption("Bool");
  await page
    .getByRole("button", { name: "Create and check", exact: true })
    .click();
  await expect(page.locator(".statusbar")).toContainText("completed");
  const coach = page.getByRole("region", { name: "Guided design" });
  await expect(coach).toBeVisible();
  await coach.getByText("Change inputs and output", { exact: true }).click();
  const add = coach.getByRole("button", { name: "Add an input", exact: true });
  await add.click({ trial: true });
  const point = await add.evaluate((b) => {
    const r = b.getBoundingClientRect(),
      hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      ),
      footer = document.querySelector(".statusbar").getBoundingClientRect();
    return {
      visibleHit: hit === b || b.contains(hit),
      button: { top: r.top, bottom: r.bottom },
      footer: { top: footer.top, bottom: footer.bottom },
      hit: hit?.className,
    };
  });
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/guide-layout.png"),
    fullPage: true,
  });
  await writeFile(
    browserEvidence("evidence/product-audit/guide-layout.json"),
    JSON.stringify(point, null, 2) + "\n",
  );
  console.log(JSON.stringify(point));
  assert.ok(
    point.visibleHit,
    "The footer or another layer covers the Add input control",
  );
  await add.click();
  await coach.getByLabel("Input 2 name", { exact: true }).fill("reason");
  await coach
    .getByRole("button", { name: "Update design and check", exact: true })
    .click();
  await expect(coach.getByRole("alert")).toContainText("reason");
  await expect(page.locator(".cm-content")).not.toContainText("reason");
  await coach
    .getByLabel("Input 2 type", { exact: true })
    .selectOption("String");
  await coach
    .getByRole("button", { name: "Update design and check", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("reason: String");
  console.log(
    "Ordinary mouse edit completed and checked source contains the added parameter.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
