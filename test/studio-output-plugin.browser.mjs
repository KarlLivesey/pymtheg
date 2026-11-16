// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
// Run entirely through pc-tools headless.
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { OutputRegistry } from "../dist/contracts/registry.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-output-plugin-ui-"));
let app, browser;
try {
  await writeFile(
    join(root, "main.pym"),
    "flow main() -> Bool { return true; }",
  );
  const registry = await OutputRegistry.load([
    "javascript=" + resolve("examples/plugins/javascript.mjs"),
  ]);
  app = await startStudio({
    path: join(root, "main.pym"),
    outputRegistry: registry,
  });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByLabel("Scaffold language").selectOption("javascript");
  await page
    .getByRole("button", { name: "Preview types and signatures", exact: true })
    .click();
  await expect(page.locator(".scaffold-preview")).toContainText(
    'throw new Error("Not implemented")',
  );
  await page.getByLabel("Scaffold function bodies").selectOption("empty");
  await page
    .getByRole("button", { name: "Preview types and signatures", exact: true })
    .click();
  await expect(page.locator(".scaffold-preview")).toContainText(
    "Implementation intentionally left empty",
  );
  const project = await app.service.project();
  assert.ok(project.agentConnection.args.includes("--plugin"));
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/post-eighth/studio-registered-plugin.png",
    ),
    fullPage: true,
  });
  console.log(
    "Studio exposes the explicitly registered plugin; previews honor fail-fast and empty modes; agent setup preserves the registration.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
