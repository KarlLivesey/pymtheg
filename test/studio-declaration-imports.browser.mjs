// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { waitForRecovery } from "./recovery-ack.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-declaration-import-ui-"));
const original =
  "// Existing design stays unchanged on disk.\nflow keep() -> Unit { return unit; }\n";
let app, browser;
try {
  await mkdir(join(root, "types"));
  await writeFile(join(root, "main.pym"), original);
  await writeFile(join(root, "types", "a.pym"), "type Order = { id: Nat };");
  await writeFile(
    join(root, "types", "b.pym"),
    "type Order = { code: String };",
  );
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  ).newPage();
  page.setDefaultTimeout(0);
  page.on("pageerror", (error) => console.error(error));
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  await page
    .getByLabel("Visual block editor", { exact: true })
    .getByRole("button", { name: "Add to this design", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Add to this design",
    exact: true,
  });
  await dialog.getByRole("button", { name: /^Component/ }).click();
  await dialog.getByLabel("Component name", { exact: true }).fill("consume");
  await dialog
    .getByRole("button", { name: "Add an input", exact: true })
    .click();
  await dialog.getByLabel("Input 1 name", { exact: true }).fill("order");
  await dialog
    .getByLabel("Input 1 type", { exact: true })
    .selectOption("named");
  const search = dialog.locator(".project-type-search");
  await search.locator("summary").click();
  await search.getByLabel("Find type", { exact: true }).fill("Order");
  await search
    .getByRole("button", { name: "Search project types", exact: true })
    .click();
  await expect(search).toContainText("2 matching types");
  await search
    .getByRole("button", { name: "Use Order from types/b.pym", exact: true })
    .click();
  await waitForRecovery(
    app,
    (r) => r?.context?.declarationDraft?.typeSelections?.[0]?.symbolId,
    "types/b.pym#Order",
  );
  await app.close();
  app = await startStudio({ path: root });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Resume declaration form", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Input 1 type name", { exact: true }),
  ).toHaveValue("Order");
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
  };
  await preview();
  await expect(
    dialog.getByRole("region", { name: "New declaration preview" }),
  ).toContainText('import "./types/b.pym";');
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
      "evidence/product-audit/declaration-import-preview.png",
    ),
    fullPage: true,
  });
  await writeFile(
    join(root, "types", "b.pym"),
    "type Order = { code: String, version: Nat };",
  );
  const refused = page.waitForResponse((r) =>
    r.url().endsWith("/api/declaration/imports"),
  );
  await dialog
    .getByRole("button", { name: "Add to editor and check", exact: true })
    .click();
  assert.equal((await refused).status(), 409);
  await expect(dialog.getByRole("alert")).toContainText(
    "imported type source changed",
  );
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  const checkedAgain = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/declaration") &&
      r.request().postDataJSON()?.action === "context",
  );
  await dialog
    .getByRole("button", { name: "Check current source", exact: true })
    .click();
  await checkedAgain;
  const resumedSearch = dialog.locator(".project-type-search");
  if (!(await resumedSearch.evaluate((el) => el.open)))
    await resumedSearch.locator("summary").click();
  await resumedSearch.getByLabel("Find type", { exact: true }).fill("Order");
  await resumedSearch
    .getByRole("button", { name: "Refresh type sources", exact: true })
    .click();
  await expect(
    resumedSearch.getByRole("button", {
      name: "Use Order from types/b.pym",
      exact: true,
    }),
  ).toBeVisible();
  await resumedSearch
    .getByRole("button", { name: "Use Order from types/b.pym", exact: true })
    .click();
  await preview();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await dialog
    .getByRole("button", { name: "Add to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText(
    'import "./types/b.pym";',
  );
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  console.log(
    "PASS: exact cross-file type selection, restart recovery, stale dependency refusal, refresh, explicit import preview and unsaved application.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
