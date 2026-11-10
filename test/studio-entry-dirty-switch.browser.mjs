import { browserExecutable, browserType } from "./browser-launch.mjs";
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
  await cp(".pymtheg.json", join(root, ".pymtheg.json"));
  app = await startStudio({
    path: root,
    tlcJar: "/tmp/spec-language-research/tla2tools.jar",
  });
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
  if ((await readFile("examples/mvp/checkout.pym", "utf8")) !== original)
    throw Error("Unsaved edit changed disk");
  await page.getByRole("button", { name: "Work", exact: true }).click();
  await expect(
    page.locator(".formula").filter({ hasText: "3 * N" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /task-buggy.pym/ }).click();
  await expect
    .poll(() =>
      app.service.runs.some(
        (run) =>
          run.request.file.endsWith("task-buggy.pym") &&
          run.status !== "running",
      ),
    )
    .toBe(true);
  console.log(
    JSON.stringify(
      app.service.runs.map((run) => ({
        id: run.id,
        file: run.request.file,
        status: run.status,
        error: run.error,
        symbols: run.symbols.map((s) => ({
          name: s.name,
          kind: s.kind,
          file: s.span.file,
        })),
        diagnostics: run.report?.diagnostics,
      })),
      null,
      2,
    ),
  );
  console.log(
    "Selector",
    await page.getByLabel("Behaviour entry point").innerHTML(),
  );
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue(
    "TaskRunner",
  );
  console.log("Dirty-file switch selects TaskRunner.");
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
