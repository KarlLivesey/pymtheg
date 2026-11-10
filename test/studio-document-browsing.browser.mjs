import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-document-browsing-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  const signal = new AbortController().signal;
  let saved = await app.service.importArchitecture(
    "Design",
    [{ path: "design.md", text: "# Project design\n\nRetain the decision." }],
    signal,
  );
  saved = await app.service.savePlanItem(
    saved.id,
    { ...newPlanItem("R1"), title: "Retain decisions" },
    "Plan",
    signal,
  );
  const original = await app.service.architectureDocument(
    saved.id,
    ".pymtheg-sources.json",
  );
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Documents and decisions", exact: true })
    .click();
  const rows = page.locator(".architecture-list > .architecture-row");
  await expect(rows.filter({ hasText: "design.md" })).toBeVisible();
  assert.equal(
    await rows.count(),
    1,
    "Only the user's design document belongs in the default list",
  );
  await page.getByText("Workspace data files", { exact: false }).click();
  const workspace = page.getByRole("region", { name: "Workspace data files" });
  await workspace
    .getByRole("button", { name: ".pymtheg-sources.json", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Retained document", exact: true }),
  ).toContainText("pymtheg.sources/v1");
  await expect(
    page.getByRole("button", { name: "Edit stored copy", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Managed by Pymtheg", { exact: false }),
  ).toBeVisible();
  assert.equal(
    (await app.service.architectureDocument(saved.id, ".pymtheg-sources.json"))
      .text,
    original.text,
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/document-browsing.png"),
    fullPage: true,
  });
  console.log(
    "Document browsing prioritizes human design documents; workspace data stays inspectable without a dead-end edit action.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
