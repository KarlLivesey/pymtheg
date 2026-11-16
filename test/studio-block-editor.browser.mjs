// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-block-ui-"));
const original = `op touch(value: Nat) -> Unit cost calls exact 1;
flow main(n: Nat) -> Unit bound n <= 10 budget calls <= 4 {
  // the comment belongs to this repeat
  for i in 3 { call touch(n); }
  return unit;
}
// other source remains intact
rule other() -> Bool = true;
`;
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
  const source = page.locator(".cm-content");
  await expect(source).toContainText("flow main");
  await page.getByLabel("Check as I edit").uncheck();
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  await expect(
    blocks.getByLabel("Number of repetitions", { exact: true }),
  ).toHaveValue("3");
  console.log("Initial parsed block projection is ready");
  await blocks.getByLabel("Number of repetitions", { exact: true }).fill("6");
  await expect(source).toContainText("for i in 6");
  const checked = page.waitForResponse(
    (r) => r.url().endsWith("/api/blocks") && r.status() === 200,
  );
  await blocks
    .getByRole("button", { name: "Check source", exact: true })
    .click();
  await checked;
  await expect(page.getByText("K002", { exact: true })).toBeVisible();
  console.log("Changing the repeat count causes a real budget finding");
  await blocks.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(source).toContainText("for i in 3");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await expect(source).toBeVisible();
  await expect(source).toContainText("the comment belongs to this repeat");
  await expect(source).toContainText("rule other()");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  await expect(
    blocks.getByLabel("Number of repetitions", { exact: true }),
  ).toHaveValue("3");
  console.log(
    "Block edits share Text undo and preserve comments and other declarations",
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/block-editor-normal.png"),
    fullPage: true,
  });
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    axe.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
  const stepSection = blocks.getByRole("region", {
    name: "Steps",
    exact: true,
  });
  await stepSection.getByText("Add a step", { exact: true }).last().click();
  await stepSection
    .getByRole("button", { name: "Open question", exact: true })
    .last()
    .click();
  await expect(
    blocks.getByLabel("What still needs deciding?", { exact: true }),
  ).toHaveValue("What should happen here?");
  await blocks
    .getByLabel("What still needs deciding?", { exact: true })
    .fill('What if the provider says "no"?');
  await expect(source).toContainText('What if the provider says \\"no\\"?');
  await expect(
    blocks.getByLabel("Number of repetitions", { exact: true }),
  ).toHaveValue("3");
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/block-editor-narrow.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  console.log(
    "Questions edit real source without saving; normal/narrow layouts and automated accessibility passed",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
