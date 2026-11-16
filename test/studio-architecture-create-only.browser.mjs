// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-create-only-ui-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  await app.service.savePlanItem(
    "",
    {
      ...newPlanItem("REQ-1"),
      title: "Original title",
      detail: "Important reasoning",
      owner: "design",
    },
    "Initial",
    new AbortController().signal,
  );
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1050 },
  });
  page.setDefaultTimeout(0);
  let releaseOverview, receivedOverview;
  const overviewGate = new Promise((resolve) => {
    releaseOverview = resolve;
  });
  const overviewRequested = new Promise((resolve) => {
    receivedOverview = resolve;
  });
  await page.route("**/api/architecture", async (route) => {
    receivedOverview();
    await overviewGate;
    await route.continue();
  });
  await page.goto(app.url);
  await overviewRequested;
  await expect(
    page.getByText("Loading saved architecture…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Start with a requirement or decision",
      exact: true,
    }),
  ).toHaveCount(0);
  releaseOverview();
  await expect(page.locator(".architecture-workspace")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByRole("button", { name: "Add planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  await form.getByText("Record identity", { exact: true }).click();
  await form.getByLabel("Record ID", { exact: true }).fill("REQ-1");
  await form.getByLabel("Short title").fill("Unrelated new idea");
  await expect(
    form.getByRole("heading", {
      name: "What does this design need?",
      exact: true,
    }),
  ).toBeVisible();
  await expect(form.getByRole("alert")).toContainText("already exists");
  await expect(
    form.getByRole("button", { name: "Save planning record", exact: true }),
  ).toBeDisabled();
  const state = (await app.service.architectureOverview()).index;
  assert.equal(
    (await app.service.architectureRecord(state.id, "plan:REQ-1")).data.detail,
    "Important reasoning",
  );
  await form.getByLabel("Record ID", { exact: true }).fill("REQ-2");
  await form
    .getByLabel("Planning record or document", { exact: true })
    .fill("plan:REQ-1");
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form.getByRole("alert")).toContainText("unfinished link");
  await expect(
    form.getByLabel("Planning record or document", { exact: true }),
  ).toHaveValue("plan:REQ-1");
  await form.getByRole("button", { name: "Add link", exact: true }).click();
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  const after = (await app.service.architectureOverview()).index;
  assert.equal(
    (await app.service.architectureRecord(after.id, "plan:REQ-1")).data.detail,
    "Important reasoning",
  );
  assert.equal(
    (await app.service.architectureRecord(after.id, "plan:REQ-2")).data.title,
    "Unrelated new idea",
  );
  assert.deepEqual(
    (await app.service.architectureRecord(after.id, "plan:REQ-2")).data.links,
    [{ kind: "depends-on", target: "plan:REQ-1" }],
  );
  console.log(
    "Create-only planning GUI: existing ID stays a new-record form, cannot overwrite reasoning, and a distinct ID saves both records.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
