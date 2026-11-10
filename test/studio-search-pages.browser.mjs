import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const root = await mkdtemp(join(tmpdir(), "pym-search-ui-"));
const expect = baseExpect.configure({ timeout: 0 });
let app, browser;
try {
  app = await startStudio({ path: root });
  await app.service.importArchitecture(
    "Search collection",
    Array.from({ length: 125 }, (_, i) => ({
      path: `doc${String(i).padStart(3, "0")}.md`,
      text: `# Design ${i}\nSearchneedle ${i}\n`,
    })),
    new AbortController().signal,
  );
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
    .getByRole("button", { name: "Documents and decisions", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search architecture", exact: true })
    .fill("Searchneedle");
  await expect(
    page.getByText("125 matches · showing up to 100", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".architecture-row")).toHaveCount(100);
  await page
    .getByRole("button", { name: "Show more documents", exact: true })
    .click();
  await expect(page.locator(".architecture-row")).toHaveCount(125);
  await expect(
    page.getByRole("button", { name: "Show more documents", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /doc124.md/ }).click();
  await expect(page.locator(".architecture-detail")).toContainText(
    "Searchneedle 124",
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/search-last-page.png"),
    fullPage: true,
  });
  console.log(
    "Full-text search exposes all 125 results and opens the final document through bounded pages.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
