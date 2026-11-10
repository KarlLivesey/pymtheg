import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-completion-ui-"));
let app, browser, page;
try {
  await writeFile(
    join(root, "main.pym"),
    "type Errors = Unavailable;\nop reserve(sku: String) -> Result<Unit, Errors> effects(remote.Store);\nflow main() -> Unit effects(remote.Store) {\n\n}\n",
  );
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".cm-content")).toContainText("op reserve");
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByLabel("Check as I edit").uncheck();
  const started = page.waitForResponse(
    (r) => r.url().endsWith("/api/run") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Check design/ }).click();
  const run = await (await started).json();
  await expect(page.locator(".statusbar")).toHaveAttribute(
    "data-run-id",
    run.id,
  );
  await expect(page.locator(".statusbar")).toContainText("completed");
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue("main");
  console.log("Initial check ready");
  await page.locator(".cm-content").press("ControlOrMeta+End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await page.keyboard.insertText("call res");
  await page.keyboard.press("Control+Space");
  console.log("Completion requested");
  await page.getByRole("option", { name: /reserve/ }).click();
  console.log("Completion applied");
  await expect(page.locator(".cm-content")).toContainText(
    'call reserve(unknown "Value for sku") as result;',
  );
  await expect(page.locator(".cm-content")).toContainText("Unavailable =>");
  await expect(page.locator(".cm-content")).not.toContainText("call call");
  await page.getByRole("button", { name: /Check design/ }).click();
  await expect(page.getByText("U001", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("P002", { exact: true })).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("Handle Unavailable");
  console.log(
    "Contextual completion: typed call prefix, explicit unknown argument, full result handlers and parseable insertion.",
  );
} catch (error) {
  console.error(
    "Completion failure state",
    await page
      ?.evaluate(() => ({
        text: document.querySelector(".cm-content")?.textContent,
        selection: window.getSelection()?.anchorOffset,
        focused: document.activeElement?.className,
        options: [...document.querySelectorAll('[role="option"]')].map(
          (n) => n.textContent,
        ),
        alerts: [...document.querySelectorAll('[role="alert"]')].map(
          (n) => n.textContent,
        ),
      }))
      .catch(() => null),
  );
  throw error;
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
