import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-outcomes-ui-"));
const original =
  "type Error = Busy | Rejected(String);\nop send(n: Nat) -> Result<Bool, Error>;\nflow main(n: Nat) -> Result<Bool, Error> { call send(n) as outcome; }\nop allowed() -> Bool;\nflow decide() -> Unit { call allowed() as answer; return unit; }";
let app, browser;
try {
  await writeFile(join(root, "main.pym"), original);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".cm-content")).toContainText("call send(n)");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const blocks = page.getByLabel("Visual block editor", { exact: true }),
    call = blocks.getByRole("article", { name: "Call send", exact: true });
  await expect(call).toContainText("Ok, Busy, Rejected");
  await call
    .getByRole("button", { name: "Handle each outcome", exact: true })
    .click();
  await expect(
    blocks.getByLabel("What still needs deciding?", { exact: true }),
  ).toHaveCount(3);
  await expect(page.locator(".cm-content")).toContainText("match outcome");
  await expect(
    call.getByRole("button", { name: "Handle each outcome", exact: true }),
  ).toHaveCount(0);
  await expect(call).toContainText("already has outcome steps");
  await expect(page.locator(".cm-content")).toContainText(
    "Rejected(returnedValue)",
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/block-outcomes.png"),
    fullPage: true,
  });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    result.violations.map((v) => v.id),
    [],
  );
  await blocks.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".cm-content")).not.toContainText("match outcome");
  await call
    .getByRole("button", { name: "Return this result", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("propagate outcome;");
  await blocks
    .getByRole("article", { name: "Call allowed", exact: true })
    .getByRole("button", { name: "Decide from this result", exact: true })
    .click();
  const decision = blocks.getByRole("article", { name: "Decide", exact: true });
  await expect(
    decision.getByLabel("When this is true", { exact: true }),
  ).toHaveValue("answer");
  await expect(
    decision.getByLabel("What still needs deciding?", { exact: true }),
  ).toHaveCount(2);
  await expect(page.locator(".cm-content")).toContainText("if answer");
  await page.setViewportSize({ width: 540, height: 960 });
  await expect(
    decision.getByRole("button", { name: "View text", exact: true }).first(),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/block-yes-no-narrow.png"),
    fullPage: true,
  });
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  console.log(
    "Typed call outcomes create three explicit open branches; Undo and compatible forwarding work. A yes/no result creates two open branches, with readable narrow layout. Disk remains unchanged.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
