// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
// Run only through pc-tools headless. Assertions inspect layout, never elapsed time.
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-readable-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(
    page.getByRole("button", {
      name: "Open architecture workspace",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start with a recipe", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/architecture-first-landing.png",
    ),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Open architecture workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Start with a requirement or decision",
      exact: true,
    }),
  ).toBeVisible();
  const emptyAudit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    emptyAudit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.failureSummary),
    })),
    [],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/post-sixth/seventh-narrow-architecture.png",
    ),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Architecture should not force a wider page at 390px",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const version = "Decision: retain acknowledgements until durable commit";
  await app.service.importArchitecture(
    version,
    [
      {
        path: "notes.md",
        text: "# Recovery\nRetain acknowledgements until durable commit.",
      },
    ],
    new AbortController().signal,
  );
  await page.reload();
  const selector = page.getByLabel("Stored revision");
  await expect(selector).toBeVisible();
  await expect(page.locator(".architecture-revision-context")).toContainText(
    version,
  );
  await expect(page.locator(".architecture-revision-context")).toContainText(
    "Current saved version",
  );
  for (const width of [1440, 1100]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      fonts: [
        ...document.querySelectorAll(
          ".architecture-workspace p,.architecture-workspace button,.architecture-workspace input,.architecture-workspace select",
        ),
      ]
        .filter((e) => e.getClientRects().length)
        .map((e) => parseFloat(getComputedStyle(e).fontSize)),
      selector: document
        .querySelector('[aria-label="Stored revision"]')
        .getBoundingClientRect()
        .toJSON(),
    }));
    assert.equal(layout.overflow, false, JSON.stringify(layout));
    assert.ok(layout.fonts.every((size) => size >= 14));
    assert.ok(layout.selector.width >= 400);
  }
  await page.getByLabel("Search architecture").fill("Recovery");
  await page
    .getByRole("button", { name: "Documents and decisions", exact: true })
    .click();
  await expect(page.getByLabel("Search architecture")).toHaveValue("");
  await page.getByLabel("Search architecture").fill("durable");
  await page
    .getByRole("button", { name: "Design records", exact: true })
    .click();
  await expect(page.getByLabel("Search architecture")).toHaveValue("Recovery");
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/architecture-readable-revision.png",
    ),
    fullPage: true,
  });
  console.log(
    "Readable first-use and architecture controls: both entry points visible, >=14px text, full revision context, no page overflow at 1100/1440px.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
