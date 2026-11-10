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
const root = await mkdtemp(join(tmpdir(), "pym-declaration-restart-"));
const original =
  "flow main() -> Unit effects(state.Connection) { return unit; }\n";
let app, browser, page;
try {
  await writeFile(join(root, "main.pym"), original);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  ).newPage();
  page.setDefaultTimeout(0);
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  console.log("Opening Studio");
  await page.goto(app.url);
  console.log("Loaded Studio");
  await expect(page.locator(".statusbar")).toContainText("completed");
  console.log("Initial check completed");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  const dialog = page.getByRole("dialog", {
    name: "Add to this design",
    exact: true,
  });
  async function previewDeclaration() {
    const requested = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/declaration") &&
        r.request().postDataJSON()?.action === "preview",
    );
    await dialog
      .getByRole("button", { name: "Preview declaration", exact: true })
      .click();
    const response = await requested;
    assert.equal(response.status(), 200, await response.text());
  }

  await blocks
    .getByRole("button", { name: "Add to this design", exact: true })
    .click();
  console.log("Opened declaration choices");
  await dialog.getByRole("button", { name: /Resource lifecycle/ }).click();
  await dialog.getByLabel("Resource name", { exact: true }).fill("Connection");
  console.log("Named resource");
  await dialog.getByLabel("State 1 name", { exact: true }).fill("Active");
  await dialog
    .getByRole("button", { name: "Remove state 2", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Add state", exact: true }).click();
  await dialog.getByLabel("State 2 name", { exact: true }).fill("Released");
  await dialog
    .getByLabel("Cleanup complete in state 2", { exact: true })
    .check();
  await dialog
    .getByLabel("Transition 1 to", { exact: true })
    .selectOption("Released");
  console.log(
    "States edited",
    await dialog
      .locator("select")
      .evaluateAll((xs) =>
        xs.map((x) => ({ value: x.value, text: x.textContent })),
      ),
  );
  await expect(
    dialog.getByLabel("Starting state", { exact: true }),
  ).toHaveValue("Active");
  await expect(
    dialog.getByLabel("Transition 1 to", { exact: true }),
  ).toHaveValue("Released");
  await previewDeclaration();
  await expect(
    dialog.getByRole("region", { name: "New declaration preview" }),
  ).toContainText("terminal Released;");
  console.log("Resource preview returned");
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/declaration-resource.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Add to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  console.log("Resource added");
  const steps = blocks.getByRole("region", { name: "Steps", exact: true });
  await steps.getByText("Add a step", { exact: true }).click();
  await steps
    .getByLabel("Resource to create", { exact: true })
    .selectOption("Connection");
  await steps
    .getByRole("button", { name: "Create resource", exact: true })
    .click();
  console.log("Resource instance created");
  await expect(page.getByText("O004", { exact: true })).toBeVisible();
  await steps
    .getByLabel("Resource to change", { exact: true })
    .selectOption("ownedConnection");
  await steps.getByLabel("New state", { exact: true }).selectOption("Released");
  await steps
    .getByRole("button", { name: "Add state change", exact: true })
    .click();
  await expect(page.getByText("O004", { exact: true })).toHaveCount(0);
  console.log(
    "New lifecycle creates a real cleanup obligation and its declared state transition resolves it.",
  );
  await blocks
    .getByRole("button", { name: "Add to this design", exact: true })
    .click();
  await dialog.getByRole("button", { name: /Data shape/ }).click();
  await dialog
    .getByLabel("Data shape record name", { exact: true })
    .fill("Batch");
  await dialog.getByLabel("Data shape field 1 name", { exact: true }).fill("");
  await waitForRecovery(
    app,
    (r) =>
      r.context?.declarationDraft?.declaration.definition?.fields?.[0]?.name,
    "",
  );
  await dialog
    .getByRole("button", { name: "Close and keep form", exact: true })
    .click();
  await app.close();
  app = await startStudio({ path: root });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Resume declaration form", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Data shape record name", { exact: true }),
  ).toHaveValue("Batch");
  await expect(
    dialog.getByLabel("Data shape field 1 name", { exact: true }),
  ).toHaveValue("");
  await dialog
    .getByLabel("Data shape field 1 name", { exact: true })
    .fill("quantities");
  await dialog
    .getByLabel("Data shape field 1 type", { exact: true })
    .selectOption("list");
  await dialog
    .getByLabel("Data shape field 1 item type", { exact: true })
    .selectOption("Nat");
  await previewDeclaration();
  await expect(
    dialog.getByRole("region", { name: "New declaration preview" }),
  ).toContainText("List<Nat>");
  assert.deepEqual(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations.map((v) => v.id),
    [],
  );
  await dialog
    .getByRole("button", { name: "Add to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("type Batch");
  await blocks
    .getByRole("button", { name: "Add to this design", exact: true })
    .click();
  await dialog.getByRole("button", { name: /^Component/ }).click();
  await dialog.getByLabel("Component name", { exact: true }).fill("prepare");
  await dialog
    .getByRole("button", { name: "2. Return value", exact: true })
    .click();
  await dialog.getByLabel("Output type", { exact: true }).selectOption("named");
  await dialog
    .getByLabel("Output type name", { exact: true })
    .selectOption("Batch");
  await previewDeclaration();
  await expect(
    dialog.getByRole("region", { name: "New declaration preview" }),
  ).toContainText("flow prepare() -> Batch");
  await expect(
    dialog.getByRole("region", { name: "New declaration preview" }),
  ).toContainText("return unknown");
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/declaration-component-narrow.png",
    ),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Add to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("U001", { exact: true })).toBeVisible();
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  console.log(
    "Unfinished data shape survives a real restart, creates List<Nat>, and a new component reuses it with an explicit unresolved result. Source stays unsaved; axe and narrow layout pass.",
  );
} catch (error) {
  console.error(
    await page
      ?.locator("body")
      .innerText()
      .catch(() => null),
  );
  await page
    ?.screenshot({
      path: browserEvidence(
        "evidence/product-audit/declaration-recovery-failure.png",
      ),
      fullPage: true,
    })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
