// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 });
let browser;
try {
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  for (const mode of [
    "edit-after-save",
    "edit-before-save",
    "operation-form",
    "typing-during-save",
  ]) {
    const root = await mkdtemp(join(tmpdir(), "pym-two-tabs-"));
    const source =
      "op reserve(n: Nat) -> Nat requires n >= 0 cost calls exact n + 1 atomic;\nflow caller(k: Nat) -> Unit { call reserve(k) as value; return unit; }\n";
    let app, context;
    try {
      await writeFile(join(root, "main.pym"), source);
      app = await startStudio({ path: root });
      context = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
      });
      const A = await context.newPage(),
        B = await context.newPage();
      for (const page of [A, B]) {
        page.setDefaultTimeout(0);
        page.on("pageerror", (e) => console.error("pageerror", String(e)));
        const connected = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/events" && r.status() === 200,
        );
        await page.goto(app.url);
        await connected;
        await expect(page.locator(".statusbar")).toContainText("completed");
      }
      console.log(mode + ": both pages ready");
      async function replace(page, text) {
        await page.locator(".cm-content").press("ControlOrMeta+a");
        await page.keyboard.insertText(text);
      }
      async function save(page) {
        const response = page.waitForResponse((r) =>
          r.url().endsWith("/api/save"),
        );
        await page.getByRole("button", { name: "Save", exact: true }).click();
        return response;
      }
      async function operation(page) {
        await page.getByRole("button", { name: "Blocks", exact: true }).click();
        const blocks = page.getByLabel("Visual block editor", { exact: true });
        await expect(blocks.getByRole("status")).toContainText("Blocks match");
        await blocks
          .locator(".visual-definition")
          .filter({ hasText: "reserve" })
          .locator("summary")
          .first()
          .click();
        await blocks
          .getByRole("button", {
            name: "Edit operation rules and work",
            exact: true,
          })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "Edit operation contract",
          exact: true,
        });
        await expect(
          dialog.getByLabel("Work 1 count", { exact: true }),
        ).toHaveValue("n + 1");
        return dialog;
      }
      if (mode === "typing-during-save") {
        const firstText = source + "// first edit\n";
        const newerText = firstText + "// typed during save\n";
        await replace(A, firstText);
        let release, written;
        const releaseResponse = new Promise((resolve) => {
          release = resolve;
        });
        const serverWrote = new Promise((resolve) => {
          written = resolve;
        });
        await A.route("**/api/save", async (route) => {
          const response = await route.fetch();
          written();
          await releaseResponse;
          await route.fulfill({ response });
        });
        const firstResponse = A.waitForResponse((r) =>
          r.url().endsWith("/api/save"),
        );
        await A.getByRole("button", { name: "Save", exact: true }).click();
        await serverWrote;
        assert.equal(await readFile(join(root, "main.pym"), "utf8"), firstText);
        await replace(A, newerText);
        release();
        assert.equal((await firstResponse).status(), 200);
        await A.unroute("**/api/save");
        await expect(A.locator(".cm-content")).toContainText(
          "typed during save",
        );
        assert.equal((await save(A)).status(), 200);
        console.log(mode + ": A saved");
        assert.equal(await readFile(join(root, "main.pym"), "utf8"), newerText);
        console.log(
          "typing-during-save: owned acknowledgement advances base without losing newer typing",
        );
        continue;
      }
      let form;
      if (mode === "operation-form") form = await operation(B);
      if (mode === "edit-before-save")
        await replace(B, source + "// B pending\n");
      const aText =
        mode === "operation-form"
          ? source.replace("n + 1", "n + 5")
          : source + "// A saved\n";
      await replace(A, aText);
      assert.equal((await save(A)).status(), 200);
      console.log(mode + ": A saved");
      assert.equal(await readFile(join(root, "main.pym"), "utf8"), aText);
      if (mode === "edit-after-save") {
        // A rendered enabled Save on untouched B proves its file event was applied.
        await expect(
          B.getByRole("button", { name: "Save", exact: true }),
        ).toBeEnabled();
        await replace(B, source + "// B pending\n");
      } else {
        await expect(
          B.getByText(
            "main.pym changed in another window. Your buffer was kept; reload or compare before saving.",
            { exact: true },
          ),
        ).toBeVisible();
      }
      if (form) {
        await form.getByLabel("Work 1 count", { exact: true }).fill("n + 9");
        await form
          .getByRole("button", {
            name: "Preview operation changes",
            exact: true,
          })
          .click();
        await form
          .getByRole("button", {
            name: "Apply operation changes and check",
            exact: true,
          })
          .click();
        await expect(form).toHaveCount(0);
      }
      console.log(mode + ": B prepared; expecting save conflict");
      const refused = await save(B);
      console.log(mode + ": B save returned " + refused.status());
      assert.equal(
        refused.status(),
        409,
        mode + ": stale save must be refused",
      );
      assert.equal(await readFile(join(root, "main.pym"), "utf8"), aText);
      const conflict = B.getByRole("dialog", {
        name: "This file changed on disk",
        exact: true,
      });
      await expect(conflict).toBeVisible();
      await conflict
        .getByText("Compare unsaved editor version", { exact: true })
        .click();
      await expect(conflict).toContainText(
        mode === "operation-form" ? "n + 9" : "B pending",
      );
      await conflict
        .getByRole("button", { name: "Keep my buffer", exact: true })
        .click();
      assert.equal(await readFile(join(root, "main.pym"), "utf8"), aText);
      console.log(
        mode +
          ": latest save preserved, stale buffer retained, 409 and explicit comparison shown",
      );
    } finally {
      await Promise.allSettled([context?.close(), app?.close()]);
      await rm(root, { recursive: true, force: true });
    }
  }
} finally {
  await browser?.close().catch(() => {});
}
