// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { setupProject } from "../dist/project/setup.js";
import { startStudio } from "../dist/studio/server.js";
const root = await mkdtemp(join(tmpdir(), "pym-source-profile-ui-")),
  expect = baseExpect.configure({ timeout: 0 });
let app, browser;
try {
  await mkdir(join(root, "docs"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "README.md"), "# Project");
  await writeFile(join(root, ".hidden.md"), "# Hidden root note");
  await writeFile(join(root, "docs", ".private.md"), "# Hidden nested note");
  await writeFile(join(root, "docs", "design.md"), "# Plan");
  await writeFile(join(root, "package.json"), '{"private":true}');
  await writeFile(join(root, "src", "code.pym"), "flow main() -> Unit {}");
  const initial = await setupProject(
    root,
    "Same source",
    true,
    new AbortController().signal,
  );
  app = await startStudio({ path: root });
  const retained = await app.service.architectureOverview();
  assert.ok(
    !retained.index.documents.some(
      (d) => d.path === ".hidden.md" || d.path === "docs/.private.md",
    ),
  );
  const overview = await app.service.architectureOverview();
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page
    .getByRole("button", { name: "Import documents", exact: true })
    .click();
  await page.getByLabel("Import action").selectOption(overview.sources[0].id);
  await page.getByLabel("Choose a folder", { exact: true }).check();
  await page
    .getByLabel("Architecture folder", { exact: true })
    .setInputFiles(root);
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/architecture/import-preview"),
  );
  await page
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  const received = await response;
  const preview = await received.json();
  if (preview.summary.changed.length) {
    const incoming = JSON.parse(received.request().postData());
    const path = preview.summary.changed[0];
    console.log(
      "Inventory before:",
      (
        await app.service.architectureDocument(
          initial.documentation.revision,
          path,
        )
      ).text,
    );
    console.log(
      "Inventory incoming:",
      incoming.documents.find((d) => d.path === path)?.text,
    );
  }
  assert.deepEqual(preview.conflicts, [], JSON.stringify(preview));
  assert.deepEqual(preview.summary.changed, [], JSON.stringify(preview));
  assert.deepEqual(preview.summary.added, [], JSON.stringify(preview));
  assert.deepEqual(preview.summary.removed, [], JSON.stringify(preview));
  await page
    .getByRole("button", { name: "Save reviewed import", exact: true })
    .click();
  await expect(
    page.getByText("Architecture updated.", { exact: false }),
  ).toBeVisible();
  assert.equal(
    (await app.service.architectureOverview()).activeRevision,
    initial.documentation.revision,
  );
  console.log(
    "Studio folder refresh respects the init selection, preserves CLI source location and creates no unnecessary checkpoint.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
