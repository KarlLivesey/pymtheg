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
const root = await mkdtemp(join(tmpdir(), "pym-resource-blocks-"));
const original =
  (await readFile("examples/mvp/files-fixed.pym", "utf8")) +
  "\nflow createFile() -> Unit effects(state.File) { return unit; }\n";
let app, browser;
try {
  await writeFile(join(root, "files.pym"), original);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".cm-content")).toContainText("flow process");
  await page.getByLabel("Check as I edit").uncheck();
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  await blocks
    .locator(".visual-definition")
    .filter({ hasText: "File" })
    .locator("summary")
    .first()
    .click();
  const lifecycle = blocks.getByLabel("File lifecycle", { exact: true });
  await expect(lifecycle).toContainText("Starts in Open");
  await expect(lifecycle).toContainText("Closed · cleanup complete");
  const cancellation = blocks.getByRole("region", {
    name: "If cancelled",
    exact: true,
  });
  const destination = cancellation.getByLabel("Destination state", {
    exact: true,
  });
  await expect(destination).toHaveValue("Closed");
  await destination.focus();
  await destination.press("Home");
  await destination.press("Enter");
  await expect(destination).toHaveValue("Open");
  await expect(page.getByText("O004", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText(
    "on cancel { transition f -> Open;",
  );
  await blocks.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    cancellation.getByLabel("Destination state", { exact: true }),
  ).toHaveValue("Closed");
  await expect(page.getByText("O004", { exact: true })).toHaveCount(0);
  console.log("Keyboard cleanup and Undo are complete");
  const createdFlow = blocks.getByRole("article", {
    name: "createFile",
    exact: true,
  });
  const steps = createdFlow.getByRole("region", { name: "Steps", exact: true });
  await steps.getByText("Add a step", { exact: true }).click();
  console.log(
    "Creation controls",
    await steps.locator(".visual-add").evaluate((el) => ({
      open: el.open,
      fields: [...el.querySelectorAll("select")].map((select) => ({
        label: select.closest("label")?.textContent,
        disabled: select.disabled,
      })),
    })),
  );
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/resource-create-controls.png",
    ),
    fullPage: true,
  });
  await steps
    .getByLabel("Resource to create", { exact: true })
    .selectOption("File");
  console.log("Selected File for creation");
  await steps
    .getByRole("button", { name: "Create resource", exact: true })
    .click();
  console.log("Created source", await page.locator(".cm-content").innerText());
  await expect(
    steps.getByRole("article", {
      name: "Create File · ownedFile",
      exact: true,
    }),
  ).toBeVisible();
  console.log("Created resource block is ready");
  await steps
    .getByLabel("Resource to change", { exact: true })
    .selectOption("ownedFile");
  await steps.getByLabel("New state", { exact: true }).selectOption("Closed");
  console.log("Selected normal cleanup");
  await steps
    .getByRole("button", { name: "Add state change", exact: true })
    .click();
  await expect(
    steps.getByRole("article", {
      name: "Change ownedFile to Closed",
      exact: true,
    }),
  ).toBeVisible();
  console.log("Normal cleanup block is ready");
  await createdFlow
    .getByRole("button", { name: "Add cancellation steps", exact: true })
    .click();
  console.log("Added cancellation section");
  const cleanup = createdFlow.getByRole("region", {
    name: "If cancelled",
    exact: true,
  });
  await expect(
    cleanup.getByLabel("What still needs deciding?", { exact: true }),
  ).toHaveValue("How are resources settled if cancelled?");
  await cleanup.getByText("Add a step", { exact: true }).click();
  await cleanup
    .getByLabel("Resource to change", { exact: true })
    .selectOption("ownedFile");
  await cleanup.getByLabel("New state", { exact: true }).selectOption("Closed");
  await cleanup
    .getByRole("button", { name: "Add state change", exact: true })
    .click();
  await expect(
    cleanup.getByRole("article", {
      name: "Change ownedFile to Closed",
      exact: true,
    }),
  ).toBeVisible();
  await cleanup
    .getByRole("button", { name: "Remove Open question", exact: true })
    .click();
  await expect(
    cleanup.getByLabel("What still needs deciding?", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("O004", { exact: true })).toHaveCount(0);
  await expect(page.getByText("O001", { exact: true })).toHaveCount(0);
  await expect(page.getByText("C001", { exact: true })).toHaveCount(0);
  await expect(lifecycle).toBeVisible();
  await page.setViewportSize({ width: 540, height: 960 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
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
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/block-resource-lifecycle.png",
    ),
    fullPage: true,
  });
  assert.equal(await readFile(join(root, "files.pym"), "utf8"), original);
  console.log(
    "Declared lifecycle is readable; keyboard cleanup edit exposes the real cancellation leak; Undo clears it. Created a resource and settled normal/cancellation exits in Blocks; no unreachable work. Narrow layout and axe pass; disk unchanged.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
