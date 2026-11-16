// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { waitForRecovery } from "./recovery-ack.mjs";
import { browserEvidence } from "./browser-evidence.mjs";

const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-machine-form-"));
const original =
  "// Existing source stays unchanged on disk.\nflow keep() -> Unit { return unit; }\n";
let app, browser;
try {
  await writeFile(join(root, "main.pym"), original);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  ).newPage();
  page.setDefaultTimeout(0);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  await blocks
    .getByRole("button", { name: "Add to this design", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Add to this design",
    exact: true,
  });
  await dialog.getByRole("button", { name: /^Event model/ }).click();
  await dialog.getByLabel("Event model name", { exact: true }).fill("Attempts");
  await dialog.getByLabel("State 1 minimum", { exact: true }).fill("-");
  await waitForRecovery(
    app,
    (r) => r?.context?.declarationDraft?.declaration?.states?.[0]?.min,
    "-",
  );
  await app.close();
  app = await startStudio({ path: root });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Resume declaration form", exact: true })
    .click();
  await expect(
    dialog.getByLabel("State 1 minimum", { exact: true }),
  ).toHaveValue("-");
  await dialog.getByLabel("State 1 minimum", { exact: true }).fill("0");
  await dialog.getByRole("button", { name: "Add state", exact: true }).click();
  await expect(
    dialog.getByLabel("State 2 name", { exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "Remove state 2", exact: true })
    .click();
  await expect(
    dialog.getByLabel("State 1 name", { exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Add event", exact: true }).click();
  await expect(
    dialog.getByLabel("Event 1 name", { exact: true }),
  ).toBeFocused();
  await dialog
    .getByLabel("When event 1 can happen", { exact: true })
    .fill("count < 3");
  await dialog
    .getByRole("button", { name: "Add change to event 1", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Event 1 change 1 state", { exact: true }),
  ).toBeFocused();
  await dialog
    .getByLabel("Event 1 change 1 state", { exact: true })
    .selectOption("count");
  await dialog
    .getByLabel("Event 1 change 1 new value", { exact: true })
    .fill("count + 1");
  await dialog
    .getByRole("button", { name: "Add safety rule", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Safety rule 1 name", { exact: true }),
  ).toBeFocused();
  const preview = async () => {
    const pending = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/declaration") &&
        r.request().postDataJSON()?.action === "preview",
    );
    await dialog
      .getByRole("button", { name: "Preview declaration", exact: true })
      .click();
    const response = await pending;
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const incomplete = await preview();
  assert.match(
    incomplete.text,
    /unknown "Safety rule withinLimit is not decided"/,
  );
  await dialog
    .getByLabel("Safety rule 1 expression", { exact: true })
    .fill("count <= 1");
  await preview();
  await page.setViewportSize({ width: 680, height: 880 });
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/machine-authoring-form.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Add to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByLabel("Behaviour entry point").selectOption("Attempts");
  await page.getByRole("button", { name: /Simulate/ }).click();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.getByText("Problem found", { exact: true })).toBeVisible();
  const machine = blocks.getByRole("article", {
    name: "Attempts",
    exact: true,
  });
  const summary = machine.locator("summary").first();
  if (await summary.count()) await summary.click();
  const guard = machine.getByLabel("When this can happen", { exact: true });
  await guard.fill("count < 1");
  await guard.press("Enter");
  await expect(blocks.getByRole("status")).toContainText(
    "Blocks match the current source",
  );
  await page.getByRole("button", { name: /Simulate/ }).click();
  await expect(
    page.getByText("No violation in sampled runs", { exact: true }),
  ).toBeVisible();
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  assert.deepEqual(errors, []);
  console.log(
    "Event model: recovered unfinished range, keyboard focus, narrow layout, real counterexample and guard correction; source stayed unsaved.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
