import { browserExecutable, browserType } from "./browser-launch.mjs";
import { waitForRecovery } from "./recovery-ack.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-new-draft-ui-"));
let app, browser;
try {
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
  await page
    .getByRole("button", { name: "Start with a recipe", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Describe inputs and outputs/ })
    .click();
  await page.getByLabel("Component name", { exact: true }).fill("makeQuote");
  await page.getByLabel("Input 1 type", { exact: true }).selectOption("record");
  await page.getByLabel("Input 1 record name", { exact: true }).fill("");
  await waitForRecovery(
    app,
    (r) => r.context?.newDesign?.options.inputs[0]?.type.name,
    "",
  );
  await app.close();
  app = await startStudio({ path: root });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Resume new design", exact: true })
    .click();
  await expect(page.getByLabel("Component name", { exact: true })).toHaveValue(
    "makeQuote",
  );
  await expect(
    page.getByLabel("Input 1 record name", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Input 1 record name", { exact: true })
    .fill("Customer");
  await expect(
    page.getByLabel("Input 1 field 1 type", { exact: true }),
  ).toHaveValue("unselected");
  await page
    .getByLabel("Input 1 field 1 type", { exact: true })
    .selectOption("String");
  await page
    .getByRole("button", { name: "Create and check", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("type Customer");
  assert.ok((await readdir(root)).includes("component.pym"));
  console.log(
    "New-design wizard with a temporarily empty type name survives a real restart and creates checked source after completion.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
