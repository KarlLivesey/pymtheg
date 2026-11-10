import { browserExecutable, browserType } from "./browser-launch.mjs";
// Run only via pc-tools headless, after the independent review releases browser use.
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { startStudio } from "../dist/studio/server.js";
const root = await mkdtemp(join(tmpdir(), "pym-legacy-review-ui-")),
  expect = baseExpect.configure({ timeout: 0 });
let local, peer, app, browser;
try {
  for (const folder of ["local", "peer"]) await mkdir(join(root, folder));
  local = await ArchitectureStore.open(join(root, "local"));
  peer = await ArchitectureStore.open(join(root, "peer"));
  local.save("Base", "test", [{ path: "decision.md", text: "base" }]);
  peer.importHistory(local.exportHistory());
  const current = local.save("Current design", "test", [
      { path: "decision.md", text: "keep local decision" },
    ]),
    other = peer.save("Other design", "test", [
      { path: "decision.md", text: "other decision" },
    ]);
  local.importHistory(peer.exportHistory());
  local.reviewBranch(other.id, current.id);
  local.close();
  local = null;
  peer.close();
  peer = null;
  const database = join(
    root,
    "local",
    ".pymtheg-architecture",
    "architecture.sqlite",
  );
  const legacy = new DatabaseSync(database);
  legacy.exec("DROP TABLE acknowledgement_records; PRAGMA user_version=6");
  legacy.close();
  const before = await readFile(database);
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
  await page.getByLabel("Stored revision").selectOption(other.id);
  await page
    .locator("summary")
    .filter({ hasText: "Review history for this branch" })
    .click();
  const review = page.getByRole("region", { name: "Review this branch" });
  await expect(review).toContainText("Reviewer not recorded");
  await expect(review).toContainText("Compared with Current design");
  await expect(
    review.getByRole("button", { name: "Withdraw this review", exact: true }),
  ).toBeVisible();
  assert.deepEqual(
    await readFile(database),
    before,
    "Viewing the legacy review must not migrate its database",
  );
  await page.getByLabel("Branch reviewer").fill("Karl");
  await page
    .getByLabel("Branch review notes")
    .fill("Reopen after contract change");
  await review
    .getByRole("button", { name: "Withdraw this review", exact: true })
    .click();
  await expect(review).toContainText("Reopen after contract change");
  await expect(
    page.getByRole("region", { name: "Branches needing review" }),
  ).toBeVisible();
  const archive = await app.service.exportArchitectureHistory();
  assert.equal(archive.active, current.id);
  assert.ok(
    archive.revisions
      .find((r) => r.id === other.id)
      .reviewRecords.some((r) => r.withdrawal?.reviewer === "Karl"),
  );
  console.log(
    "Legacy review is visible without writes; explicit withdrawal migrates the audit and preserves the current design.",
  );
} finally {
  await browser?.close();
  await app?.close();
  local?.close();
  peer?.close();
  await rm(root, { recursive: true, force: true });
}
