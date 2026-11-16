// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { waitForRecovery } from "./recovery-ack.mjs";
import AxeBuilder from "@axe-core/playwright";
// Entire controller must run through pc-tools headless.
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-recover-ui-"));
let app, browser, page;
const original = "flow main() -> Unit { assert true; }\n",
  draft = original + "// recover this unsaved decision\n";
try {
  await writeFile(join(root, "main.pym"), original);
  app = await startStudio({ path: join(root, "main.pym") });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/recovery") &&
      r
        .request()
        .postDataJSON()
        ?.workspace?.drafts?.some((d) => d.text === draft),
  );
  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText(draft);
  const response = await saved;
  if (!response.ok()) throw Error("Draft was not acknowledged");
  await page.getByRole("button", { name: /Check design/ }).click();
  await expect
    .poll(
      async () =>
        (await app.service.project()).runs.some(
          (r) =>
            r.request.buffers["main.pym"] === draft && r.status === "completed",
        ),
      { timeout: 0 },
    )
    .toBe(true);
  const before = (await app.service.project()).runs.find(
    (r) => r.request.buffers["main.pym"] === draft,
  );
  if (!before) throw Error("Expected checked draft history");
  await page.close();
  await app.close();
  app = await startStudio({ path: root });
  page = await context.newPage();
  await page.goto(app.url);
  await expect(page.locator(".cm-content")).toContainText(
    "recover this unsaved decision",
  );
  await expect(page.getByRole("status")).toContainText("Recovered");
  if ((await readFile(join(root, "main.pym"), "utf8")) !== original)
    throw Error("Recovery overwrote source");
  if (!(await app.service.project()).runs.some((r) => r.id === before.id))
    throw Error("Frozen run history did not survive restart");
  await waitForRecovery(
    app,
    (r) => r.drafts.find((d) => d.path === "main.pym")?.text,
    draft,
  );
  await page.close();
  await app.close();
  const external = "flow main() -> Unit { assert false; }\n// external edit\n";
  await writeFile(join(root, "main.pym"), external);
  app = await startStudio({ path: root });
  page = await context.newPage();
  await page.goto(app.url);
  await expect(page.locator(".cm-content")).toContainText(
    "recover this unsaved decision",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "This file changed on disk",
  );
  await expect(page.getByRole("dialog")).toContainText("external edit");
  await page.getByLabel("Save copy path").fill("recovered-copy.pym");
  await page
    .getByRole("button", { name: "Save separate copy", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if ((await readFile(join(root, "recovered-copy.pym"), "utf8")) !== draft)
    throw Error("Separate copy lost the unsaved draft");
  if ((await readFile(join(root, "main.pym"), "utf8")) !== external)
    throw Error("Recovered draft clobbered external edit");
  await waitForRecovery(
    app,
    (r) => r.drafts.find((d) => d.path === "main.pym")?.text,
    draft,
  );
  const current = app.service.readRecovery();
  await app.service.saveRecovery(current.revision, {
    drafts: [
      {
        path: "main.pym",
        text: original + "// other window",
        baseHash: current.drafts.find((d) => d.path === "main.pym").baseHash,
      },
    ],
    context: current.context,
  });
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Another Studio window now owns recovery" }),
  ).toBeVisible();
  const next = draft + "// current window newer\n";
  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText(next);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Another Studio window now owns recovery" }),
  ).toContainText("recovery is paused");
  await page.getByRole("button", { name: "Review recovery and retry" }).click();
  await expect(page.getByRole("dialog")).toContainText("main.pym");
  await expect(page.getByRole("dialog")).toContainText("other window");
  await page.getByRole("dialog").locator("summary").first().click();
  await expect(page.getByRole("dialog")).toContainText("current window newer");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(browserEvidence("evidence/recovery"), { recursive: true });
  await page.screenshot({
    path: browserEvidence("evidence/recovery/conflict-review.png"),
    fullPage: true,
  });
  if (
    !(await page
      .getByRole("dialog")
      .evaluate((node) => node.scrollWidth <= node.clientWidth))
  )
    throw Error("Recovery dialog content overflows horizontally");
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  if (audit.violations.length) throw Error(JSON.stringify(audit.violations));
  await page
    .getByRole("button", { name: "Use this window for recovery" })
    .click();
  await waitForRecovery(
    app,
    (r) => r.drafts.find((d) => d.path === "main.pym")?.text,
    next,
  );
  if (
    app.service.readRecovery().drafts.find((d) => d.path === "main.pym")
      .text !== next
  )
    throw Error("Explicit conflict resolution did not save the chosen buffer");
  console.log(
    "Recovery: acknowledged unsaved text and frozen history survived page/server restart; external edits were protected.",
  );
} finally {
  await page?.close();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
