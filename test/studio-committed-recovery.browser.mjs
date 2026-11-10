import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
// Run the entire controller through pc-tools headless; uses an acknowledged draft, never a startup sleep.
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-committed-recovery-ui-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  const signal = new AbortController().signal;
  const initial = await app.service.savePlanItem(
    "",
    { ...newPlanItem("R1"), title: "Original decision", owner: "team" },
    "Initial",
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
    .locator(".architecture-row")
    .filter({ hasText: "Original decision" })
    .click();
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  const acknowledged = page.waitForResponse((response) => {
    if (
      !response.url().endsWith("/api/architecture/draft") ||
      response.request().method() !== "POST" ||
      !response.ok()
    )
      return false;
    return (
      response.request().postDataJSON()?.draft?.item?.title ===
      "Saved despite cleanup failure"
    );
  });
  await form.getByLabel("Short title").fill("Saved despite cleanup failure");
  await acknowledged;
  const recovery = await app.service.architectureDraft();
  await app.service.saveArchitectureDraft(recovery.version, {
    kind: "plan",
    baseRevision: initial.id,
    item: { ...newPlanItem("R2"), title: "Other session draft", owner: "team" },
  });
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  await expect(
    page.getByText("Planning record saved in a new revision.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Restore architecture draft",
      exact: true,
    }),
  ).toBeVisible();
  const current = (await app.service.architectureOverview()).index;
  assert.equal(
    (await app.service.architectureRecord(current.id, "plan:R1")).data.title,
    "Saved despite cleanup failure",
  );
  assert.equal(
    (await app.service.architectureDraft()).draft.item.title,
    "Other session draft",
  );
  await page
    .getByRole("button", { name: "Restore architecture draft", exact: true })
    .click();
  await expect(form.getByLabel("Short title")).toHaveValue(
    "Other session draft",
  );
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/integrated-recovery-confirmed.png",
    ),
    fullPage: true,
  });
  console.log(
    "Confirmed save remains visible; failed cleanup preserves and reloads the other session’s draft.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
