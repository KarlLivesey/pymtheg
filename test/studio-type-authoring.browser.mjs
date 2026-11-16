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
const root = await mkdtemp(join(tmpdir(), "pym-type-authoring-"));
const source =
  "// Request boundary\ntype Request = { count: Nat };\nflow create() -> Request { return Request { count: 1 }; }\n";
let app, browser;
try {
  await writeFile(join(root, "main.pym"), source);
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
  await expect(page.locator(".cm-content")).toContainText("type Request");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  await page
    .locator(".visual-definition")
    .filter({ hasText: "Request" })
    .first()
    .locator("summary")
    .first()
    .click();
  let heldRoute;
  let arrived;
  const requested = new Promise((resolve) => {
    arrived = resolve;
  });
  const handler = async (route) => {
    if (route.request().postDataJSON()?.action === "type" && !heldRoute) {
      heldRoute = route;
      arrived();
      return;
    }
    await route.continue();
  };
  await page.route("**/api/interface", handler);
  await page
    .getByRole("button", {
      name: "Add or remove fields and outcomes",
      exact: true,
    })
    .click();
  await requested;
  await expect(
    page.getByRole("dialog", { name: "Opening data shape", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Opening data shape", exact: true })
      .getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Opening data shape", exact: true }),
  ).toHaveCount(0);
  await heldRoute.continue().catch(() => {});
  await page.unroute("**/api/interface", handler);
  await page
    .getByRole("button", {
      name: "Add or remove fields and outcomes",
      exact: true,
    })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Edit Request data shape",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Add Shape field", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Add Shape field", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Shape field 3 name", { exact: true }),
  ).toHaveValue("field3");
  await dialog
    .getByRole("button", { name: "Remove field 2", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Add Shape field", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Shape field 3 name", { exact: true }),
  ).toHaveValue("field4");
  await dialog
    .getByRole("button", { name: "Remove field 3", exact: true })
    .click();
  await dialog.getByLabel("Shape field 2 name", { exact: true }).fill("tag");
  await dialog
    .getByRole("button", { name: "Close and keep form", exact: true })
    .click();
  await waitForRecovery(
    app,
    (state) => state.context?.typeDraft?.definition.fields[1]?.name === "tag",
    true,
  );
  await app.close();
  app = await startStudio({ path: root });
  // A concurrent independent type edit must survive resuming the saved form.
  await writeFile(
    join(root, "main.pym"),
    source.replace("count: Nat", "count: Int, tag: Int"),
  );
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Resume data-shape form", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Edit Request data shape",
    exact: true,
  });
  await expect(
    dialog.getByRole("region", {
      name: "Review concurrent data-shape changes",
    }),
  ).toContainText("type not chosen");
  await dialog.getByRole("radio", { name: /Keep my saved edit/ }).check();
  await dialog
    .getByRole("button", { name: "Continue with these choices", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Shape field 1 type", { exact: true }),
  ).toHaveValue("Int");
  await expect(
    dialog.getByLabel("Shape field 2 name", { exact: true }),
  ).toHaveValue("tag");
  await expect(
    dialog.getByLabel("Shape field 2 type", { exact: true }),
  ).toHaveValue("unselected");
  await dialog
    .getByRole("button", { name: "Preview data-shape changes", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("tag");
  await expect(dialog.getByRole("alert")).toContainText("choose what");
  await dialog
    .getByLabel("Shape field 2 type", { exact: true })
    .selectOption("String");
  await dialog
    .getByRole("button", { name: "Preview data-shape changes", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Data-shape changes", exact: true }),
  ).toContainText("create");
  await expect(dialog).toContainText("tag: String");
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    audit.violations.map((entry) => ({
      id: entry.id,
      nodes: entry.nodes.map((node) => node.target),
    })),
    [],
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/type-authoring-preview.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Apply to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("tag: String");
  await expect(page.getByText("T005", { exact: true })).toBeVisible();
  assert.equal(
    await readFile(join(root, "main.pym"), "utf8"),
    source.replace("count: Nat", "count: Int, tag: Int"),
  );
  console.log(
    "Added data field survives restart and merges an independent current type change; preview lists affected constructor, apply exposes its missing field, and source stays unsaved. Axe passes.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
