// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-gui-rebase-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  const signal = new AbortController().signal,
    item = {
      ...newPlanItem("R1"),
      title: "Original decision",
      owner: "architecture",
    };
  const initial = await app.service.savePlanItem("", item, "Original", signal);
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1050 },
  });
  await page.goto(app.url);
  await expect(
    page.getByRole("heading", { name: "Architecture workspace", exact: true }),
  ).toBeVisible();
  await page
    .locator(".architecture-row")
    .filter({ hasText: "Original decision" })
    .click();
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  await form.getByLabel("Short title").fill("My recovered decision");
  await app.service.savePlanItem(
    initial.id,
    { ...item, title: "Concurrent stored decision" },
    "Other editor",
    signal,
    { document: "architecture/plan.json", originalId: "R1" },
  );
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form.getByRole("alert")).toContainText("record changed");
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Restore architecture draft",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restore architecture draft", exact: true })
    .click();
  await expect(form.getByLabel("Short title")).toHaveValue(
    "My recovered decision",
  );
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await form
    .getByRole("button", { name: "Review current version", exact: true })
    .click();
  await expect(
    form.getByRole("region", { name: "Review conflicting edit" }),
  ).toContainText("Concurrent stored decision");
  const originalPanel = form
    .getByRole("region", { name: "Review conflicting edit" })
    .locator(".architecture-conflict-columns > section")
    .first();
  await expect(originalPanel).toContainText("Original decision");
  await expect(originalPanel).not.toContainText("My recovered decision");
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/conflict-review.png"),
    fullPage: true,
  });
  await form
    .getByRole("button", { name: "Continue with my draft", exact: true })
    .click();
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  const index = (await app.service.architectureOverview()).index;
  assert.equal(
    index.entities.find((e) => e.id === "plan:R1").name,
    "My recovered decision",
  );
  assert.equal(
    (await app.service.architectureRecord(initial.id, "plan:R1")).data.title,
    "Original decision",
  );
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/recovered-record-current.png",
    ),
    fullPage: true,
  });
  console.log(
    "Architecture conflict GUI: competing edit is shown, Cancel retains the draft, explicit comparison rebases it, save preserves historical versions.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
