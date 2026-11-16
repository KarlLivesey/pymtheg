// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
// Run only after the independent review releases the shared browser resource.
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStudio } from "../dist/studio/server.js";
const root = await mkdtemp(join(tmpdir(), "pym-doc-reader-ui-"));
const expect = baseExpect.configure({ timeout: 0 });
let app, browser;
try {
  app = await startStudio({ path: root });
  const text =
    "# Storage design\n\nWrites stay **durable**.\n\n| Operation | Result |\n| --- | --- |\n| Save | Receipt |\n\n## Inputs\n- Order\n- Idempotency key\n\n[Read the retry contract](retry.md#unknown-outcome)\n\n![Image](https://tracker.invalid/tracker.png)\n<script>globalThis.readerInjected=true</script>\n";
  await app.service.importArchitecture(
    "Readable design",
    [
      { path: "docs/plan.md", text },
      {
        path: "docs/retry.md",
        text: "# Retry\n\n## Unknown outcome\nReconcile before retry.\n",
      },
    ],
    new AbortController().signal,
  );
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  const remote = [];
  page.on("request", (request) => {
    if (request.url().includes("tracker.invalid")) remote.push(request.url());
  });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Documents and decisions", exact: true })
    .click();
  await page.getByRole("button", { name: /docs\/plan.md/ }).click();
  const reader = page.getByRole("region", {
    name: "Retained document",
    exact: true,
  });
  await expect(
    reader.getByRole("heading", { name: "Storage design", exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByRole("cell", { name: "Receipt", exact: true }),
  ).toBeVisible();
  assert.equal(await page.evaluate(() => globalThis.readerInjected), undefined);
  assert.deepEqual(remote, []);
  const download = page.waitForEvent("download");
  await reader
    .getByRole("button", { name: "Download original", exact: true })
    .click();
  assert.equal(await readFile(await (await download).path(), "utf8"), text);
  await reader
    .getByRole("button", { name: "Exact source", exact: true })
    .click();
  assert.equal(
    await reader.locator(".architecture-document").textContent(),
    text,
  );
  await reader
    .getByRole("button", { name: "Read document", exact: true })
    .click();
  await reader
    .getByRole("link", { name: "Read the retry contract", exact: true })
    .click();
  await expect(
    reader.getByRole("heading", { name: "Unknown outcome", exact: true }),
  ).toBeFocused();
  await expect(reader).toContainText("Reconcile before retry.");
  const audit = await new AxeBuilder({ page })
    .include(".document-reader")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    audit.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.failureSummary),
    })),
    [],
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/document-reader.png"),
    fullPage: true,
  });
  console.log(
    "Readable Markdown tables and links, exact source/download, inactive HTML/images and keyboard section navigation passed.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
