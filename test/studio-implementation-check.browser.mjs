import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
import assert from "node:assert/strict";
const root = await mkdtemp(join(tmpdir(), "pym-check-ui-")),
  expect = baseExpect.configure({ timeout: 0 });
let app, browser, releasePreview;
try {
  await writeFile(join(root, "main.pym"), "op pay(id: String) -> Bool;");
  app = await startStudio({ path: join(root, "main.pym") });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page.getByLabel("Check as I edit").uncheck();
  await expect
    .poll(() => app.service.runs.some((run) => run.status === "completed"))
    .toBe(true);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByLabel("Output purpose").selectOption("contracts");
  const check = page.getByRole("region", {
    name: "Check a handwritten implementation",
  });
  const preview = async () => {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/implementation-check") &&
        r.request().method() === "POST",
    );
    await check
      .getByRole("button", {
        name: "Preview implementation check",
        exact: true,
      })
      .click();
    const received = await response;
    const body = await received.json();
    assert.equal(
      received.status(),
      200,
      JSON.stringify({
        request: received.request().postDataJSON(),
        response: body,
      }),
    );
  };
  await check
    .getByLabel("Implementation type", { exact: true })
    .fill("Service");
  await check
    .getByLabel("Implementation module", { exact: true })
    .fill("./service");
  await preview();
  await expect(check.locator("pre")).toContainText(
    "PymthegImplementation<Implementation>",
  );
  await expect(check).toContainText("No compiler has been run");
  const download = page.waitForEvent("download");
  await check
    .getByRole("button", { name: "Download implementation check", exact: true })
    .click();
  const downloaded = await download;
  assert.equal(downloaded.suggestedFilename(), "implementation.check.ts");
  assert.match(
    await readFile(await downloaded.path(), "utf8"),
    /from "\.\/service"/,
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/implementation-check.png"),
    fullPage: true,
  });
  await page.getByLabel("Scaffold language").selectOption("go");
  await check
    .getByLabel("Implementation type", { exact: true })
    .fill("*Service");
  await preview();
  await expect(check.locator("pre")).toContainText("(*Service)(nil)");
  await page.getByLabel("Scaffold language").selectOption("rust");
  await check
    .getByLabel("Implementation type", { exact: true })
    .fill("crate::Service");
  await preview();
  await expect(check.locator("pre")).toContainText(
    "require_contract::<crate::Service>()",
  );
  const originalRuns = new Set(app.service.runs.map((run) => run.id));
  let reachedPreview;
  const reached = new Promise((resolve) => {
    reachedPreview = resolve;
  });
  const gate = new Promise((resolve) => {
    releasePreview = resolve;
  });
  let intercept = true;
  await page.route("**/api/implementation-check", async (route) => {
    if (intercept) {
      intercept = false;
      reachedPreview();
      await gate;
    }
    await route.continue().catch(() => {});
  });
  await check
    .getByRole("button", { name: "Preview implementation check", exact: true })
    .click();
  await reached;
  await page.getByRole("button", { name: /Check design/ }).click();
  await expect
    .poll(() =>
      app.service.runs.some(
        (run) => !originalRuns.has(run.id) && run.status === "completed",
      ),
    )
    .toBe(true);
  await expect(check.getByRole("alert")).toContainText(
    "The checked design changed",
  );
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/implementation-check-retry.png",
    ),
    fullPage: true,
  });
  await expect(
    check.getByLabel("Implementation type", { exact: true }),
  ).toHaveValue("crate::Service");
  releasePreview();
  releasePreview = null;
  await preview();
  await expect(check.locator("pre")).toContainText(
    "require_contract::<crate::Service>()",
  );
  console.log(
    "Studio previews and downloads explicit implementation checks for TypeScript, Go and Rust; a held preview survives a new check with preserved settings and an explicit retry notice.",
  );
} finally {
  releasePreview?.();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
