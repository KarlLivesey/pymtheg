import { browserExecutable, browserType } from "./browser-launch.mjs";
// Run only via pc-tools headless after independent review releases its browser work.
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-evidence-revision-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  const signal = new AbortController().signal;
  const first = await app.service.importArchitecture(
    "Original design",
    [{ path: "notes.md", text: "First notes" }],
    signal,
  );
  const item = {
    ...newPlanItem("R1"),
    title: "Keep accepted work",
    owner: "storage",
    acceptance: "Read after restart",
  };
  const baseline = await app.service.savePlanItem(
    first.id,
    item,
    "Record requirement",
    signal,
  );
  const current = await app.service.editArchitectureDocument(
    baseline.id,
    "notes.md",
    "Updated unrelated notes",
    "Current review target",
    signal,
  );
  await app.service.saveArchitectureDraft(0, {
    kind: "plan",
    target: { document: "architecture/plan.json", originalId: "R1" },
    baseRevision: baseline.id,
    item: { ...item, evidence: "Reviewed the current target" },
  });
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
    .getByRole("button", { name: "Restore architecture draft", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  await form.getByText("Record supporting evidence", { exact: true }).click();
  await expect(
    form.getByLabel("Evidence or review notes", { exact: true }),
  ).toHaveValue("Reviewed the current target");
  await form
    .getByRole("button", { name: "Use currently viewed revision", exact: true })
    .click();
  await expect(
    form.getByLabel("Revision the evidence concerns", { exact: true }),
  ).toHaveValue(current.id);
  await expect(
    form
      .getByLabel("Revision the evidence concerns", { exact: true })
      .locator("option:checked"),
  ).toContainText("Current review target");
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  const head = (await app.service.architectureOverview()).index;
  assert.equal(
    (await app.service.architectureRecord(head.id, "plan:R1")).data
      .evidenceRevision,
    current.id,
  );
  console.log(
    "Restored draft records evidence against the displayed current revision, with named choices and retained notes.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
