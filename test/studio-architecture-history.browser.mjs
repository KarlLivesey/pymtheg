import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-gui-history-"));
let app, browser, store;
try {
  const source = join(root, "source"),
    target = join(root, "target");
  await (await import("node:fs/promises")).mkdir(source);
  await (await import("node:fs/promises")).mkdir(target);
  store = await ArchitectureStore.open(source);
  const first = store.save("First architecture", "author", [
    {
      path: "règles.md",
      text: "## R03 Keep plans\nRetain prior decisions.",
    },
  ]);
  const second = store.save("Reviewed architecture", "author", [
    {
      path: "règles.md",
      text: "## R03 Keep plans\nRetain prior decisions.\nReview changes.",
    },
  ]);
  store.saveDraft(0, {
    kind: "plan",
    baseRevision: first.id,
    item: {
      ...newPlanItem("R4"),
      title: "Unfinished plan",
      owner: "architecture",
    },
  });
  const archive = store.exportHistory();
  assert.equal(archive.schema, "pymtheg.architecture-history/v3");
  store.close();
  store = null;
  app = await startStudio({ path: target });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1050 },
  });
  await page.goto(app.url);
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page
    .getByRole("button", { name: "Import documents", exact: true })
    .click();
  await page.getByLabel("Architecture files", { exact: true }).setInputFiles({
    name: "history.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(archive)),
  });
  await page
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "History import preview" }),
  ).toContainText("2 named revisions");
  assert.equal((await app.service.architectureOverview()).index, null);
  await page
    .getByRole("button", { name: "Import reviewed history", exact: true })
    .click();
  await expect(page.getByLabel("Stored revision")).toHaveValue(second.id);
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export all history", exact: true })
    .click();
  const download = await downloaded;
  const file = join(root, "download.json");
  await download.saveAs(file);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), archive);
  await expect(
    page.getByRole("button", {
      name: "Restore architecture draft",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Restore architecture draft", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Planning record" })
      .getByLabel("Short title"),
  ).toHaveValue("Unfinished plan");
  console.log(
    "Architecture history GUI: reviewed import preserves both named revisions and exact export; recovered unfinished plan remains available.",
  );
} finally {
  store?.close();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
