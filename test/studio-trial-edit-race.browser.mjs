import { browserExecutable, browserType } from "./browser-launch.mjs";
// Copy to test/ before running through pc-tools headless. No sleeps or timing assertions.
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-trial-edit-race-"));
const responseReady = Promise.withResolvers();
const release = Promise.withResolvers();
const responseSettled = Promise.withResolvers();
let app,
  browser,
  intercepted = false;
try {
  await writeFile(
    join(root, "main.pym"),
    "flow eligible(age: Nat) -> Bool { return age >= 18; }",
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
  await page.route("**/api/try-inputs", async (route) => {
    if (intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
    try {
      const response = await route.fetch();
      const body = await response.json();
      assert.equal(
        body.output,
        false,
        "The held response must be the old age=17 result",
      );
      responseReady.resolve();
      await release.promise;
      await route.fulfill({ response });
    } catch (error) {
      // Aborting the old browser request may reject its eventual delivery.
      if (!/cancel|abort|closed/i.test(String(error))) {
        responseReady.reject(error);
        throw error;
      }
    } finally {
      responseSettled.resolve();
    }
  });
  await page.goto(app.url);
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue(
    "eligible",
  );
  await page.getByRole("button", { name: "Try inputs", exact: true }).click();
  const panel = page.getByRole("region", { name: "Try inputs", exact: true });
  const input = panel.getByLabel("Try input age", { exact: true });
  const run = panel.getByRole("button", {
    name: "Run these inputs",
    exact: true,
  });
  await input.fill("17");
  await run.click();
  await responseReady.promise;
  await input.fill("18");
  await expect(input).toHaveValue("18");
  assert.equal(
    await run.isEnabled(),
    true,
    "Editing inputs must retire the old request immediately",
  );
  await expect(
    panel.getByRole("button", { name: "Cancel example", exact: true }),
  ).toHaveCount(0);
  release.resolve();
  await responseSettled.promise;
  await expect(panel.locator(".trial-result")).toHaveCount(0);
  await run.click();
  await expect(panel.locator(".trial-result")).toContainText("true");
  console.log(
    "Editing inputs retires the held old result; the new input runs independently and returns true.",
  );
} finally {
  release.resolve();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
