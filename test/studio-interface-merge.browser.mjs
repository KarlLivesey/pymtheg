import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
// Run with pc-tools headless after the independent review completes its browser work.
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-resume-body-"));
let app, browser;
try {
  const source = "flow quote(quantity: Nat) -> Bool {return quantity > 0;}";
  await writeFile(join(root, "main.pym"), source);
  app = await startStudio({ path: root });
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
    .getByRole("button", { name: "Edit inputs and output", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Add an input", exact: true })
    .click();
  await dialog.getByLabel("Input 2 name", { exact: true }).fill("urgent");
  await dialog.getByLabel("Input 2 type", { exact: true }).selectOption("Bool");
  await dialog
    .getByRole("button", { name: "Close and keep form", exact: true })
    .click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(
    source.replace("quantity: Nat", "quantity: Int"),
  );
  await page
    .getByRole("button", { name: "Resume interface form", exact: true })
    .click();
  const conflict = page.getByRole("dialog", {
    name: "Review changed interface",
  });
  await expect(
    conflict.getByRole("region", { name: "Combined interface" }),
  ).toContainText("quantity: Int, urgent: Bool");
  await conflict
    .getByRole("button", {
      name: "Continue reviewing saved changes",
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Input 1 type", { exact: true })).toHaveValue(
    "Int",
  );
  await expect(dialog.getByLabel("Input 2 name", { exact: true })).toHaveValue(
    "urgent",
  );
  await dialog
    .getByRole("button", { name: "Preview interface changes", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Apply to editor and check", exact: true })
    .click();
  await expect(editor).toContainText("quantity: Int, urgent: Bool");
  await page
    .getByRole("button", { name: "Edit inputs and output", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Input 1 type", { exact: true }).selectOption("Nat");
  await dialog
    .getByRole("button", { name: "Close and keep form", exact: true })
    .click();
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "flow quote(quantity: Bool, urgent: Bool) -> Bool {return true;}",
  );
  await page
    .getByRole("button", { name: "Resume interface form", exact: true })
    .click();
  const changed = page.getByRole("dialog", {
    name: "Review changed interface",
  });
  const continueButton = changed.getByRole("button", {
    name: "Continue reviewing saved changes",
    exact: true,
  });
  await expect(continueButton).toBeDisabled();
  await changed.getByRole("radio", { name: /Keep current:/ }).check();
  await expect(continueButton).toBeEnabled();
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/post-eighth/interface-field-conflict.png",
    ),
    fullPage: true,
  });
  await continueButton.click();
  await expect(
    page.getByRole("dialog").getByLabel("Input 1 type", { exact: true }),
  ).toHaveValue("Bool");
  const continued = page.getByRole("dialog");
  await continued
    .getByLabel("Input 1 type", { exact: true })
    .selectOption("unselected");
  await continued
    .getByRole("button", { name: "Close and keep form", exact: true })
    .click();
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "flow quote(quantity: Nat, urgent: Bool) -> Bool {return true;}",
  );
  await page
    .getByRole("button", { name: "Resume interface form", exact: true })
    .click();
  const unfinished = page.getByRole("dialog", {
    name: "Review changed interface",
  });
  await expect(
    unfinished.getByRole("region", { name: "Saved form changes" }),
  ).toContainText("type not chosen");
  await unfinished.getByRole("radio", { name: /Use saved:/ }).check();
  await unfinished
    .getByRole("button", {
      name: "Continue reviewing saved changes",
      exact: true,
    })
    .click();
  const incomplete = page.getByRole("dialog");
  await expect(
    incomplete.getByLabel("Input 1 type", { exact: true }),
  ).toHaveValue("unselected");
  await incomplete
    .getByRole("button", { name: "Preview interface changes", exact: true })
    .click();
  await expect(incomplete.getByRole("alert")).toContainText("quantity");
  await expect(incomplete.getByRole("alert")).toContainText("choose what");
  await incomplete
    .getByLabel("Input 1 type", { exact: true })
    .selectOption("Nat");
  await incomplete
    .getByRole("button", { name: "Preview interface changes", exact: true })
    .click();
  await expect(
    incomplete.getByRole("region", { name: "Interface changes" }),
  ).toBeVisible();
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  console.log(
    "Independent concurrent input change survives resume and apply; conflicting field requires an explicit choice; source bytes preserved.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
