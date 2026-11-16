// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-new-stale-"));
let app, browser, release;
try {
  const original = "flow main() -> Unit { return unit; }\n";
  await writeFile(join(root, "main.pym"), original);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  await page
    .getByRole("button", { name: "Add to this design", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Add to this design",
    exact: true,
  });
  await dialog.getByRole("button", { name: /^Component/ }).click();
  await dialog.getByLabel("Component name", { exact: true }).fill("worker");
  for (let i = 0; i < 3; i++)
    await dialog
      .getByRole("button", { name: "Add an input", exact: true })
      .click();
  await dialog
    .getByRole("button", { name: "Remove input 2", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Add an input", exact: true })
    .click();
  await expect(dialog.getByLabel("Input 3 name", { exact: true })).toHaveValue(
    "input4",
  );

  for (let i = 1; i <= 3; i++)
    await dialog
      .getByLabel(`Input ${i} type`, { exact: true })
      .selectOption("String");

  let captured;
  const intercepted = new Promise((r) => {
    captured = r;
  });
  const held = new Promise((r) => {
    release = r;
  });
  let handled;
  const finished = new Promise((r) => {
    handled = r;
  });
  await page.route("**/api/declaration", async (route) => {
    if (route.request().postDataJSON().action === "preview") {
      captured();
      await held;
      await route.continue().catch(() => {});
      handled();
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Preview declaration", exact: true })
    .click();
  await intercepted;
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const source = page.locator(".cm-content");
  await source.fill(original + "// A newer design note\n");
  release();
  await finished;
  await page.unroute("**/api/declaration");
  await page
    .getByRole("button", { name: "Resume declaration form", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Component name", { exact: true }),
  ).toHaveValue("worker");
  await expect(
    dialog.getByRole("region", { name: "New declaration preview" }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Preview declaration", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "New declaration preview" }),
  ).toContainText("flow worker");
  await dialog
    .getByRole("button", { name: "Add to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(source).toContainText("// A newer design note");
  await expect(source).toContainText("flow worker");
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  console.log(
    "A held preview cannot replace newer Text edits; resuming preserves form values, requires a fresh preview, and appends to the current buffer.",
  );
} finally {
  release?.();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
