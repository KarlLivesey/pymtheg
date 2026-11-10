import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeWorkspace } from "../dist/project/workspace.js";
import { startStudio } from "../dist/studio/server.js";
import assert from "node:assert/strict";
const root = await mkdtemp(join(tmpdir(), "pym-source-plan-ui-")),
  expect = baseExpect.configure({ timeout: 0 });
let app, browser;
try {
  await initializeWorkspace(root, "Source planning");
  const original =
    "type Order = { amount: Nat };\nflow charge(order: Order) -> Bool { return order.amount > 0; }\n";
  await writeFile(join(root, "pay.pym"), original);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  console.log("Opened initialized project");
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page
    .getByRole("button", { name: "Add planning record", exact: true })
    .click();
  console.log("Opened planning form");
  const form = page.getByRole("region", { name: "Planning record" });
  await form.getByLabel("Short title").fill("Charge every order once");
  await form
    .getByLabel("How will we know it is done?")
    .fill("One provider request per order");
  await form.getByRole("button", { name: "Link charge", exact: true }).click();
  await expect(
    form.getByRole("button", { name: "Link Order", exact: true }),
  ).toBeVisible();
  const link = form.getByRole("region", {
    name: "Source link source:pay.pym#charge",
    exact: true,
  });
  await expect(link).toContainText("flow charge(order: Order)");
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  console.log("Saved source-linked plan");
  const saved = await app.service.architectureOverview();
  const entity = saved.index.entities.find((e) => e.kind === "requirement");
  assert.ok(entity);
  assert.ok(
    saved.index.edges.some(
      (e) => e.from === entity.id && e.to === "source:pay.pym#charge",
    ),
  );
  await writeFile(
    join(root, "pay.pym"),
    original
      .replace("amount: Nat", "amount: Int")
      .replace("order.amount > 0", "order.amount > 10"),
  );
  await page.reload();
  console.log("Reloaded after changing referenced type");
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page
    .getByRole("button", { name: "Needs attention", exact: true })
    .click();
  const work = page.getByRole("region", {
    name: "Architecture work to review",
  });
  await expect(work).toContainText("pay.pym#Order changed");
  console.log("Found source drift in Needs attention");
  await page
    .getByRole("button", { name: /1 Requirement/, exact: true })
    .click();
  await page
    .locator(".architecture-row")
    .filter({ hasText: "Charge every order once" })
    .click();
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  await expect(link).toContainText(
    "This component or a current dependency changed since this plan was saved:",
  );
  await link
    .getByRole("button", { name: "Inspect source:pay.pym#Order", exact: true })
    .click();
  const typeLink = link.getByRole("region", {
    name: "Source link source:pay.pym#Order",
    exact: true,
  });
  await expect(typeLink).toContainText("amount: Int");
  await typeLink
    .getByText("Source when this plan was last reviewed", { exact: true })
    .click();
  await expect(typeLink).toContainText("amount: Nat");
  await link
    .getByText("Source when this plan was last reviewed", { exact: true })
    .last()
    .click();
  await expect(link.locator("details pre").last()).toContainText("flow charge");
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/source-linked-plan.png"),
    fullPage: true,
  });
  await form
    .getByRole("button", {
      name: "I reviewed these source components and dependencies",
      exact: true,
    })
    .click();
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  const reviewed = await app.service.architectureOverview();
  assert.ok(
    !(await app.service.architectureWork(reviewed.index.id)).some(
      (w) => w.kind === "changed-target",
    ),
  );
  await page
    .getByRole("button", { name: "Needs attention", exact: true })
    .click();
  await expect(work).toContainText("No gaps found by these structural checks.");
  await expect(work).not.toContainText(
    "has changed since this plan reviewed it",
  );
  await expect(work).not.toContainText("Source contract");
  await page
    .getByRole("button", { name: /1 Requirement/, exact: true })
    .click();
  await page
    .locator(".architecture-row")
    .filter({ hasText: "Charge every order once" })
    .click();
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  await link
    .getByRole("button", { name: "Open pay.pym in source editor", exact: true })
    .last()
    .click();
  await expect(page.locator(".cm-editor")).toBeVisible();
  console.log(
    "A new plan links checked source, detects a dependent type edit after reload, retains its earlier source, saves explicit review and opens the source editor.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
