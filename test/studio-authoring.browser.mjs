import assert from "node:assert/strict";
import { browserExecutable, browserType } from "./browser-launch.mjs";
// Entire controller must run through pc-tools headless.
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Wait for observed UI state; the outer helper owns the resource budget.
const expect = baseExpect.configure({ timeout: 0 });
const dir = await mkdtemp(join(tmpdir(), "pym-authoring-"));
let browser, app;
try {
  await writeFile(
    join(dir, "main.pym"),
    'import "lib.pym";\nflow main() -> Bool { return score(true); }\n',
  );
  await writeFile(
    join(dir, "lib.pym"),
    "rule score(flag: Bool) -> Bool = flag;\n",
  );
  app = await startStudio({ path: join(dir, "main.pym") });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  async function selectFile(name) {
    const submitted = page.waitForResponse(
      (r) => r.url().endsWith("/api/run") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: new RegExp(name.replaceAll(".", "\\.")) })
      .click();
    const response = await submitted;
    assert.equal(response.status(), 202);
    const requested = await response.json();
    await expect(page.locator(".statusbar")).toHaveAttribute(
      "data-run-id",
      requested.id,
    );
    await expect(page.locator(".statusbar")).toContainText("completed");
  }
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  await expect(page.locator(".current-file")).toContainText("main.pym");
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  for (let n = 0; n < 30; n++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("F12");
  await expect(page.locator(".current-file")).toContainText("lib.pym");
  await page.getByRole("button", { name: "References", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("References to score");
  await page.locator(".reference-row").click();
  await expect(page.locator(".current-file")).toContainText("main.pym");
  await page.locator(".cm-content").press("ControlOrMeta+End");
  await page.keyboard.insertText("// temporary edit\n");
  await selectFile("lib.pym");
  await expect(page.locator(".statusbar")).toContainText("completed");
  await selectFile("main.pym");
  await expect(page.locator(".cm-content")).toContainText("temporary edit");
  await page.locator(".cm-content").press("ControlOrMeta+z");
  await expect(page.locator(".cm-content")).not.toContainText("temporary edit");
  await expect(page.locator(".cm-content")).toContainText("score(true)");
  await page.locator(".cm-content").press("ControlOrMeta+End");
  await page.keyboard.insertText("// unsaved note\n");
  await writeFile(
    join(dir, "main.pym"),
    "flow externallyChanged() -> Unit {}\n",
  );
  await expect(page.locator(".cm-content")).toContainText("unsaved note");
  await expect(page.locator(".current-file")).toContainText("Unsaved");
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/save") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  assert.equal((await saved).status(), 409);
  await expect(page.getByRole("dialog")).toContainText(
    "This file changed on disk",
  );
  await page
    .getByRole("button", { name: "Keep my buffer", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("unsaved note");
  await page.getByRole("button", { name: "Reload disk", exact: true }).click();
  await page
    .getByRole("button", { name: "Use disk version", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("externallyChanged");
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("externallyChanged");
  await expect(page.locator(".current-file")).not.toContainText("Unsaved");
  console.log(
    "GUI authoring: initial-file selection, F12/reference navigation, conflict-safe saving/reloading, formatting passed.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(dir, { recursive: true, force: true });
}
