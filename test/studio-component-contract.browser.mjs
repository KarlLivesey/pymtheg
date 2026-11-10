import { formatSource } from "../dist/language/format.js";
import { browserExecutable } from "./browser-launch.mjs";
import { chromium, webkit, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { waitForRecovery } from "./recovery-ack.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-block-component-"));
let app, browser;
try {
  const source =
    "op step() -> Unit cost calls exact 1;\nflow work(count: Nat) -> Nat requires count > 0 ensures result >= 0 bound count <= 50 overhead steps exact 1 budget calls <= 50 { for i in count { call step(); } return count; }";
  await writeFile(
    join(root, "main.pym"),
    formatSource(join(root, "main.pym"), source),
  );
  app = await startStudio({ path: root });
  const engine = process.env.PYM_TEST_ENGINE ?? "chromium";
  browser = await { chromium, webkit }[engine].launch({
    headless: true,
    executablePath: browserExecutable(engine),
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  ).newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  console.log("Ready for component authoring");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const definition = page.locator(".visual-flow").filter({
    has: page.getByRole("button", {
      name: "Edit component rules, budgets and bounds",
      exact: true,
    }),
  });
  await definition
    .getByRole("button", {
      name: "Edit component rules, budgets and bounds",
      exact: true,
    })
    .click();
  console.log("Contract opened");
  let dialog = page.getByRole("dialog", {
    name: "Edit component contract",
    exact: true,
  });
  await expect(
    dialog.getByLabel("Bound maximum 1", { exact: true }),
  ).toHaveValue("50");
  await dialog
    .getByText("Rules for callers and returned values (optional)", {
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Add caller rule", exact: true })
    .click();
  await dialog.getByLabel("Caller rule 2", { exact: true }).fill("count <= 40");
  assert.ok(!(await dialog.innerText()).includes("assumed return guarantees"));
  await dialog.getByLabel("Bound maximum 1", { exact: true }).fill("40");
  await dialog.getByLabel("Budget maximum 1", { exact: true }).fill("40");
  await dialog.getByLabel("Work 1 count", { exact: true }).fill("2");
  await waitForRecovery(
    app,
    (v) => v.context?.operationDraft?.edit?.bounds?.[0]?.maximum,
    "40",
  );
  console.log("Contract draft acknowledged");
  await page.reload();
  await expect(page.locator(".statusbar")).toContainText("completed");
  console.log("Reload ready");
  await page
    .getByRole("region", { name: "Unfinished operation contract" })
    .getByRole("button", { name: "Resume operation form", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Edit component contract",
    exact: true,
  });
  await expect(
    dialog.getByLabel("Bound maximum 1", { exact: true }),
  ).toHaveValue("40");
  await expect(
    dialog.getByLabel("Budget maximum 1", { exact: true }),
  ).toHaveValue("40");
  const preview = dialog.getByRole("button", {
    name: "Preview component changes",
    exact: true,
  });
  await preview.focus();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", {
      name: "Apply component changes and check",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(preview).toBeFocused();
  assert.deepEqual(
    (
      await new AxeBuilder({ page })
        .include(".operation-contract-editor")
        .analyze()
    ).violations,
    [],
  );
  await dialog
    .getByRole("button", {
      name: "Apply component changes and check",
      exact: true,
    })
    .click();
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".statusbar")).toContainText("No unsaved draft");
  const saved = await readFile(join(root, "main.pym"), "utf8");
  assert.equal(saved, formatSource(join(root, "main.pym"), saved));
  assert.match(saved, /overhead steps exact 2/);
  assert.match(saved, /bound count <= 40/);
  assert.match(saved, /budget calls <= 40/);
  console.log(
    engine +
      ": component rules, budget/bound recovery, keyboard preview, apply, save and accessibility pass",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
