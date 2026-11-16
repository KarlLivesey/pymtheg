// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 });
let app, browser;
const root = await mkdtemp(join(tmpdir(), "pym-recovery-owner-ui-"));
try {
  const source = "flow ready() -> Unit { return unit; }";
  await writeFile(join(root, "main.pym"), source);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext();
  const A = await context.newPage(),
    B = await context.newPage();
  for (const page of [A, B]) {
    page.setDefaultTimeout(0);
    await page.goto(app.url);
    await expect(page.locator(".statusbar")).toContainText("completed");
    await expect(page.locator("[data-recovery-current]")).toHaveAttribute(
      "data-recovery-current",
      "true",
    );
  }
  await B.locator(".cm-content").press("ControlOrMeta+a");
  await B.keyboard.insertText(source + "\n// Draft held in B\n");
  await expect(B.locator("[data-recovery-current]")).toHaveAttribute(
    "data-recovery-current",
    "true",
  );
  await expect(
    A.getByRole("alert").filter({
      hasText: "Another Studio window now owns recovery",
    }),
  ).toBeVisible();
  await A.getByRole("button", {
    name: "Review recovery and retry",
    exact: true,
  }).click();
  await A.getByRole("button", {
    name: "Use this window for recovery",
    exact: true,
  }).click();
  await expect(
    B.getByRole("alert").filter({
      hasText: "Another Studio window now owns recovery",
    }),
  ).toBeVisible();
  await expect(B.locator(".cm-content")).toContainText("Draft held in B");
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  console.log(
    "Recovery takeover immediately notifies the other idle tab and preserves its buffer and disk",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
