// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-shape-limit-ui-"));
let app, browser;
try {
  const types = Array.from(
    { length: 8 },
    (_, i) =>
      `type T${i} = {${Array.from({ length: 8 }, (_, f) => `f${f}: ${i ? "T" + (i - 1) : "Nat"}`).join(",")}};`,
  ).join("\n");
  await writeFile(
    join(root, "main.pym"),
    types +
      "\nflow large(value: T7) -> Bool {return true;}\nflow small() -> Bool {return true;}",
  );
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
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue("large");
  await page.getByRole("button", { name: "Try inputs", exact: true }).click();
  const panel = page.getByRole("region", { name: "Try inputs", exact: true });
  await expect(panel.getByRole("alert")).toContainText(
    "Guided input size limit",
  );
  await expect(panel).toContainText("You can still check this source");
  await expect(
    panel.getByRole("button", { name: "Run these inputs", exact: true }),
  ).toBeDisabled();
  const run = (await app.service.project()).runs.find(
    (r) => r.status === "completed",
  );
  assert.ok(run);
  assert.equal(
    run.report.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
  await page.getByLabel("Behaviour entry point").selectOption("small");
  await expect(
    panel.getByRole("button", { name: "Run these inputs", exact: true }),
  ).toBeEnabled();
  await panel
    .getByRole("button", { name: "Run these inputs", exact: true })
    .click();
  await expect(panel.locator(".trial-result")).toContainText("true");
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/post-sixth/guided-shape-limit.png",
    ),
    fullPage: true,
  });
  console.log(
    "Large type keeps valid source findings, explains unavailable inputs, and allows an independent small entry to return true.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
