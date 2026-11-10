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
  "type Customer = { name: String };\nflow quote(quantity: Nat) -> Bool {\n  // handwritten business decision\n  return quantity > 0;\n}\n";
let app, browser;
try {
  await writeFile(join(root, "main.pym"), source);
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
  console.log("Opened interface");
  let dialog = page.getByRole("dialog", {
    name: "Inputs and output for quote",
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Add an input", exact: true })
    .click();
  await dialog.getByLabel("Input 2 name", { exact: true }).fill("customer");
  await dialog
    .getByLabel("Input 2 type", { exact: true })
    .selectOption("named");
  await dialog
    .getByLabel("Input 2 type name", { exact: true })
    .selectOption("Customer");
  await dialog
    .getByRole("button", { name: "Preview interface changes", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Interface changes" }),
  ).toContainText("customer: Customer");
  await dialog
    .getByRole("button", { name: "Apply to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("customer: Customer");
  await expect(page.locator(".cm-content")).toContainText(
    "// handwritten business decision",
  );
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  await waitForRecovery(
    app,
    (r) =>
      r.drafts
        .find((d) => d.path === "main.pym")
        ?.text.includes("customer: Customer"),
    true,
  );
  console.log("Applied and persisted first edit");
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("customer: Customer");
  await page
    .getByRole("button", { name: "Edit inputs and output", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Inputs and output for quote" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Input 2 name", { exact: true })).toHaveValue(
    "customer",
  );
  console.log("Reconstructed interface after reload");
  await dialog
    .getByRole("button", { name: "Close and keep form", exact: true })
    .click();
  await page.getByRole("button", { name: "Discard form", exact: true }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(
    source
      .replace("quantity: Nat", "quantity: Nat, customer: Customer")
      .replace("quantity > 0", "quantity > 5"),
  );
  await page
    .getByRole("button", { name: "Edit inputs and output", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Inputs and output for quote" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Add an input", exact: true })
    .click();
  await dialog.getByLabel("Input 3 name", { exact: true }).fill("urgent");
  await dialog.getByLabel("Input 3 type", { exact: true }).selectOption("Bool");
  await dialog
    .getByRole("button", { name: "Preview interface changes", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Interface changes" }),
  ).toContainText("urgent: Bool");
  await dialog
    .getByRole("button", { name: "Apply to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(editor).toContainText("quantity > 5");
  await expect(editor).toContainText("urgent: Bool");
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/continuing-interface-edit.png",
    ),
    fullPage: true,
  });
  console.log(
    "Existing handwritten flow: project type reused, form reconstructs after reload, manual body edit preserved, interface rechecked without saving source.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
