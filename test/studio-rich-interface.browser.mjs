// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
// Run entirely through pc-tools headless. User actions construct types without source syntax.
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-rich-interface-"));
let app, browser;
try {
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
  await page
    .getByRole("button", { name: "Start with a recipe", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Describe inputs and outputs/ })
    .click();
  await page
    .getByLabel("Component name", { exact: true })
    .fill("checkoutQuote");
  await page.getByLabel("Input 1 name", { exact: true }).fill("order");
  await page.getByLabel("Input 1 type", { exact: true }).selectOption("record");
  await page.getByLabel("Input 1 record name", { exact: true }).fill("Order");
  await page
    .getByLabel("Input 1 field 1 name", { exact: true })
    .fill("customer");
  await page
    .getByLabel("Input 1 field 1 type", { exact: true })
    .selectOption("String");
  await page
    .getByRole("button", { name: "Add Input 1 field", exact: true })
    .click();
  await page
    .getByLabel("Input 1 field 2 name", { exact: true })
    .fill("quantity");
  await page
    .getByLabel("Input 1 field 2 type", { exact: true })
    .selectOption("Nat");
  await page.getByRole("button", { name: "Add an input", exact: true }).click();
  await page.getByLabel("Input 2 name", { exact: true }).fill("coupons");
  await page.getByLabel("Input 2 type", { exact: true }).selectOption("list");
  await page
    .getByLabel("Input 2 item type", { exact: true })
    .selectOption("String");
  await page.getByRole("button", { name: "Add an input", exact: true }).click();
  await page.getByLabel("Input 3 name", { exact: true }).fill("previousOrder");
  await page.getByLabel("Input 3 type", { exact: true }).selectOption("named");
  await page
    .getByLabel("Input 3 type name", { exact: true })
    .selectOption("Order");
  await page
    .getByRole("button", { name: "Next: return value", exact: true })
    .click();
  await page.getByLabel("Output type", { exact: true }).selectOption("result");
  await page
    .getByLabel("Output success type", { exact: true })
    .selectOption("record");
  await page
    .getByLabel("Output success record name", { exact: true })
    .fill("Quote");
  await page
    .getByLabel("Output success field 1 name", { exact: true })
    .fill("total");
  await page
    .getByLabel("Output success field 1 type", { exact: true })
    .selectOption("Nat");
  await page
    .getByLabel("Output error outcomes name", { exact: true })
    .fill("QuoteErrors");
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1100, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    const dimensions = await page
      .getByLabel("Output success field 1 type", { exact: true })
      .evaluate((el) => {
        const style = getComputedStyle(el),
          canvas = document.createElement("canvas"),
          context = canvas.getContext("2d");
        context.font = style.font;
        return {
          text: el.selectedOptions[0].text,
          textWidth: context.measureText(el.selectedOptions[0].text).width,
          available:
            el.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight) -
            24,
        };
      });
    assert.ok(
      dimensions.available >= dimensions.textWidth,
      JSON.stringify({ width, ...dimensions }),
    );
  }
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/rich-interface-return-step.png",
    ),
    fullPage: true,
  });
  await expect(
    page.getByLabel("Output success record name", { exact: true }),
  ).toHaveValue("Quote");
  await expect(
    page.getByLabel("Output success field 1 name", { exact: true }),
  ).toHaveValue("total");
  await page
    .getByRole("button", { name: "Next: effects (optional)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add an effect", exact: true })
    .click();
  await page.getByLabel("Effect 1 target", { exact: true }).fill("Payments");
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(accessibility.violations, []);
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/rich-interface-builder.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create and check", exact: true })
    .click();
  await expect(page.locator(".finding-card")).toContainText(
    "A design decision is still missing",
  );
  const source = await readFile(join(root, "component.pym"), "utf8");
  assert.match(
    source,
    /type Order = \{[\s\S]*customer: String[\s\S]*quantity: Nat/,
  );
  assert.match(source, /coupons: List<String>/);
  assert.match(source, /previousOrder: Order/);
  assert.match(source, /Result<Quote, QuoteErrors>/);
  assert.match(source, /effects\(remote.Payments\)/);
  await page
    .getByRole("region", { name: "Guided design" })
    .getByRole("button", { name: "Preview types and signatures", exact: true })
    .click();
  await expect(page.locator(".scaffold-preview")).toContainText(
    "interface Order",
  );
  await expect(page.locator(".scaffold-preview")).toContainText("QuoteErrors");
  console.log(
    "Form-only journey: Order record, string list, Quote success, named errors and service effect become real checked source and readable scaffolds.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
