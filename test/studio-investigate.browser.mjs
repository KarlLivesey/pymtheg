import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import AxeBuilder from "@axe-core/playwright";
// Run only through pc-tools headless.
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, cp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-investigate-"));
let app, browser;
try {
  await cp("examples/workbench", root, { recursive: true });
  app = await startStudio({ path: join(root, "system.pym") });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByLabel("Check as I edit").uncheck();
  async function completed(response) {
    const received = await response;
    const data = await received.json();
    assert.equal(received.status(), 202);
    await expect
      .poll(() => app.service.runs.find((run) => run.id === data.id)?.status)
      .toBe("completed");
    await expect(page.locator(".statusbar")).toHaveAttribute(
      "data-run-id",
      data.id,
    );
    await expect(page.locator(".statusbar")).toContainText("completed");
    return data.id;
  }
  console.log("stage: evidence");
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page.getByLabel("Search evidence").fill("#quote/cost/");
  await expect(page.locator(".evidence-card")).toHaveCount(1);
  await expect(page.locator(".evidence-card")).toContainText(
    "Established for this check",
  );
  console.log("stage: unresolved");
  await page.getByLabel("Search evidence").fill("pay");
  await page.getByLabel("Evidence status").selectOption("unresolved");
  await expect(page.locator(".evidence-card").first()).toContainText(
    "Still unresolved",
  );
  console.log("stage: structure");
  await page.getByRole("button", { name: "Structure", exact: true }).click();
  await page.getByLabel("Search components").fill("checkout");
  await page.locator(".symbol-main").click();
  await page.getByRole("button", { name: "Explore pay", exact: true }).click();
  await page
    .getByRole("button", { name: "Explore capture", exact: true })
    .click();
  await expect(page.locator(".impact-summary")).toContainText(
    "2 dependent components",
  );
  console.log("stage: files");
  const opened = page.waitForResponse((r) => r.url().endsWith("/api/run"));
  await page.getByLabel("Find source files").fill("quote");
  await expect(page.locator(".file-list .file-row")).toHaveCount(1);
  await page.locator(".file-list .file-row").click();
  await expect(page.locator(".cm-content")).toContainText("flow quote");
  const baseline = await completed(opened);
  console.log("stage: comparison", baseline);
  const original = await readFile(join(root, "quote.pym"), "utf8");
  const changed = original.replace(
    "for item in quantity { call currentPrice(); call stockLevel(); }",
    "call currentPrice(); for item in quantity { call stockLevel(); }",
  );
  let requested = page.waitForResponse((r) => r.url().endsWith("/api/run"));
  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText(changed);
  await page.getByRole("button", { name: /Check design/ }).click();
  await completed(requested);
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await page.getByLabel("Previous run").selectOption(baseline);
  await expect(
    page.locator(".comparison-cost").filter({
      has: page.getByRole("heading", {
        name: "quote · remote_calls",
        exact: true,
      }),
    }),
  ).toContainText("upper bound changed by -199");
  await expect(
    page.getByText("Scopes, seeds, tool versions or assumptions differ.", {
      exact: false,
    }),
  ).toHaveCount(0);
  await mkdir(browserEvidence("evidence/recovery"), { recursive: true });
  await page.screenshot({
    path: browserEvidence("evidence/recovery/work-improvement.png"),
    fullPage: true,
  });
  requested = page.waitForResponse((r) => r.url().endsWith("/api/run"));
  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText(changed.replace("<= 200", "<= 400"));
  await page.getByRole("button", { name: /Check design/ }).click();
  await completed(requested);
  await expect(
    page.locator(".comparison-cost").filter({
      has: page.getByRole("heading", {
        name: "quote · remote_calls",
        exact: true,
      }),
    }),
  ).toContainText("Different input bounds");
  // Cancel at the production coordinator's typed-partial event, independently of speed.
  let cancelled;
  const stopped = new Promise((resolve) => {
    cancelled = resolve;
  });
  const unsubscribe = app.service.subscribe((event) => {
    if (
      event.kind !== "run" ||
      event.run.request.clientId !== "incomplete-baseline"
    )
      return;
    if (event.run.phase === "partial") app.service.cancel(event.run.id);
    if (event.run.status === "cancelled" && event.run.report)
      cancelled(event.run.id);
  });
  await app.service.start({
    clientId: "incomplete-baseline",
    revision: 0,
    file: "quote.pym",
    buffers: { "quote.pym": changed },
    kind: "check",
    entry: "quote",
    seed: "42",
    maxSteps: 12,
    maxSamples: 1000,
  });
  const partialId = await stopped;
  unsubscribe();
  const partial = app.service.runs.find((r) => r.id === partialId);
  assert.equal(partial.report.session.state, "Cancelled");
  assert.equal(
    partial.report.results.some((r) => r.analysisKind === "cost"),
    false,
  );
  await page.getByLabel("Previous run").selectOption(partialId);
  await expect(page.locator(".comparison-warning")).toContainText(
    "incomplete checks",
  );
  await expect(
    page.getByText("No matching work estimates are available in both runs.", {
      exact: true,
    }),
  ).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  if (audit.violations.length) throw Error(JSON.stringify(audit.violations));
  await mkdir(browserEvidence("evidence/recovery"), { recursive: true });
  await page.screenshot({
    path: browserEvidence("evidence/recovery/investigation.png"),
    fullPage: true,
  });
  console.log(
    "Investigation: multi-file search, independent evidence, transitive impact and scope-aware work comparisons passed.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
