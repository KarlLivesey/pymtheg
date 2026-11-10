import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-unused-scope-ui-"));
let app, browser;
const source =
  "op mk() -> Int ensures result > 5; op need(v: Int) -> Int requires v > 0; flow main() -> Int { call mk() as c; let k = c - 10; call need(k) as d; return d; }";
try {
  await writeFile(join(root, "main.pym"), source);
  await writeFile(
    join(root, ".pymtheg.json"),
    JSON.stringify({
      version: 1,
      scenarios: {
        "With an unused result": {
          file: "main.pym",
          entry: "main",
          seed: "42",
          maxSteps: 20,
          maxSamples: 100,
          timeoutMs: 45000,
          scope: { results: { mk: ["6"], need: ["1"] } },
        },
      },
    }),
  );
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue("main");
  await page.getByRole("button", { name: "Scenario", exact: true }).click();
  await page
    .getByLabel("Project scenario", { exact: true })
    .selectOption("With an unused result");
  await page
    .getByRole("button", { name: "Apply scenario", exact: true })
    .click();
  await page.getByRole("button", { name: /Simulate/ }).click();
  await expect(page.getByText("B014", { exact: true })).toBeVisible();
  await expect(page.getByText("B010", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(
    page
      .locator(".evidence-card")
      .filter({ hasText: "Scenario scope entries" }),
  ).toContainText("Unused results scope key need");
  await page.getByRole("button", { name: "Trace", exact: true }).click();
  await page
    .getByRole("button", { name: /Go to trace step/ })
    .last()
    .click();
  await expect(page.locator(".trace-summary")).toContainText(/precondition/i);
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/unused-scope-trace.png"),
    fullPage: true,
  });
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  console.log(
    "An unused result scope stays visible separately while its real precondition counterexample and final trace remain available.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
