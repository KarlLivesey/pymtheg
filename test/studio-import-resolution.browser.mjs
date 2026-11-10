import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
// Run the entire controller through pc-tools headless.
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-import-review-ui-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  const signal = new AbortController().signal,
    source = { id: "spec", label: "Storage design", kind: "upload" };
  let initial = await app.service.importArchitecture(
    "Original",
    [{ path: "design.md", text: "Original decision" }],
    signal,
    { source, mode: "add" },
  );
  await app.service.editArchitectureDocument(
    initial.id,
    "design.md",
    "Local decision",
    "Local",
    signal,
  );
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Import documents", exact: true })
    .click();
  await page.getByLabel("Import action").selectOption("spec");
  await page.getByLabel("Architecture files", { exact: true }).setInputFiles({
    name: "design.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("Upstream decision"),
  });
  await page
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  const conflict = page.getByRole("region", {
    name: "Resolve import conflicts",
  });
  await expect(conflict).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save reviewed import", exact: true }),
  ).toBeDisabled();
  await conflict.getByText("Your current version", { exact: true }).click();
  await conflict.getByText("Incoming version", { exact: true }).click();
  await expect(conflict).toContainText("Local decision");
  await expect(conflict).toContainText("Upstream decision");
  await conflict
    .getByLabel("Keep which version of design.md?")
    .selectOption("keep-both");
  await conflict
    .getByRole("button", { name: "Review resolved import", exact: true })
    .click();
  await expect(conflict).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save reviewed import", exact: true })
    .click();
  await expect(
    page.getByText("Architecture updated.", { exact: false }),
  ).toBeVisible();
  const index = (await app.service.architectureOverview()).index;
  assert.equal(
    (await app.service.architectureDocument(index.id, "design.md")).text,
    "Local decision",
  );
  const copy = index.documents.find((d) => d.path.startsWith("imports/"));
  assert.ok(copy);
  assert.equal(
    (await app.service.architectureDocument(index.id, copy.path)).text,
    "Upstream decision",
  );
  await page
    .getByRole("button", { name: "Import documents", exact: true })
    .click();
  await page.getByLabel("Import action").selectOption("spec");
  await page
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Resolve import conflicts" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save reviewed import", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import documents", exact: true })
    .click();
  await page.getByLabel("Architecture files", { exact: true }).setInputFiles({
    name: "design.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("Upstream revision 3"),
  });
  await page
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Resolve import conflicts" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save reviewed import", exact: true })
    .click();
  const refreshed = (await app.service.architectureOverview()).index;
  assert.equal(
    (await app.service.architectureDocument(refreshed.id, "design.md")).text,
    "Local decision",
  );
  assert.equal(
    (await app.service.architectureDocument(refreshed.id, copy.path)).text,
    "Upstream revision 3",
  );
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/import-conflict-tracking.png",
    ),
    fullPage: true,
  });
  console.log(
    "GUI source conflict: keep-both preserved local content, unchanged refresh needed no conflict, and the tracked copy followed the next upstream change.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
