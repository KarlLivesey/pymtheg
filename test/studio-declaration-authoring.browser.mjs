// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-create-blocks-"));
let app, browser, page;
try {
  const source = "flow main(amount: Nat) -> Unit { return unit; }\n";
  await writeFile(join(root, "main.pym"), source);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  ).newPage();
  page.setDefaultTimeout(0);
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  page.on("response", async (r) => {
    if (r.status() >= 400) console.error("HTTP", r.status(), await r.text());
  });
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  console.log("Checked initial source");
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  await blocks
    .getByRole("button", { name: "Add to this design", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Add to this design",
    exact: true,
  });
  async function previewDeclaration() {
    const requested = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/declaration") &&
        r.request().postDataJSON()?.action === "preview",
    );
    await dialog
      .getByRole("button", { name: "Preview declaration", exact: true })
      .click();
    const response = await requested;
    assert.equal(response.status(), 200, await response.text());
  }

  console.log("Opening declaration form");
  await dialog.getByRole("button", { name: /External operation/ }).click();
  await dialog.getByLabel("Component name", { exact: true }).fill("send");
  await dialog
    .getByRole("button", { name: "Add an input", exact: true })
    .click();
  await dialog.getByLabel("Input 1 name", { exact: true }).fill("amount");
  await dialog.getByLabel("Input 1 type", { exact: true }).selectOption("Nat");
  await dialog
    .getByRole("button", { name: "3. Effects (optional)", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Add an effect", exact: true })
    .click();
  await dialog.getByLabel("Effect 1 target", { exact: true }).fill("Provider");
  await previewDeclaration();
  console.log("Requested declaration preview");
  const preview = dialog.getByRole("region", {
    name: "New declaration preview",
  });
  await expect(preview).toContainText(
    "op send(amount: Nat) -> Unit effects(remote.Provider);",
  );
  await expect(preview).toContainText("No work summary");
  await dialog
    .getByRole("button", { name: "Add to editor and check", exact: true })
    .click();
  console.log("Applied new declaration");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("op send");
  await expect(blocks.getByRole("status")).toContainText(
    "Blocks match the current source",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest(
            '[aria-label="Visual block editor"]',
          ),
      ),
    )
    .toBe(true);
  const steps = blocks.getByRole("region", { name: "Steps", exact: true });
  await steps.getByText("Add a step", { exact: true }).click();
  await steps
    .getByLabel("Component to call", { exact: true })
    .selectOption("send");
  await steps.getByRole("button", { name: "Add call", exact: true }).click();
  await blocks.getByRole("button", { name: "Use amount", exact: true }).click();
  console.log("Typed call added");
  await expect(page.getByText("E002", { exact: true })).toBeVisible();
  await blocks
    .getByRole("article", { name: "main", exact: true })
    .getByRole("button", { name: "Edit inputs and output", exact: true })
    .click();
  console.log("Opening caller inputs");
  const inputs = page.getByRole("dialog", {
    name: "Inputs and output for main",
    exact: true,
  });
  await inputs
    .getByRole("button", { name: "3. Effects (optional)", exact: true })
    .click();
  console.log("Opened effects tab");
  await inputs
    .getByRole("button", { name: "Add an effect", exact: true })
    .click();
  await inputs.getByLabel("Effect 1 target", { exact: true }).fill("Provider");
  console.log("Set effect");
  await inputs
    .getByRole("button", { name: "Preview interface changes", exact: true })
    .click();
  await inputs
    .getByRole("button", { name: "Apply to editor and check", exact: true })
    .click();
  await expect(inputs).toHaveCount(0);
  await expect(page.getByText("E002", { exact: true })).toHaveCount(0);
  await expect(blocks.getByRole("status")).toContainText(
    "Blocks match the current source",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest(
            '[aria-label="Visual block editor"]',
          ),
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/declaration-operation.png"),
    fullPage: true,
  });
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  assert.deepEqual(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations.map((v) => v.id),
    [],
  );
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  console.log(
    "Created an external operation entirely in Blocks, selected its typed input, saw the real missing-effect finding and corrected it. No source was saved; keyboard/axe/narrow checks passed.",
  );
} catch (error) {
  console.error(
    await page
      ?.locator("body")
      .innerText()
      .catch(() => null),
  );
  await page
    ?.screenshot({
      path: browserEvidence("evidence/product-audit/declaration-failure.png"),
      fullPage: true,
    })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
