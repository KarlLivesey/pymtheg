import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-create-only-ui-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  await app.service.savePlanItem(
    "",
    {
      ...newPlanItem("REQ-1"),
      title: "Original title",
      detail: "Important reasoning",
      owner: "design",
    },
    "Initial",
    new AbortController().signal,
  );
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1050 },
  });
  const page = await context.newPage();
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Add planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  await expect(form).toBeVisible();
  const audit = await new AxeBuilder({ page }).analyze();
  const violations = audit.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.html),
  }));
  console.log(JSON.stringify(violations, null, 2));
  assert.deepEqual(violations, []);
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/post-eighth/planning-accessibility.png",
    ),
    fullPage: true,
  });
  console.log(
    "Architecture planning form passes the automated accessibility scan.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
