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
const root = await mkdtemp(join(tmpdir(), "pym-data-events-ui-"));
const source = `// Preserve this design note.
type Request = { amount: Nat, label: String };
flow amount(r: Request) -> Nat { return r.amount; }
machine Counter {
  state count: Nat in 0..2 = 0;
  event advance when count < 2 { count = count + 1; }
  invariant bounded = count <= 1;
}`;
let app, browser;
try {
  await writeFile(join(root, "main.pym"), source);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".cm-content")).toContainText("machine Counter");
  await page.getByLabel("Check as I edit").uncheck();
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  await blocks
    .locator(".visual-definition")
    .filter({ hasText: "Request" })
    .first()
    .locator("summary")
    .first()
    .click();
  const amount = blocks
    .getByRole("article", { name: "Request", exact: true })
    .getByRole("article", { name: "amount", exact: true });
  await amount.getByLabel("Field type", { exact: true }).fill("String");
  await amount.getByLabel("Field type", { exact: true }).press("Enter");
  await expect(page.getByText("T002", { exact: true })).toBeVisible();
  console.log("Changing a data field exposes the affected caller");
  await blocks.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(amount.getByLabel("Field type", { exact: true })).toHaveValue(
    "Nat",
  );
  await expect(page.getByText("T002", { exact: true })).toHaveCount(0);
  console.log("Undo restores the field type and caller check");
  await blocks
    .locator(".visual-definition")
    .filter({ hasText: "Counter" })
    .first()
    .locator("summary")
    .first()
    .click();
  await page.getByLabel("Behaviour entry point").selectOption("Counter");
  await page.getByRole("button", { name: /Simulate/ }).click();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.getByText("Problem found", { exact: true })).toBeVisible();
  console.log("Original event guard yields a real counterexample");
  const guard = blocks.getByLabel("When this can happen", { exact: true });
  await guard.fill("count < 1");
  await guard.press("Enter");
  await expect(blocks.getByRole("status")).toContainText(
    "Blocks match the current source",
  );
  await page.getByRole("button", { name: /Simulate/ }).click();
  await expect(
    page.getByText("No violation in sampled runs", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText(
    "Preserve this design note.",
  );
  await expect(blocks.getByLabel("Set count", { exact: true })).toHaveValue(
    "count + 1",
  );
  await expect(
    blocks.getByLabel("Must always hold", { exact: true }),
  ).toHaveValue("count <= 1");
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  console.log(
    JSON.stringify(
      axe.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
          html: n.html,
        })),
      })),
    ),
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/block-data-events-audit.png"),
    fullPage: true,
  });
  assert.deepEqual(
    axe.violations.map((v) => v.id),
    [],
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/block-data-events.png"),
    fullPage: true,
  });
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  console.log(
    "Data-field edit exposes its affected caller and Undo restores it; event guard edit changes a real simulation from a counterexample to bounded sampled success. Source and disk provenance are preserved; axe passes.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
