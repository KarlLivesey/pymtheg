import {
  chromium,
  firefox,
  webkit,
  expect as baseExpect,
} from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStudio } from "../dist/studio/server.js";
import { browserLaunchOptions } from "./browser-launch.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const engine = process.env.PYM_TEST_ENGINE ?? "chromium";
const root = await mkdtemp(join(tmpdir(), "pym-preview-focus-"));
let app, browser;
try {
  await writeFile(
    join(root, "main.pym"),
    "type Request = { count: Nat };\nop reserve(n: Nat) -> Nat requires n >= 0;\nflow quote(quantity: Nat) -> Bool { return quantity > 0; }\n",
  );
  app = await startStudio({ path: root });
  browser = await { chromium, firefox, webkit }[engine].launch(
    browserLaunchOptions(engine),
  );
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  ).newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  async function verify(dialog, buttonName, endpoint, action, regionName, key) {
    const button = dialog.getByRole("button", {
      name: buttonName,
      exact: true,
    });
    let release, arrived;
    const gate = new Promise((r) => {
      release = r;
    });
    const requested = new Promise((r) => {
      arrived = r;
    });
    let requests = 0;
    const handler = async (route) => {
      if (route.request().postDataJSON()?.action === action) {
        requests++;
        arrived();
        await gate;
      }
      await route.continue();
    };
    await page.route(`**/api/${endpoint}`, handler);
    try {
      await expect(button).toBeEnabled();
      await button.focus();
      await page.keyboard.press(key);
      await requested;
      await expect(button).toBeFocused();
      await expect(button).toHaveAttribute("aria-disabled", "true");
      // A repeated keypress while busy cannot start a second request.
      await page.keyboard.press(key);
      assert.equal(requests, 1);
      release();
      await expect(
        dialog.getByRole("region", { name: regionName, exact: true }),
      ).toBeVisible();
      await expect(button).not.toHaveAttribute("aria-disabled", "true");
      await expect(button).toBeFocused();
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement?.tagName === "BODY"),
        false,
      );
      console.log(
        `${engine}: ${buttonName} keeps focus while pending and after ${key}`,
      );
    } finally {
      release();
      await page.unroute(`**/api/${endpoint}`, handler);
    }
    await dialog
      .getByRole("button", { name: /^Close/ })
      .first()
      .click();
    await expect(dialog).toHaveCount(0);
    console.log("Closed", buttonName);
  }
  await page
    .getByRole("button", { name: "Edit inputs and output", exact: true })
    .click();
  await verify(
    page.getByRole("dialog", {
      name: "Inputs and output for quote",
      exact: true,
    }),
    "Preview interface changes",
    "interface",
    "preview",
    "Interface changes",
    "Enter",
  );
  const discardInterface = page.getByRole("button", {
    name: "Discard form",
    exact: true,
  });
  if (await discardInterface.count()) await discardInterface.click();
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  console.log("Blocks selected");
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  await blocks
    .getByRole("button", { name: "Add to this design", exact: true })
    .click();
  console.log("Declaration opened");
  const declaration = page.getByRole("dialog", {
    name: "Add to this design",
    exact: true,
  });
  await declaration.getByRole("button", { name: /External operation/ }).click();
  await declaration.getByLabel("Component name", { exact: true }).fill("send");

  await verify(
    declaration,
    "Preview declaration",
    "declaration",
    "preview",
    "New declaration preview",
    "Space",
  );
  await page
    .getByRole("button", { name: "Discard declaration form", exact: true })
    .click();
  const operation = blocks
    .locator(".visual-definition")
    .filter({ hasText: "reserve" })
    .first();
  await operation.locator("summary").first().click();
  await operation
    .getByRole("button", { name: "Edit operation rules and work", exact: true })
    .click();
  await verify(
    page.getByRole("dialog", { name: "Edit operation contract", exact: true }),
    "Preview operation changes",
    "interface",
    "preview-operation",
    "Operation edit preview",
    "Enter",
  );
  const discardOperation = page.getByRole("button", {
    name: "Discard operation form",
    exact: true,
  });
  if (await discardOperation.count()) await discardOperation.click();
  const type = blocks
    .locator(".visual-definition")
    .filter({ hasText: "Request" })
    .first();
  await type.locator("summary").first().click();
  await type
    .getByRole("button", {
      name: "Add or remove fields and outcomes",
      exact: true,
    })
    .click();
  await verify(
    page.getByRole("dialog", { name: "Edit Request data shape", exact: true }),
    "Preview data-shape changes",
    "interface",
    "preview-type",
    "Data-shape changes",
    "Space",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
