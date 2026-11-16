// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-v3-ui-"));
let app, browser, store;
try {
  for (const name of ["source", "target"]) await mkdir(join(root, name));
  store = await ArchitectureStore.open(join(root, "source"));
  const original =
    "## NFR-7 Règles\nRetain café, Welsh and emoji 🌍 exactly.\n";
  const saved = store.save("Original architecture", "test", [
    { path: "règles.md", text: original },
    { path: "z.md", text: "Second document" },
  ]);
  const bundle = store.export(saved.id);
  assert.equal(bundle.schema, "pymtheg.architecture-bundle/v3");
  store.close();
  store = null;
  app = await startStudio({ path: join(root, "target") });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  const openImport = async (value) => {
    await page
      .getByRole("button", { name: "Import documents", exact: true })
      .click();
    await page.getByLabel("Architecture files", { exact: true }).setInputFiles({
      name: "bundle.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(value)),
    });
    await page
      .getByRole("button", { name: "Preview import", exact: true })
      .click();
  };
  await openImport(bundle);
  await expect(
    page.getByRole("button", { name: "Save reviewed import", exact: true }),
  ).toBeVisible();
  assert.equal((await app.service.architectureOverview()).index, null);
  await page
    .getByRole("button", { name: "Save reviewed import", exact: true })
    .click();
  await expect(page.getByLabel("Stored revision")).toBeVisible();
  const current = (await app.service.architectureOverview()).index;
  assert.equal(
    (await app.service.architectureDocument(current.id, "règles.md")).text,
    original,
  );
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export this revision", exact: true })
    .click();
  const download = await downloading;
  const output = join(root, "download.json");
  await download.saveAs(output);
  const exported = JSON.parse(await readFile(output, "utf8"));
  assert.equal(exported.schema, "pymtheg.architecture-bundle/v3");
  assert.match(exported.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(
    exported.documents.find((d) => d.path === "règles.md").text,
    original,
  );
  const broken = structuredClone(exported);
  broken.documents.find((d) => d.path === "règles.md").text =
    "changed without updating the checksum";
  await openImport(broken);
  await expect(page.getByRole("alert")).toContainText("recorded checksum");
  assert.equal(
    (await app.service.architectureOverview()).activeRevision,
    current.id,
  );
  assert.equal(
    (await app.service.architectureDocument(current.id, "règles.md")).text,
    original,
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/post-sixth/v3-bundle.png"),
    fullPage: true,
  });
  console.log(
    "v3 bundle GUI imports and exports non-ASCII paths/text exactly; mismatched content is refused without changing the current architecture.",
  );
} finally {
  store?.close();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
