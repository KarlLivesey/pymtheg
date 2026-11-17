// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import assert from "node:assert/strict";
import { browserEvidence } from "./browser-evidence.mjs";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Run this entire controller only through pc-tools headless.
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdir, readFile } from "node:fs/promises";
// Wait for observed UI state; the outer helper owns the resource budget.
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-gui-"));
let app, browser;
try {
  await cp("examples", join(root, "examples"), { recursive: true });
  await mkdir(join(root, ".pymtheg"), { recursive: true });
  await cp(".pymtheg/settings.json", join(root, ".pymtheg/settings.json"));
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(app.url);
  await expect(
    page.getByRole("heading", { name: "See what your design implies" }),
  ).toBeVisible();
  const quoteBudget = page
    .locator(".finding-card")
    .filter({ hasText: "quote:" })
    .filter({ hasText: "K002" });
  await expect(quoteBudget).toHaveCount(1);
  await quoteBudget.getByText("K002", { exact: true }).click();
  await expect(page.locator(".source-finding")).toBeVisible();
  const original = await readFile("examples/mvp/checkout.pym", "utf8");
  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText(
    original.replace(
      "budget remote_calls <= 500",
      "budget remote_calls <= 600",
    ),
  );
  await expect(
    page.getByText("This result is from an earlier buffer revision.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Check design/ }).click();
  await expect(quoteBudget).toHaveCount(0);
  if (
    (await readFile(join(root, "examples/mvp/checkout.pym"), "utf8")) !==
    original
  )
    throw Error("Unsaved edit changed disk");
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await expect(
    page.locator(".formula").filter({ hasText: "3 * N" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /task-buggy.pym/ }).click();
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue(
    "TaskRunner",
  );
  await page.getByRole("button", { name: /Simulate/ }).click();
  await page.getByRole("button", { name: "Trace", exact: true }).click();
  await expect
    .poll(() =>
      app.service.runs.some(
        (run) => run.request.kind === "simulate" && run.status !== "running",
      ),
    )
    .toBe(true);
  const simulated = app.service.runs.find(
    (run) => run.request.kind === "simulate",
  );
  const evidence = simulated?.report?.results.filter(
    (result) => result.analysisKind === "behaviour",
  );
  const readableEvidence = JSON.stringify(evidence, (_, value) =>
    typeof value === "bigint" ? String(value) : value,
  );
  console.log("Initial simulation evidence", readableEvidence);
  assert.ok(
    evidence?.some((result) => result.outcome === "counterexample"),
    "Expected real counterexample evidence, received " + readableEvidence,
  );
  await expect(page.locator(".trace-controls")).toBeVisible();
  const steps = await page.locator(".trace-timeline button").count();
  await page
    .getByRole("button", { name: `Go to trace step ${steps - 1}`, exact: true })
    .click();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "deliveries" })
      .getByRole("cell")
      .last(),
  ).toHaveText("2");
  await page.getByRole("button", { name: "Scenario", exact: true }).click();
  await page.getByLabel("Seed", { exact: true }).fill("73");
  await page.getByLabel("Maximum steps", { exact: true }).fill("20");
  await page
    .getByRole("button", { name: "Apply scenario", exact: true })
    .click();
  await page.getByRole("button", { name: /Simulate/ }).click();
  await expect(page.locator(".trace-controls")).toBeVisible();
  await page.getByRole("button", { name: "Scenario", exact: true }).click();
  await expect(page.getByLabel("Seed", { exact: true })).toHaveValue("73");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await mkdir(browserEvidence("evidence/studio"), { recursive: true });
  await page.screenshot({
    path: browserEvidence("evidence/studio/trace.png"),
    fullPage: true,
  });
  const guide = page.getByRole("button", { name: /Guide/ });
  await guide.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(guide).toBeFocused();
  await page
    .getByRole("button", { name: /checkout.pym/, exact: false })
    .first()
    .click();
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue("quote");
  await page.getByRole("button", { name: "Findings", exact: true }).click();
  await page.screenshot({
    path: browserEvidence("evidence/studio/workspace.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 980, height: 850 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Layout overflows viewport");
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "GUI: real source navigation, unsaved recheck, work estimates, replay trace, keyboard dialog and responsive layout passed.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
