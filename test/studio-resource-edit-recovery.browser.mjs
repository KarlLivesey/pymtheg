import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { waitForRecovery } from "./recovery-ack.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-lifecycle-recovery-"));
const original =
  "resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; }\nflow main() -> Unit { return unit; }\n";
let app, browser;
try {
  await writeFile(join(root, "main.pym"), original);
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
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  await blocks
    .locator(".visual-definition")
    .filter({ hasText: "File" })
    .locator("summary")
    .first()
    .click();
  await blocks
    .getByRole("button", { name: "Edit lifecycle rules", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Edit resource lifecycle",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Add state", exact: true }).click();
  await dialog.getByLabel("State 3 name", { exact: true }).fill("");
  await waitForRecovery(
    app,
    (r) => r?.context?.declarationDraft?.declaration?.states,
    ["Open", "Closed", ""],
  );
  await app.close();
  app = await startStudio({ path: root });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Resume declaration form", exact: true })
    .click();
  await expect(dialog.getByLabel("State 3 name", { exact: true })).toHaveValue(
    "",
  );
  await dialog.getByLabel("State 3 name", { exact: true }).fill("Failed");
  await waitForRecovery(
    app,
    (r) => r?.context?.declarationDraft?.declaration?.states,
    ["Open", "Closed", "Failed"],
  );
  await app.close();
  const current = original
    .replace("Open, Closed", "Open, Closed, Abandoned")
    .replace("terminal Closed", "terminal Closed, Abandoned");
  await writeFile(join(root, "main.pym"), current);
  app = await startStudio({ path: root });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Resume declaration form", exact: true })
    .click();
  const conflict = dialog.getByRole("region", {
    name: "Lifecycle changed on disk",
  });
  await expect(conflict).toContainText("Abandoned");
  await expect(conflict).toContainText("Failed");
  await expect(
    dialog.getByRole("button", {
      name: "Preview lifecycle changes",
      exact: true,
    }),
  ).toBeDisabled();
  await conflict
    .getByRole("button", { name: "Use current lifecycle", exact: true })
    .click();
  await expect(dialog.getByLabel("State 3 name", { exact: true })).toHaveValue(
    "Abandoned",
  );
  await dialog
    .getByRole("button", { name: "Preview lifecycle changes", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Apply lifecycle changes and check",
      exact: true,
    }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await dialog
    .getByRole("button", {
      name: "Apply lifecycle changes and check",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), current);
  console.log(
    "PASS: incomplete lifecycle fields survive restart; concurrent rules require an explicit choice; selected current rules apply without source writes.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
