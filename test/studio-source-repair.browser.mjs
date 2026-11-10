import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { browserEvidence } from "./browser-evidence.mjs";
import assert from "node:assert/strict";
const root = await mkdtemp(join(tmpdir(), "pym-source-repair-ui-")),
  expect = baseExpect.configure({ timeout: 0 });
let app, browser;
try {
  await writeFile(
    join(root, "old.pym"),
    "flow charge() -> Bool { return true; }",
  );
  app = await startStudio({ path: root });
  const saved = await app.service.savePlanItem(
    "",
    {
      ...newPlanItem("R1"),
      title: "Charge once",
      links: [{ kind: "depends-on", target: "source:old.pym#charge" }],
    },
    "Original link",
    new AbortController().signal,
  );
  await rename(join(root, "old.pym"), join(root, "new.pym"));
  await writeFile(
    join(root, "new.pym"),
    "flow capture() -> Bool { return true; }",
  );
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page
    .getByRole("button", { name: /1 Requirement/, exact: true })
    .click();
  await page
    .locator(".architecture-row")
    .filter({ hasText: "Charge once" })
    .click();
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" }),
    old = form.getByRole("region", {
      name: "Source link source:old.pym#charge",
      exact: true,
    });
  await expect(old).toContainText("This component is unavailable");
  const review = form.getByRole("button", {
    name: "I reviewed these source components and dependencies",
    exact: true,
  });
  await expect(review).toBeDisabled();
  await expect(form).toContainText(
    "You can save the record with its historical links without a new source review.",
  );
  await form.getByLabel("Status", { exact: true }).selectOption("superseded");
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  const kept = await app.service.architectureOverview();
  const historical = (
    await app.service.architectureRecord(kept.index.id, "plan:R1")
  ).data;
  assert.equal(historical.status, "superseded");
  assert.equal(historical.links[0].target, "source:old.pym#charge");
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  await expect(old).toContainText("This component is unavailable");
  await expect(review).toBeDisabled();
  await old
    .getByRole("button", {
      name: "Find a renamed or moved component",
      exact: true,
    })
    .click();
  await old
    .getByRole("button", { name: "Compare with capture", exact: true })
    .click();
  const compare = form.getByRole("region", {
    name: "Compare source replacement",
  });
  await expect(compare).toContainText("flow capture()");
  await old
    .getByText("Source when this plan was last reviewed", { exact: true })
    .click();
  await expect(old.locator("details pre")).toContainText("flow charge()");
  assert.equal(
    (await app.service.architectureRecord(saved.id, "plan:R1")).data.links[0]
      .target,
    "source:old.pym#charge",
  );
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/source-repair-comparison.png",
    ),
    fullPage: true,
  });
  await compare
    .getByRole("button", { name: "Replace source link", exact: true })
    .click();
  await expect(
    form.getByRole("region", {
      name: "Source link source:new.pym#capture",
      exact: true,
    }),
  ).toContainText("flow capture()");
  await expect(review).toBeEnabled();
  await review.click();
  await expect(form).toContainText("Source review is ready to save.");
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  const next = await app.service.architectureOverview();
  assert.equal(
    (await app.service.architectureRecord(next.index.id, "plan:R1")).data
      .links[0].target,
    "source:new.pym#capture",
  );
  console.log(
    "Renamed and moved source is suggested, both versions are reviewable, and the saved plan changes only after explicit replacement and save.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
