import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
// Browser readiness and intercepted request completion determine ordering; no startup sleeps.
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-architecture-ui-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1500, height: 1050 },
    }),
    page = await context.newPage();
  await page.goto(app.url);
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page
    .getByRole("button", { name: "Add planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  await form.getByLabel("Short title").fill("Keep accepted writes");
  await form.getByLabel("Owner or team").fill("storage");
  await form
    .getByLabel("What and why")
    .fill("A power failure must not discard an acknowledged write.");
  await form
    .getByLabel("How will we know it is done?")
    .fill("Restart and read the same value.");
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  const planning = page.getByRole("region", { name: "Planning overview" });
  await expect(planning).toContainText("1 planning record");
  await planning
    .getByRole("button", { name: "1 Requirement", exact: true })
    .click();
  await page.getByLabel("Record status").selectOption("proposed");
  await page
    .locator(".architecture-row")
    .filter({ hasText: "Keep accepted writes" })
    .click();
  await expect(page.locator(".architecture-detail")).toContainText(
    "Restart and read the same value.",
  );
  await expect(page.locator(".architecture-detail")).toContainText(
    "No supporting evidence recorded.",
  );
  await mkdir(browserEvidence("evidence/product-audit"), { recursive: true });
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/planning-overview.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  await form.getByLabel("Status", { exact: true }).selectOption("accepted");
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  await page
    .getByRole("button", { name: "Revision changes", exact: true })
    .click();
  await page.getByLabel("Compare with").selectOption({ index: 1 });
  await expect(page.locator(".architecture-changes")).toContainText(
    "1 record changed",
  );
  await page
    .getByRole("button", { name: "Documents and decisions", exact: true })
    .click();
  await page.getByLabel("Search architecture").fill("power failure");
  await expect(page.locator(".architecture-row")).toContainText(
    "power failure",
  );
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  if (audit.violations.length) throw Error(JSON.stringify(audit.violations));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Architecture workspace", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".architecture-row")
      .filter({ hasText: "Keep accepted writes" }),
  ).toBeVisible();
  console.log(
    "Architecture GUI: create/edit a requirement, retain revisions, compare a status change, search document contents and reload persisted data; accessibility passed.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
