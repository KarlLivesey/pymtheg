import { browserExecutable, browserLaunchOptions } from "./browser-launch.mjs";
import {
  chromium,
  firefox,
  webkit,
  expect as baseExpect,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const engines = { chromium, firefox, webkit },
  name = process.env.PYM_BROWSER_ENGINE ?? "chromium";
assert.ok(
  Object.hasOwn(engines, name),
  "Set PYM_BROWSER_ENGINE=chromium, firefox or webkit",
);
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-cross-browser-"));
let app, browser;
try {
  const file = join(root, "design.pym");
  await writeFile(
    file,
    "op lookup(id: Nat) -> Unit; flow main() -> Unit { call lookup(true); }",
  );
  app = await startStudio({ path: file });
  browser = await engines[name].launch({
    ...browserLaunchOptions(name),
    ...(process.env.PYM_BROWSER_EXECUTABLE
      ? { executablePath: process.env.PYM_BROWSER_EXECUTABLE }
      : {}),
  });
  console.log(
    JSON.stringify({
      engine: name,
      version: browser.version(),
      stage: "launched",
    }),
  );
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(app.url);
  await page.getByLabel("Check as I edit").uncheck();
  await expect(page.getByText("T002", { exact: true })).toBeVisible();
  await page.getByText("T002", { exact: true }).click();
  await expect(page.locator(".source-finding")).toHaveText("true");
  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "op lookup(id: Nat) -> Unit; flow main() -> Unit { call lookup(1); }",
  );
  await page.getByRole("button", { name: /Check design/ }).click();
  await expect(page.getByText("T002", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue("main");
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page
    .getByRole("button", { name: "Add planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  await form.getByLabel("Short title").fill("Keep one customer record");
  await form
    .getByLabel("How will we know it is done?")
    .fill("A repeated import keeps one record.");
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.failureSummary),
    })),
    [],
  );
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  await expect(form.getByLabel("Short title")).toHaveValue(
    "Keep one customer record",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Planning form must not overflow narrow viewport",
  );
  const layout = await page.evaluate(() => {
    const header = document.querySelector(".topbar").getBoundingClientRect();
    const main = document.querySelector("main").getBoundingClientRect();
    return {
      headerBottom: header.bottom,
      mainTop: main.top,
      controls: [
        ...document.querySelectorAll(".topbar button, .topbar .brand"),
      ].map((element) => element.getBoundingClientRect().bottom),
    };
  });
  assert.ok(
    layout.controls.every((bottom) => bottom <= layout.headerBottom + 1),
    JSON.stringify(layout),
  );
  assert.ok(layout.mainTop >= layout.headerBottom - 1, JSON.stringify(layout));
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/cross-browser-" + name + ".png",
    ),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      engine: name,
      version: browser.version(),
      journey:
        "real finding, edit/recheck, entry selection, native planning save/edit, narrow layout and axe",
      result: "passed",
    }),
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
