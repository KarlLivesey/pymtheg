// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const root = await mkdtemp(join(tmpdir(), "pym-selection-cache-ui-")),
  expect = baseExpect.configure({ timeout: 0 });
let app, browser;
try {
  const file = join(root, "source.pym");
  const source =
    "flow charge() -> Bool { return true; }\nflow unrelated() -> Nat { return 0; }";
  await writeFile(file, source);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page
    .getByRole("button", { name: "Add planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  await form.getByLabel("Short title").fill("Keep my selected component");
  await form.getByRole("button", { name: "Link charge", exact: true }).click();
  await expect(
    form
      .getByRole("region", {
        name: "Source link source:source.pym#charge",
        exact: true,
      })
      .locator("pre")
      .first(),
  ).toContainText("flow charge");
  for (let i = 1; i <= 4; i++) {
    await writeFile(file, source.replace("return 0", "return " + i));
    await app.service.sourceContractPage({}, new AbortController().signal);
  }
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit planning record", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/source-selection-survives-cache.png",
    ),
    fullPage: true,
  });
  console.log(
    "A source selection survives four unrelated captures and saves without a review acknowledgement or false source-change conflict.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
