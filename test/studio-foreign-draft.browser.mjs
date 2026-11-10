import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-foreign-draft-ui-"));
let a, b, app, browser;
try {
  for (const path of ["local", "remote"]) await mkdir(join(root, path));
  a = await ArchitectureStore.open(join(root, "local"));
  b = await ArchitectureStore.open(join(root, "remote"));
  const current = a.save("Local design", "This machine", [
    { path: "local.md", text: "Keep local decisions." },
  ]);
  const origin = b.save("Remote review", "Other machine", [
    { path: "remote.md", text: "Original remote text." },
  ]);
  b.saveDraft(0, {
    kind: "document",
    baseRevision: origin.id,
    label: "Finish remote decision",
    document: { path: "remote.md", text: "Unfinished remote decision." },
  });
  a.importHistory(b.exportHistory());
  a.close();
  a = null;
  b.close();
  b = null;
  app = await startStudio({ path: join(root, "local") });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator("body")).toContainText(
    "Started from Remote review · Other machine",
  );
  await page
    .getByRole("button", { name: "Restore as new document", exact: true })
    .click();
  await expect(page.getByLabel("Document path", { exact: true })).toHaveValue(
    "remote-recovered.md",
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/foreign-draft-probe.png"),
    fullPage: true,
  });
  await expect(
    page.getByLabel("Decision or document text", { exact: true }),
  ).toHaveValue("Unfinished remote decision.");
  await page
    .getByRole("button", {
      name: "Save new architecture revision",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Document path", { exact: true })).toHaveCount(
    0,
  );
  const overview = await app.service.architectureOverview();
  assert.notEqual(overview.index.id, current.id);
  assert.equal(
    (await app.service.architectureDocument(overview.index.id, "local.md"))
      .text,
    "Keep local decisions.",
  );
  assert.equal(
    (
      await app.service.architectureDocument(
        overview.index.id,
        "remote-recovered.md",
      )
    ).text,
    "Unfinished remote decision.",
  );
  console.log(
    "Foreign draft shows its origin and saves explicitly as a new current document while preserving local work.",
  );
} finally {
  a?.close();
  b?.close();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
