import { browserExecutable, browserType } from "./browser-launch.mjs";
import { waitForRecovery } from "./recovery-ack.mjs";
// Run via pc-tools headless after independent review releases the browser slot.
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-recovered-types-"));
let app, browser, release;
try {
  const original =
    "type Customer = {id: Nat};\nflow existing(customer: Customer) -> Bool {return true;}";
  await writeFile(join(root, "main.pym"), original);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(
    page.getByRole("button", { name: "Edit inputs and output", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create source file", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Describe inputs and outputs/ })
    .click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog
      .getByLabel("Input 1 type", { exact: true })
      .locator('option[value="named"]'),
  ).toHaveCount(1);
  await dialog.getByLabel("Component name", { exact: true }).fill("newQuote");
  await dialog
    .getByLabel("Input 1 type", { exact: true })
    .selectOption("named");
  await dialog
    .getByLabel("Input 1 type name", { exact: true })
    .selectOption("Customer");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await waitForRecovery(
    app,
    (r) => [
      r.context?.newDesign?.options.name,
      r.context?.newDesign?.options.inputs[0]?.type.name,
    ],
    ["newQuote", "Customer"],
  );
  await app.close();
  app = await startStudio({ path: root });
  await page.goto(app.url);
  let heldResolve;
  const reached = new Promise((resolve) => {
    heldResolve = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/run", async (route) => {
    heldResolve();
    await gate;
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Resume new design", exact: true })
    .click();
  await reached;
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Component name", { exact: true }),
  ).toHaveValue("newQuote");
  release();
  release = null;
  await expect(
    dialog
      .getByLabel("Input 1 type name", { exact: true })
      .locator('option[value="Customer"]'),
  ).toHaveCount(1);
  // Await a real successful catalogue load, not merely the retained option label.
  await expect(
    dialog.getByText("Existing project types could not be loaded.", {
      exact: false,
    }),
  ).toHaveCount(0);
  await expect(dialog).toHaveAttribute("data-type-catalogue", "ready");
  await expect(
    dialog.getByRole("button", { name: "Create and check", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Create and check", exact: true })
    .click();
  await Promise.race([
    dialog.waitFor({ state: "hidden" }),
    dialog
      .getByRole("alert")
      .waitFor()
      .then(async () => {
        throw Error(await dialog.innerText());
      }),
  ]);
  await expect(dialog).toHaveCount(0);
  const generated = await readFile(join(root, "component.pym"), "utf8");
  assert.match(generated, /import "\.\/main.pym";/);
  assert.match(generated, /Customer/);
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  console.log(
    "Recovered new-component form reloads project types when the held check finishes, then creates the import without losing its fields.",
  );
} finally {
  release?.();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
