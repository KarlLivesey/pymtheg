import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStudio } from "../dist/studio/server.js";
import { waitForRecovery } from "./recovery-ack.mjs";
import { browserEvidence } from "./browser-evidence.mjs";

const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-operation-rules-ui-"));
const source =
  "flow main() -> Unit { call reserve(0) as reserved; return unit; }\n";
let app, browser;
async function open() {
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
  return page;
}
try {
  await writeFile(join(root, "main.pym"), source);
  let page = await open();
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  await page
    .getByRole("button", { name: "Add to this design", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Add to this design",
    exact: true,
  });
  await dialog.getByRole("button", { name: /External operation/ }).click();
  await dialog.getByLabel("Component name", { exact: true }).fill("reserve");
  await dialog
    .getByRole("button", { name: "Add an input", exact: true })
    .click();
  await dialog.getByLabel("Input 1 name", { exact: true }).fill("amount");
  await dialog.getByLabel("Input 1 type", { exact: true }).selectOption("Nat");
  await dialog
    .getByRole("button", { name: "2. Return value", exact: true })
    .click();
  await dialog.getByLabel("Output type", { exact: true }).selectOption("Nat");
  await dialog
    .getByText("Rules for callers and returned values (optional)", {
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Add caller rule", exact: true })
    .click();
  await dialog.getByLabel("Caller rule 1", { exact: true }).fill("amount >");
  await dialog
    .getByRole("button", { name: "Add return rule", exact: true })
    .click();
  await dialog
    .getByLabel("Return rule 1", { exact: true })
    .fill("result >= amount");
  await waitForRecovery(
    app,
    (r) => r.context?.declarationDraft?.declaration?.requires?.[0],
    "amount >",
  );
  await waitForRecovery(
    app,
    (r) => r.context?.declarationDraft?.declaration?.ensures?.[0],
    "result >= amount",
  );
  await browser.close();
  browser = null;
  await app.close();
  app = null;
  page = await open();
  assert.deepEqual(
    app.service.readRecovery().context.declarationDraft.declaration.requires,
    ["amount >"],
  );
  await page
    .getByRole("button", { name: "Resume declaration form", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Add to this design",
    exact: true,
  });
  await dialog
    .getByText("Rules for callers and returned values (optional)", {
      exact: true,
    })
    .click();
  if (process.env.PYM_DEBUG_OPERATION_RULES)
    console.log(
      "Resumed form",
      JSON.stringify(
        await dialog.evaluate((node) => ({
          details: [...node.querySelectorAll("details")].map((item) => ({
            open: item.open,
            summary: item.querySelector("summary")?.textContent,
          })),
          fields: [...node.querySelectorAll("textarea")].map((field) => ({
            label: field.closest("label")?.textContent,
            value: field.value,
          })),
          text: node.textContent,
        })),
      ),
    );
  await expect(dialog.getByLabel("Caller rule 1", { exact: true })).toHaveValue(
    "amount >",
  );
  await expect(dialog.getByLabel("Return rule 1", { exact: true })).toHaveValue(
    "result >= amount",
  );
  await dialog.getByLabel("Caller rule 1", { exact: true }).fill("amount > 0");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/declaration") &&
      r.request().postDataJSON()?.action === "preview",
  );
  await dialog
    .getByRole("button", { name: "Preview declaration", exact: true })
    .click();
  assert.equal((await response).status(), 200);
  const preview = dialog.getByRole("region", {
    name: "New declaration preview",
  });
  await expect(preview).toContainText("guarantees are assumptions");
  await expect(preview).toContainText("requires (amount > 0)");
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
    [],
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/operation-rules-narrow.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await dialog
    .getByRole("button", { name: "Add to editor and check", exact: true })
    .click();
  await expect(page.getByText("C004", { exact: true })).toBeVisible();
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  await blocks.getByLabel("amount", { exact: true }).fill("1");
  await blocks.getByLabel("amount", { exact: true }).press("Enter");
  await expect(blocks.getByRole("status")).toContainText(
    "Blocks match the current source",
  );
  await expect(page.getByText("C004", { exact: true })).toHaveCount(0);
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  console.log(
    "Operation rules survive restart, expose assumed guarantees, produce a real precondition finding and clear it after a Blocks edit; source stays unsaved.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
