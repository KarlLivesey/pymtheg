// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-name-version-ui-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  const original = await app.service.importArchitecture(
    "Initial baseline",
    [{ path: "design.md", text: "Accepted design" }],
    new AbortController().signal,
  );
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1050 },
  });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Name current version", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Name current version" });
  await form
    .getByLabel("Version name", { exact: true })
    .fill("Ready for API review");
  await form
    .getByRole("button", { name: "Save named version", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  const current = (await app.service.architectureOverview()).index;
  assert.notEqual(current.id, original.id);
  assert.equal(current.snapshotHash, original.snapshotHash);
  await expect(page.getByLabel("Stored revision")).toHaveValue(current.id);
  await expect(page.locator(".architecture-revision-context")).toContainText(
    "Saved after: Initial baseline",
  );
  const options = await page
    .getByLabel("Stored revision")
    .locator("option")
    .allTextContents();
  assert.ok(options.some((s) => s.includes("Initial baseline")));
  assert.ok(options.some((s) => s.includes("Ready for API review")));
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/named-checkpoint.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Revision changes", exact: true })
    .click();
  await page
    .getByLabel("Compare with", { exact: true })
    .selectOption(original.id);
  await expect(page.locator(".architecture-changes")).toContainText(
    "0 records changed",
  );
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export all history", exact: true })
    .click();
  const download = await downloaded,
    path = join(root, "history.json");
  await download.saveAs(path);
  const archive = JSON.parse(await readFile(path, "utf8"));
  assert.equal(archive.schema, "pymtheg.architecture-history/v3");
  assert.equal(archive.snapshots.length, 1);
  assert.equal(archive.revisions.length, 2);
  assert.equal(archive.revisions[0].parentId, original.id);
  assert.equal(archive.revisions[1].parentId, null);
  await page.reload();
  await expect(page.getByLabel("Stored revision")).toHaveValue(current.id);
  await page.getByLabel("Stored revision").selectOption(original.id);
  await expect(
    page.getByText(/You are viewing a historical revision/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Name current version", exact: true }),
  ).toBeDisabled();
  console.log(
    "Named checkpoint GUI: two names, one content snapshot, no invented content diff, portable v3 history, reload and historical-view protection.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
