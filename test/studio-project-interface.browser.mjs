// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-caller-ui-"));
let app, browser;
try {
  const source = "flow quote(quantity: Nat) -> Bool { return quantity > 0; }";
  await writeFile(join(root, "main.pym"), source);
  await writeFile(
    join(root, "caller.pym"),
    'import "main.pym"; flow checkout() -> Bool { call quote(1) as answer; return answer; }',
  );
  app = await startStudio({ path: join(root, "main.pym") });
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
    .getByRole("button", { name: "Edit inputs and output", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Inputs and output for quote",
  });
  await dialog.getByLabel("Component name", { exact: true }).fill("price");
  await dialog
    .getByRole("button", { name: "Preview interface changes", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Interface changes" }),
  ).toContainText("checkout");
  await dialog
    .getByRole("button", { name: "Apply to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => {
      const runs = (await app.service.project()).runs;
      return runs.some(
        (r) =>
          r.status === "completed" &&
          r.report?.snapshot.files.some((f) => f.text.includes("flow price")) &&
          r.report.consumers?.diagnostics.some((d) =>
            d.span.file.endsWith("/caller.pym"),
          ),
      );
    })
    .toBe(true);
  await page.getByText(/Related-file findings:/).click();
  await expect(
    page.locator(".finding-card").filter({ hasText: "quote" }).first(),
  ).toBeVisible();
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/post-eighth/project-caller.png",
    ),
    fullPage: true,
  });
  console.log(
    "Interface preview identifies external checkout; applying the rename displays caller errors while preserving disk source.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
