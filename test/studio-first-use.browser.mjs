import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
// Run the entire controller through pc-tools headless.
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-first-journey-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  await page.goto(app.url);
  await expect(
    page.getByRole("button", { name: "Start with a recipe" }),
  ).toBeVisible();
  await mkdir(browserEvidence("evidence/product-audit"), { recursive: true });
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/empty-project-after.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Start with a recipe" }).click();
  await page
    .getByRole("button", { name: /Describe inputs and outputs/ })
    .click();
  await page.getByLabel("Component name").fill("quote");
  await page.getByLabel("Input 1 name").fill("customer");
  await page.getByLabel("Input 1 type").selectOption("String");
  await page.getByRole("button", { name: "Add an input" }).click();
  await page.getByLabel("Input 2 name").fill("quantity");
  await page.getByLabel("Input 2 type").selectOption("Nat");
  await page
    .getByRole("button", { name: "Next: return value", exact: true })
    .click();
  await page.getByLabel("Output type").selectOption("Bool");
  await page.getByLabel("Design file name").fill("design/core/component.pym");
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/input-builder.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create and check", exact: true })
    .click();
  await expect(page.locator(".interface-hint")).toContainText("customer");
  await expect(page.locator(".interface-hint")).toContainText(
    "whole number, zero or greater",
  );
  await expect(page.locator(".interface-hint")).toContainText("true or false");
  await expect(page.locator(".finding-card")).toContainText(
    "A design decision is still missing",
  );
  const component = await readFile(
    join(root, "design/core/component.pym"),
    "utf8",
  );
  if (
    !component.includes("customer: String, quantity: Nat") ||
    !component.includes("-> Bool")
  )
    throw Error("Input builder did not create the described interface");
  await page.getByRole("button", { name: "Create source file" }).click();
  await page
    .getByRole("button", { name: "Create and check", exact: true })
    .click();
  const coach = page.getByRole("region", { name: "Guided design" });
  await expect(coach).toContainText("600 external calls");
  await expect(coach).toContainText("Review source-path feasibility");
  const storedWork = await readFile(join(root, "work-budget.pym"), "utf8");
  await coach.getByText("Adjust this recipe", { exact: true }).click();
  await coach.getByLabel("Calls for each item").fill("2");
  await coach.getByRole("button", { name: "Update design and check" }).click();
  await expect(coach).toContainText("400 external calls");
  await expect(coach).toContainText("fits the declared budget");
  await expect(page.getByText("K002", { exact: true })).toHaveCount(0);
  if ((await readFile(join(root, "work-budget.pym"), "utf8")) !== storedWork)
    throw Error("Adjusting a recipe silently saved over the source");
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/guided-work.png"),
    fullPage: true,
  });
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  if (audit.violations.length) throw Error(JSON.stringify(audit.violations));
  await page.getByRole("button", { name: "Create source file" }).click();
  await expect(page.getByLabel("Design file name")).toHaveValue(
    "work-budget-2.pym",
  );
  await page.getByLabel("Design file name").fill("work-budget.pym");
  await page
    .getByRole("button", { name: "Create and check", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "already exists",
  );
  await page.keyboard.press("Escape");
  console.log(
    "First-use: inputs/output defined without syntax, automatic real check, guided 600→400 correction, no silent save, visible create error, accessibility passed.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
