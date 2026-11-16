// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-completion-ui-"));
let app, browser;
try {
  await writeFile(
    join(root, "main.pym"),
    "op fetch(x: Nat) -> Nat;\nflow f(a: Nat, b: Nat) -> Unit {\n  let n = 0;\n}\nflow g(a: Nat) -> Unit {\n  let n = 1;\n}\n",
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
  await page
    .getByRole("button", { name: /Check design/ })
    .first()
    .click();
  await expect
    .poll(() =>
      app.service
        .project()
        .then((p) => p.runs.some((r) => r.status === "completed")),
    )
    .toBe(true);
  await page.getByLabel("Check as I edit").uncheck();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText(
    "// ordinary typing shifts the cursor beyond the old end of f",
  );
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("call fet");
  await page.keyboard.press("Control+Space");
  await page.getByRole("option", { name: /fetch/ }).first().click();
  await expect(editor).toContainText(
    'call fetch(unknown "Value for x") as result;',
  );
  console.log(
    "Live completion stays in f after body insertion and preserves ambiguous input as a hole.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
