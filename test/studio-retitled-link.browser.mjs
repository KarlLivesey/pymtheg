import { browserExecutable, browserType } from "./browser-launch.mjs";
// Run through the bounded headless helper once independent review releases browser use.
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { proposeContractChange } from "../dist/architecture/planning.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-retitle-ui-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  const signal = new AbortController().signal;
  const baseline = await app.service.importArchitecture(
    "WAL design",
    [{ path: "design.md", text: "## Write ahead log {#storage}\nUse WAL." }],
    signal,
  );
  const target = baseline.entities.find((e) => e.kind === "heading");
  const original = {
    ...proposeContractChange("D1", target, baseline.id),
    title: "Adopt WAL",
    status: "accepted",
  };
  const planned = await app.service.savePlanItem(
    baseline.id,
    original,
    "Decision",
    signal,
  );
  await app.service.editArchitectureDocument(
    planned.id,
    "design.md",
    "## Separate journal {#storage}\nUse a separate journal.",
    "Retitle",
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
    .getByRole("button", { name: "Needs attention", exact: true })
    .click();
  const work = page.getByRole("region", {
    name: "Architecture work to review",
  });
  await expect(work).toContainText("Write ahead log");
  await expect(work).toContainText("Separate journal");
  await work.getByRole("button", { name: "Adopt WAL", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  await expect(form).toContainText("Separate journal");
  await expect(
    form.getByRole("region", { name: "Previously reviewed target" }),
  ).toContainText("Use WAL.");
  await expect(
    form.getByRole("region", { name: "Current linked target" }),
  ).toContainText("Use a separate journal.");
  await form
    .getByRole("button", {
      name: "I reviewed these linked targets",
      exact: true,
    })
    .click();
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  await page
    .getByRole("button", { name: "Needs attention", exact: true })
    .click();
  await expect(work).toContainText("No gaps found by these structural checks");
  const head = (await app.service.architectureOverview()).index;
  const saved = await app.service.architectureRecord(head.id, "plan:D1");
  assert.equal(saved.data.originRevision, baseline.id);
  assert.ok(saved.data.linkReviewRevision);
  console.log(
    "Renamed linked target is visible in Needs attention; explicit acknowledgement clears the reminder and preserves original provenance.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
