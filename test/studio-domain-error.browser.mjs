// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-domain-ui-"));
const original = "flow keep() -> Unit { return unit; }\n";
let app, browser;
try {
  await writeFile(join(root, "main.pym"), original);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  ).newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  await blocks
    .getByRole("button", { name: "Add to this design", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Add to this design",
    exact: true,
  });
  await dialog.getByRole("button", { name: /^Event model/ }).click();
  await dialog.getByLabel("Event model name", { exact: true }).fill("Counter");
  await dialog.getByLabel("State 1 maximum", { exact: true }).fill("2");
  await dialog.getByRole("button", { name: "Add event", exact: true }).click();
  await dialog.getByLabel("Event 1 name", { exact: true }).fill("inc");
  await dialog
    .getByLabel("When event 1 can happen", { exact: true })
    .fill("true");
  await dialog
    .getByRole("button", { name: "Add change to event 1", exact: true })
    .click();
  await dialog
    .getByLabel("Event 1 change 1 state", { exact: true })
    .selectOption("count");
  await dialog
    .getByLabel("Event 1 change 1 new value", { exact: true })
    .fill("count + 1");
  await dialog
    .getByRole("button", { name: "Add safety rule", exact: true })
    .click();
  await dialog
    .getByLabel("Safety rule 1 expression", { exact: true })
    .fill("count <= 2");
  await dialog
    .getByRole("button", { name: "Preview declaration", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Add to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("Behaviour entry point").selectOption("Counter");
  await page.getByRole("button", { name: /Simulate/ }).click();
  await expect(page.getByText("B011", { exact: true })).toBeVisible();
  await page.getByText("B011", { exact: true }).click();
  await expect(
    page.getByText("An event leaves a state's declared range", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Backend witness failed source replay/),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Trace", exact: true }).click();
  await page
    .getByRole("button", { name: "Go to trace step 3", exact: true })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: "count" }).getByRole("cell").last(),
  ).toHaveText("3");
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/domain-counterexample.png"),
    fullPage: true,
  });
  const machine = blocks.getByRole("article", { name: "Counter", exact: true });
  const guard = machine.getByLabel("When this can happen", { exact: true });
  if (!(await guard.isVisible()))
    await machine.locator("summary").first().click();
  await guard.fill("count < 2");
  await guard.press("Enter");
  await expect(blocks.getByRole("status")).toContainText(
    "Blocks match the current source",
  );
  await page.getByRole("button", { name: /Simulate/ }).click();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(
    page.getByText("No violation in sampled runs", { exact: true }),
  ).toBeVisible();
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  console.log(
    "Blocks-created range overflow is a located design finding with a three-event trace; adding the guard fixes the bounded simulation without writing source.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
