import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { proposeContractChange } from "../dist/architecture/planning.js";
const root = await mkdtemp(join(tmpdir(), "pym-crlf-review-")),
  expect = baseExpect.configure({ timeout: 0 });
let app, browser;
try {
  app = await startStudio({ path: root });
  const signal = new AbortController().signal;
  const text =
    "## Backups\nKeep `pg_dump` output\nfor thirty days.\n\n```yaml\nbackup:\n  enabled: true\n```\n";
  const base = await app.service.importArchitecture(
      "Original",
      [{ path: "design.md", text }],
      signal,
    ),
    target = base.entities.find((e) => e.kind === "heading");
  const planned = await app.service.savePlanItem(
    base.id,
    {
      ...proposeContractChange("D1", target, base.id),
      title: "Keep backups",
      status: "accepted",
    },
    "Decision",
    signal,
  );
  const updated = await app.service.editArchitectureDocument(
    planned.id,
    "design.md",
    text.replaceAll("\n", "\r\n"),
    "Line endings",
    signal,
  );
  assert.ok(
    !(await app.service.architectureWork(updated.id)).some(
      (w) => w.kind === "changed-target",
    ),
  );
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(
    page.getByRole("region", { name: "Planning overview" }),
  ).toContainText("alongside 1 design document");
  await page.getByRole("button", { name: "1 Decision", exact: true }).click();
  await page.getByLabel("Record status").selectOption("accepted");
  await page
    .locator(".architecture-row")
    .filter({ hasText: "Keep backups" })
    .click();
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  await expect(
    form.getByText("Only prose formatting or line endings changed.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(form.getByRole("region", { name: "Changed lines" })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/crlf-review.png"),
    fullPage: true,
  });
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await app.service.editArchitectureDocument(
    updated.id,
    "design.md",
    text.replace("enabled: true", "enabled: false").replaceAll("\n", "\r\n"),
    "Change backup policy",
    signal,
  );
  await page.reload();
  await page.getByRole("button", { name: "1 Decision", exact: true }).click();
  await page.getByLabel("Record status").selectOption("accepted");
  await page
    .locator(".architecture-row")
    .filter({ hasText: "Keep backups" })
    .click();
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  const changed = form.getByRole("region", { name: "Changed lines" });
  await expect(changed.locator(".diff-removed")).toHaveCount(1);
  await expect(changed.locator(".diff-added")).toHaveCount(1);
  await expect(changed).toContainText("enabled: true");
  await expect(changed).toContainText("enabled: false");
  await expect(
    form.getByText("Line endings are normalized below", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/mixed-crlf-review.png"),
    fullPage: true,
  });
  console.log(
    "Mixed Markdown CRLF changes do not create a relationship alert; the comparison explains formatting-only changes without a misleading replacement diff.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
