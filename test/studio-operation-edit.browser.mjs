// SPDX-License-Identifier: MIT
import { browserExecutable } from "./browser-launch.mjs";
import {
  chromium,
  firefox,
  webkit,
  expect as baseExpect,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStudio } from "../dist/studio/server.js";
import { waitForRecovery } from "./recovery-ack.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-operation-edit-"));
const source =
  "// Keep these external-service assumptions.\nop reserve(n: Nat) -> Nat requires n >= 0 ensures result >= n cost calls exact n + 1 atomic;\nflow caller() -> Unit budget calls <= 2 { call reserve(0) as value; return unit; }\n";
const engine = process.env.PYM_TEST_ENGINE ?? "chromium";
let app, browser;
try {
  await writeFile(join(root, "main.pym"), source);
  app = await startStudio({ path: root });
  browser = await { chromium, firefox, webkit }[engine].launch({
    headless: true,
    executablePath: browserExecutable(engine),
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1100, height: 1000 } })
  ).newPage();
  page.setDefaultTimeout(0);
  page.on("pageerror", (e) => {
    console.error(e);
  });
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  await blocks
    .locator(".visual-definition")
    .filter({ hasText: "reserve" })
    .locator("summary")
    .first()
    .click();
  const open = blocks.getByRole("button", {
    name: "Edit operation rules and work",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "Edit operation contract",
    exact: true,
  });
  await open.click();
  await expect(dialog.getByLabel("Work 1 count", { exact: true })).toHaveValue(
    "n + 1",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Unfinished operation contract" }),
  ).toHaveCount(0);
  await open.click();
  await dialog
    .getByText("Rules for callers and returned values (optional)", {
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Add caller rule", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Caller rule 2", { exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "Remove caller rule 2", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Caller rule 1", { exact: true }),
  ).toBeFocused();
  await dialog.getByLabel("Caller rule 1", { exact: true }).fill("n >");
  await dialog.getByLabel("Work 1 count", { exact: true }).fill("n + 3");
  await dialog
    .getByRole("button", { name: "Add work summary", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Work 2 metric", { exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "Remove work summary 2", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Work 1 metric", { exact: true }),
  ).toBeFocused();
  await waitForRecovery(
    app,
    (r) => r.context.operationDraft?.edit.costs[0].expression,
    "n + 3",
  );
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  await app.close();
  app = await startStudio({ path: root });
  await page.goto(app.url);
  await expect(
    page.getByRole("region", { name: "Unfinished operation contract" }),
  ).toContainText("reserve");
  await page
    .getByRole("button", { name: "Resume operation form", exact: true })
    .click();
  await expect(dialog.getByLabel("Work 1 count", { exact: true })).toHaveValue(
    "n + 3",
  );
  await expect(dialog).toContainText(
    "Resumed your unfinished operation contract",
  );
  await dialog
    .getByText("Rules for callers and returned values (optional)", {
      exact: true,
    })
    .click();
  await expect(dialog.getByLabel("Caller rule 1", { exact: true })).toHaveValue(
    "n >",
  );
  await dialog
    .getByRole("button", { name: "Preview operation changes", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByLabel("Caller rule 1", { exact: true }).fill("n > 0");
  // A source change while the form is closed must be reviewed explicitly.
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const external = source.replace("n >= 0", "n >= 1").replace("n + 1", "n + 2");
  await writeFile(join(root, "main.pym"), external);
  await page
    .getByRole("button", { name: "Resume operation form", exact: true })
    .click();
  const conflict = dialog.getByRole("region", {
    name: "Operation changed while editing",
  });
  await expect(conflict).toContainText("n >= 0");
  await expect(conflict).toContainText("n >= 1");
  await expect(
    dialog.getByRole("button", {
      name: "Preview operation changes",
      exact: true,
    }),
  ).toBeDisabled();
  await conflict
    .getByRole("button", {
      name: "Keep my rule edits against current source",
      exact: true,
    })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Preview operation changes",
      exact: true,
    }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "Preview operation changes", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Operation edit preview" }),
  ).toContainText("caller");
  await expect(
    dialog.getByRole("region", { name: "Operation edit preview" }),
  ).toContainText("n + 3");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
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
    path: browserEvidence(
      `evidence/product-audit/operation-edit-${engine}.png`,
    ),
    fullPage: true,
  });
  await dialog
    .getByRole("button", {
      name: "Apply operation changes and check",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("C004", { exact: true })).toBeVisible();
  await expect(page.getByText("K002", { exact: true })).toBeVisible();
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
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), external);
  await waitForRecovery(app, (r) => r.context.operationDraft, null);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("n + 2");
  console.log(
    `${engine}: operation contract preview, durable restart, concurrent review, source findings, keyboard focus and undo pass`,
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
