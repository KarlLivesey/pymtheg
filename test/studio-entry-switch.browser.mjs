// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-entry-switch-"));
let app, browser;
try {
  await writeFile(
    join(root, "a.pym"),
    "flow alpha() -> Bool { return true; }\nflow beta() -> Bool { return false; }",
  );
  await writeFile(
    join(root, "b.pym"),
    "machine Worker { state done: Bool = false; event finish when !done { done = true; } invariant valid = true; }",
  );
  app = await startStudio({ path: join(root, "a.pym") });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  page.on("pageerror", (error) => console.error("UI error:", String(error)));
  await page.goto(app.url);
  await page.getByLabel("Check as I edit").uncheck();
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue("alpha");
  await page.getByLabel("Behaviour entry point").selectOption("beta");
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue("beta");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/run") &&
      r.request().postDataJSON()?.entry === "beta",
  );
  await page.getByRole("button", { name: /Check design/ }).click();
  const received = await response;
  const checked = await received.json();
  assert.equal(received.status(), 202, JSON.stringify(checked));
  await expect
    .poll(() =>
      app.service.runs.some(
        (run) => run.id === checked.id && run.status === "completed",
      ),
    )
    .toBe(true);
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue("beta");
  await page
    .getByRole("navigation", { name: "Source files" })
    .getByRole("button", { name: /b.pym/ })
    .click();
  await expect
    .poll(() =>
      app.service.runs.some(
        (r) => r.request.file === "b.pym" && r.status === "completed",
      ),
    )
    .toBe(true);
  const run = app.service.runs.find((r) => r.request.file === "b.pym");
  console.log(
    JSON.stringify({
      status: run.status,
      error: run.error,
      diagnostics: run.report?.diagnostics,
      symbols: run.symbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        file: s.span.file,
      })),
      selector: await page.getByLabel("Behaviour entry point").innerHTML(),
      value: await page.getByLabel("Behaviour entry point").inputValue(),
    }),
  );
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue("Worker");
  await page
    .getByRole("navigation", { name: "Source files" })
    .getByRole("button", { name: /a.pym/ })
    .click();
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue("alpha");
  console.log(
    "Flow and machine switching selects the current entry; an explicit second-flow selection survives rechecking.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
