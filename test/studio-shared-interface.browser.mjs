// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { waitForRecovery } from "./recovery-ack.mjs";
// Execute only through pc-tools headless; all waits use observable UI state.
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-interface-edit-ui-"));
const source =
  'import "types.pym";\nop fetch() -> Result<Nat, Errors>;\nflow quote() -> Nat {\n  call fetch() as result;\n  match result { Ok(value) => { return value; } Declined => { return 0; } }\n}\n';
const typesSource = "type Errors = Declined;\n";
let app, browser;
try {
  await writeFile(join(root, "main.pym"), source);
  await writeFile(join(root, "types.pym"), typesSource);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  ).newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Edit inputs and output", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Inputs and output for quote",
  });
  await expect(dialog).toBeVisible();
  await dialog
    .locator("summary")
    .filter({ hasText: "Shared records and error cases" })
    .click();
  await dialog
    .locator("summary")
    .filter({ hasText: "Errors · choice" })
    .click();
  await dialog
    .getByRole("button", { name: "Add Errors outcome", exact: true })
    .click();
  await dialog
    .getByLabel("Errors outcome 2 name", { exact: true })
    .fill("OutcomeUnknown");
  await waitForRecovery(
    app,
    (r) =>
      r.context?.interfaceDraft?.edit.typeEdits?.[0]?.definition.variants.map(
        (v) => v.name,
      ),
    ["Declined", "OutcomeUnknown"],
  );
  await app.close();
  app = await startStudio({ path: root });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Resume interface form", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Inputs and output for quote" });
  await expect(dialog).toBeVisible();
  await dialog
    .locator("summary")
    .filter({ hasText: "Shared records and error cases" })
    .click();
  await dialog
    .locator("summary")
    .filter({ hasText: "Errors · choice" })
    .click();
  await expect(
    dialog.getByLabel("Errors outcome 2 name", { exact: true }),
  ).toHaveValue("OutcomeUnknown");
  console.log("Unapplied shared-type form survived a real server restart.");
  await dialog
    .getByRole("button", { name: "Preview interface changes", exact: true })
    .click();
  const changes = dialog.getByRole("region", { name: "Interface changes" });
  await expect(changes).toContainText("types.pym");
  await expect(changes).toContainText("OutcomeUnknown");
  await expect(changes).toContainText("Potentially affected");
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/shared-interface-preview.png",
    ),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Apply to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await waitForRecovery(
    app,
    (r) =>
      r.drafts
        .find((d) => d.path === "types.pym")
        ?.text.includes("OutcomeUnknown"),
    true,
  );
  await expect(page.locator("body")).toContainText("OutcomeUnknown");
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  assert.equal(await readFile(join(root, "types.pym"), "utf8"), typesSource);
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("match result");
  await page
    .getByRole("button", { name: "Edit inputs and output", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: "Shared records and error cases" })
    .click();
  await page.locator("summary").filter({ hasText: "Errors · choice" }).click();
  await expect(
    page.getByLabel("Errors outcome 2 name", { exact: true }),
  ).toHaveValue("OutcomeUnknown");
  console.log(
    "Shared outcome edit: affected callers visible, multi-file buffer applied and recovered, source files unchanged.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
