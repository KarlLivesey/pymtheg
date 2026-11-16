// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { waitForRecovery } from "./recovery-ack.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-save-basics-"));
let app, browser;
try {
  await writeFile(join(root, "main.pym"), "flow calc() -> Nat { return 1; }\n");
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  ).newPage();
  page.setDefaultTimeout(0);
  if (process.env.PYM_DEBUG_SAVE) {
    page.on("response", async (response) => {
      if (/\/api\/(blocks|run)$/.test(new URL(response.url()).pathname))
        console.log(
          "response",
          response.url(),
          response.status(),
          (await response.text()).slice(0, 2500),
        );
    });
    page.on("pageerror", (error) => console.log("pageerror", String(error)));
  }
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  await blocks.getByLabel("Result", { exact: true }).fill("2");
  const save = page.waitForResponse((r) => r.url().endsWith("/api/save"));
  await page.keyboard.press("ControlOrMeta+s");
  assert.equal((await save).status(), 200);
  assert.match(await readFile(join(root, "main.pym"), "utf8"), /return 2;/);
  await expect(page.locator(".statusbar")).toContainText("No unsaved draft");
  await waitForRecovery(app, (r) => r?.drafts?.length, 0);
  await blocks.getByLabel("Result", { exact: true }).fill("3");
  await page
    .getByRole("button", { name: "Revert to saved…", exact: true })
    .click();
  const revert = page.getByRole("dialog", {
    name: "Discard unsaved changes?",
    exact: true,
  });
  await expect(revert).toBeVisible();
  await revert
    .getByText("Compare unsaved editor version", { exact: true })
    .click();
  if (process.env.PYM_DEBUG_SAVE)
    console.log(
      "revert applied",
      await page.locator(".cm-content").textContent(),
      await blocks.textContent(),
    );
  await expect(revert).toContainText("return 3;");
  await revert
    .getByRole("button", { name: "Keep my buffer", exact: true })
    .click();
  await expect(blocks.getByLabel("Result", { exact: true })).toHaveValue("3");
  await page
    .getByRole("button", { name: "Revert to saved…", exact: true })
    .click();
  await revert
    .getByRole("button", {
      name: "Discard edits and use saved version",
      exact: true,
    })
    .click();
  await expect(blocks.getByLabel("Result", { exact: true })).toHaveValue("2");
  await expect(page.locator(".statusbar")).toContainText("No unsaved draft");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest(
            '[aria-label="Visual block editor"]',
          ),
      ),
    )
    .toBe(true);
  assert.match(await readFile(join(root, "main.pym"), "utf8"), /return 2;/);
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const editor = page.locator(".cm-content");
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText("flow calc() -> Nat { return 7; }\n");
  await page
    .getByRole("button", { name: "Revert to saved…", exact: true })
    .click();
  await revert
    .getByRole("button", {
      name: "Discard edits and use saved version",
      exact: true,
    })
    .click();
  await expect(editor).toContainText("return 2;");
  await expect(editor).toBeFocused();
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  await blocks
    .getByRole("button", { name: "Add to this design", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Add to this design",
    exact: true,
  });
  await dialog.getByRole("button", { name: /^Component/ }).click();
  await dialog
    .getByLabel("Component name", { exact: true })
    .fill("draftWorker");
  await expect(page.locator("main.main-workspace")).toHaveAttribute(
    "inert",
    "",
  );
  await page.evaluate(() => {
    const original = window.fetch;
    window.__modalSaveRequests = 0;
    window.fetch = (...args) => {
      if (String(args[0]).endsWith("/api/save")) window.__modalSaveRequests++;
      return original(...args);
    };
  });
  await page.keyboard.press("ControlOrMeta+s");
  assert.equal(await page.evaluate(() => window.__modalSaveRequests), 0);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(/Resumed your unfinished declaration/),
  ).toHaveCount(0);
  await waitForRecovery(
    app,
    (r) => r?.context?.declarationDraft?.declaration?.signature?.name,
    "draftWorker",
  );
  await dialog
    .getByRole("button", { name: "Close and keep form", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  const banner = page.getByRole("region", {
    name: "Unfinished new declaration",
    exact: true,
  });
  await expect(banner).toBeVisible();
  const discard = banner.getByRole("button", {
    name: "Discard declaration form",
    exact: true,
  });
  const box = await discard.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/save-basics-narrow.png"),
    fullPage: true,
  });
  await banner
    .getByRole("button", { name: "Resume declaration form", exact: true })
    .click();
  await expect(
    dialog.getByText(/Resumed your unfinished declaration/),
  ).toBeVisible();
  console.log(
    "PASS: Blocks shortcut saves current source but never through a declaration modal; clean status matches recovery, new/resumed forms are distinguished, and narrow discard remains reachable.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
