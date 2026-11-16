// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-architecture-loading-"));
let app, browser, release;
try {
  app = await startStudio({ path: root });
  await app.service.savePlanItem(
    "",
    { ...newPlanItem("R1"), title: "Visible architecture" },
    "Initial",
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
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let requested;
  const arrived = new Promise((resolve) => {
    requested = resolve;
  });
  await page.route("**/api/architecture", async (route) => {
    requested();
    await gate;
    await route.continue();
  });
  await page.goto(app.url);
  await arrived;
  const architecture = page.getByRole("button", {
    name: "Architecture",
    exact: true,
  });
  await architecture.click();
  await architecture.click();
  await expect(architecture).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("Loading saved architecture…", { exact: true }),
  ).toBeVisible();
  const button = page.getByRole("button", {
    name: "Plan & code graphs",
    exact: true,
  });
  const before = await button.boundingBox();
  assert.ok(before);
  await page.mouse.move(
    before.x + before.width / 2,
    before.y + before.height / 2,
  );
  await page.mouse.down();
  release();
  await expect(
    page.getByText("Loading saved architecture…", { exact: true }),
  ).toHaveCount(0);
  const after = await button.boundingBox();
  assert.deepEqual(
    after,
    before,
    "Primary action must not move when the architecture response arrives",
  );
  await page.mouse.up();
  await expect(
    page.getByRole("region", { name: "Planned and existing system" }),
  ).toBeVisible();
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/architecture-loading-click.png",
    ),
    fullPage: true,
  });
  console.log(
    "A held architecture response cannot move the primary action or swallow a click started during loading.",
  );
} finally {
  release?.();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
