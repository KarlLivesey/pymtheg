import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-block-inputs-"));
const source = `// Keep this decision visible until the user chooses.
op send(amount: Nat) -> Unit;
flow main(amount: Nat, message: String) -> Unit { call send(unknown "Choose amount"); return unit; }`;
let app, browser;
try {
  await writeFile(join(root, "main.pym"), source);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".cm-content")).toContainText("Choose amount");
  await page.getByLabel("Check as I edit").uncheck();
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  const actions = blocks.locator(".visual-component-actions");
  const inputAction = await actions
    .getByRole("button", { name: "Edit inputs and output", exact: true })
    .boundingBox();
  const cancelAction = await actions
    .getByRole("button", { name: "Add cancellation steps", exact: true })
    .boundingBox();
  assert.ok(
    inputAction &&
      cancelAction &&
      (inputAction.x + inputAction.width + 4 <= cancelAction.x ||
        inputAction.y + inputAction.height + 4 <= cancelAction.y),
    "Component action labels need visible separation",
  );
  await expect(blocks.getByLabel("amount", { exact: true })).toHaveValue("");
  await expect(blocks.getByLabel("amount", { exact: true })).toHaveAttribute(
    "placeholder",
    "Choose amount",
  );
  await expect(page.getByText("U001", { exact: true })).toBeVisible();
  await expect(
    blocks.getByRole("button", { name: "Use message", exact: true }),
  ).toHaveCount(0);
  const choose = blocks.getByRole("button", {
    name: "Use amount",
    exact: true,
  });
  await choose.focus();
  await choose.press("Enter");
  await expect(blocks.getByLabel("amount", { exact: true })).toHaveValue(
    "amount",
  );
  await expect(page.getByText("U001", { exact: true })).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("send(amount)");
  await blocks.getByLabel("amount", { exact: true }).fill("");
  await blocks.getByLabel("amount", { exact: true }).press("Enter");
  await expect(page.getByText("U001", { exact: true })).toBeVisible();
  await expect(blocks.getByLabel("amount", { exact: true })).toHaveValue("");
  await expect(page.locator(".cm-content")).toContainText(
    'unknown "Choose amount"',
  );
  await blocks.getByRole("button", { name: "Use amount", exact: true }).click();
  await expect(page.getByText("U001", { exact: true })).toHaveCount(0);
  await blocks.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(blocks.getByLabel("amount", { exact: true })).toHaveValue("");
  await expect(page.getByText("U001", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText(
    'unknown "Choose amount"',
  );
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    axe.violations.map((v) => v.id),
    [],
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/block-input-help.png"),
    fullPage: true,
  });
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  console.log(
    "Unanswered call input stays a real source hole. Keyboard selection uses only the compatible local input; Undo restores the hole, with no disk write. Axe passes.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
