import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { waitForRecovery } from "./recovery-ack.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-resource-merge-ui-"));
const original =
  "resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; }\nflow finish(take file: File) -> Unit effects(state.File) { transition file -> Closed; }\n";
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
  await dialog.getByLabel("State 3 name", { exact: true }).fill("Failed");
  await dialog
    .getByRole("button", { name: "Add allowed transition", exact: true })
    .click();
  await dialog
    .getByLabel("Transition 2 from", { exact: true })
    .selectOption("Closed");
  await dialog
    .getByLabel("Transition 2 to", { exact: true })
    .selectOption("Closed");
  await waitForRecovery(
    app,
    (r) => r?.context?.declarationDraft?.declaration?.transitions?.[1]?.from,
    "Closed",
  );
  await waitForRecovery(
    app,
    (r) => r?.context?.declarationDraft?.declaration?.states?.[2],
    "Failed",
  );
  await waitForRecovery(
    app,
    (r) => r?.context?.declarationDraft?.declaration?.transitions?.[1]?.to,
    "Closed",
  );
  await app.close();
  const incoming = original
    .replace("states Open, Closed;", "states Open, Closed, Archived;")
    .replace("Open -> Closed;", "Open -> Closed; Open -> Open;");
  await writeFile(join(root, "main.pym"), incoming);
  app = await startStudio({ path: root });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Resume declaration form", exact: true })
    .click();
  const conflict = dialog.getByRole("region", {
    name: "Lifecycle changed on disk",
    exact: true,
  });
  await expect(conflict).toContainText("Add transition Closed→Closed");
  await expect(conflict).toContainText("Add transition Open→Open");
  await expect(conflict).toContainText("Add state Failed");
  await expect(conflict).toContainText("Add state Archived");
  await conflict
    .getByRole("button", { name: "Combine independent changes", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Preview lifecycle changes", exact: true })
    .click();
  const preview = dialog.getByRole("region", {
    name: "Lifecycle edit preview",
    exact: true,
  });
  await expect(preview).toContainText("Closed -> Closed;");
  await expect(preview).toContainText("Open -> Open;");
  await expect(preview).toContainText("Archived");
  await expect(preview).toContainText("Failed");
  await dialog
    .getByRole("button", {
      name: "Apply lifecycle changes and check",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("Closed -> Closed;");
  await expect(page.locator(".cm-content")).toContainText("Open -> Open;");
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), incoming);
  console.log(
    "PASS: independent lifecycle state additions and rules survive restart, combine explicitly, preview both versions and stay unsaved.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
