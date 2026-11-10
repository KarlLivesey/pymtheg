import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-resource-editor-"));
const source =
  "// Keep this purpose.\nresource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; }\nflow process(take file: File) -> Unit effects(state.File) { transition file -> Closed; return unit; }\n";
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
  page.on("pageerror", (e) => console.error(e));
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
  const open = blocks.getByRole("button", {
    name: "Edit lifecycle rules",
    exact: true,
  });
  await open.click();
  const dialog = page.getByRole("dialog", {
    name: "Edit resource lifecycle",
    exact: true,
  });
  await expect(dialog.getByLabel("Resource name", { exact: true })).toHaveValue(
    "File",
  );
  await expect(
    dialog.getByLabel("Resource name", { exact: true }),
  ).toHaveAttribute("readonly", "");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Unfinished new declaration" }),
  ).toHaveCount(0);
  await open.click();
  await dialog
    .getByRole("button", { name: "Remove transition 1", exact: true })
    .click();
  const preview = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/interface") &&
      r.request().postDataJSON()?.action === "preview-resource",
  );
  await dialog
    .getByRole("button", { name: "Preview lifecycle changes", exact: true })
    .click();
  assert.equal((await preview).status(), 200);
  await expect(
    dialog.getByRole("region", { name: "Lifecycle edit preview" }),
  ).toContainText("process");
  await expect(
    dialog.getByRole("region", { name: "Lifecycle edit preview" }),
  ).toContainText("no uses are silently rewritten");
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    a11y.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/resource-edit-preview.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", {
      name: "Apply lifecycle changes and check",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("R002", { exact: true })).toBeVisible();
  await expect(blocks.getByRole("status")).toContainText(
    "Blocks match the current source",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest(
            '[aria-label="Visual block editor"]',
          ),
      ),
    )
    .toBe(true);
  await open.click();
  await dialog
    .getByRole("button", { name: "Add allowed transition", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Preview lifecycle changes", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Apply lifecycle changes and check",
      exact: true,
    }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", {
      name: "Apply lifecycle changes and check",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("R002", { exact: true })).toHaveCount(0);
  await expect(blocks.getByRole("status")).toContainText(
    "Blocks match the current source",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest(
            '[aria-label="Visual block editor"]',
          ),
      ),
    )
    .toBe(true);
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  console.log(
    "PASS: edit existing lifecycle, inspect affected caller, expose illegal transition, restore it, preserve unsaved/disk boundaries.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
