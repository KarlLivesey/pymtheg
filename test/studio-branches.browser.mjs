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
const root = await mkdtemp(join(tmpdir(), "pym-branches-ui-"));
let a, b, peer, app, browser;
try {
  for (const path of ["local", "remote", "peer"]) await mkdir(join(root, path));
  a = await ArchitectureStore.open(join(root, "local"));
  b = await ArchitectureStore.open(join(root, "remote"));
  a.save("Base design", "test", [
    { path: "decision.md", text: "## Storage\nChoose a journal." },
  ]);
  b.importHistory(a.exportHistory());
  const current = a.save("Local WAL decision", "test", [
    { path: "decision.md", text: "## Storage\nChoose WAL." },
  ]);
  const other = b.save("Remote journal decision", "test", [
    { path: "decision.md", text: "## Storage\nChoose journal." },
  ]);
  a.importHistory(b.exportHistory());
  assert.equal(a.read().id, current.id);
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
  const notice = page.getByRole("region", { name: "Branches needing review" });
  await expect(notice).toContainText("1 separate saved branch needs review");
  await page
    .getByRole("button", { name: "Needs attention", exact: true })
    .click();
  await expect(notice).toBeVisible();
  await notice
    .getByRole("button", {
      name: "Review Remote journal decision",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Stored revision")).toHaveValue(other.id);
  await expect(page.locator(".architecture-revision-context")).toContainText(
    "Separate saved branch",
  );
  await page.getByLabel("Branch reviewer").fill("Karl");
  await page
    .getByLabel("Branch review notes")
    .fill("Retain the local WAL requirement");
  const reviewedResponse = page.waitForResponse((r) =>
    r.url().endsWith("/api/architecture/review-branch"),
  );
  await page
    .getByRole("button", {
      name: "I reviewed this branch; keep the current design",
      exact: true,
    })
    .click();
  const response = await reviewedResponse;
  assert.equal(response.status(), 200, await response.text());
  await expect(notice).toHaveCount(0);
  await expect(page.locator(".architecture-revision-context")).toContainText(
    "reviewed; current design retained",
  );
  await app.close();
  app = await startStudio({ path: join(root, "local") });
  await page.goto(app.url);
  await expect(notice).toHaveCount(0);
  assert.equal(
    (await app.service.architectureOverview()).activeRevision,
    current.id,
  );
  const archive = await app.service.exportArchitectureHistory();
  assert.deepEqual(
    archive.revisions.find((r) => r.id === other.id).reviewedAgainst,
    [current.id],
  );
  peer = await ArchitectureStore.open(join(root, "peer"));
  peer.importHistory(archive);
  peer.withdrawBranchReview(
    archive.revisions.find((r) => r.id === other.id).reviewRecords[0].id,
    current.id,
    { reviewer: "Second reviewer", reason: "Independent availability concern" },
  );
  await page.getByLabel("Stored revision").selectOption(other.id);
  await page
    .locator("summary")
    .filter({ hasText: "Review history for this branch" })
    .click();
  const audit = page.getByRole("region", { name: "Review this branch" });
  await expect(audit).toContainText("Karl");
  await expect(audit).toContainText("Compared with Local WAL decision");
  await expect(audit).toContainText("Retain the local WAL requirement");
  await page
    .getByLabel("Branch review notes")
    .fill("Reassess provider assumptions");
  await audit
    .getByRole("button", { name: "Withdraw this review", exact: true })
    .click();
  await expect(notice).toBeVisible();
  await expect(audit).toContainText("Withdrawn review");
  await expect(audit).toContainText("Reassess provider assumptions");
  assert.equal(
    (await app.service.architectureOverview()).activeRevision,
    current.id,
  );
  await app.service.importArchitectureHistory(
    peer.exportHistory(),
    new AbortController().signal,
  );
  await page.reload();
  await page.getByLabel("Stored revision").selectOption(other.id);
  await page
    .locator("summary")
    .filter({ hasText: "Review history for this branch" })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: "All withdrawal explanations (2)" })
    .click();
  await expect(
    page.getByRole("region", { name: "Review this branch" }),
  ).toContainText("Independent availability concern");
  await expect(
    page.getByRole("region", { name: "Review this branch" }),
  ).toContainText("Reassess provider assumptions");
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/post-eighth/branch-reviewed.png",
    ),
    fullPage: true,
  });
  console.log(
    "Branch acknowledgement survives restart and export, keeps the local head, and clears only the reviewed tip.",
  );
} finally {
  peer?.close();
  a?.close();
  b?.close();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
