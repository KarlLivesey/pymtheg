// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-fork-ui-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  const signal = new AbortController().signal,
    source = {
      id: "requirements",
      label: "Payment requirements",
      kind: "upload",
    },
    docs = (text) => [{ path: "payments.md", text }];
  let saved = await app.service.importArchitecture(
    "Initial",
    docs("# Payments\n\nRetry twice."),
    signal,
    { source, mode: "add" },
  );
  saved = await app.service.savePlanItem(
    saved.id,
    {
      ...newPlanItem("R1"),
      title: "No duplicate charge",
      links: [{ kind: "depends-on", target: "heading:payments.md#payments" }],
    },
    "Link",
    signal,
  );
  saved = await app.service.editArchitectureDocument(
    saved.id,
    "payments.md",
    "# Payments\n\nNever retry.",
    "Local",
    signal,
  );
  const input = {
    source,
    mode: "refresh",
    documents: docs("# Payments\n\nRetry three times."),
  };
  const pending = await app.service.previewArchitectureImport(
      "Both",
      input,
      signal,
    ),
    c = pending.conflicts[0];
  const ready = await app.service.previewArchitectureImport(
    "Both",
    {
      ...input,
      resolutions: [
        {
          path: c.path,
          localHash: c.localHash,
          incomingHash: c.incomingHash,
          choice: "keep-both",
        },
      ],
    },
    signal,
  );
  saved = await app.service.commitPreparedArchitectureImport(
    ready.token,
    signal,
  );
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Needs attention", exact: true })
    .click();
  const work = page.getByRole("region", {
    name: "Architecture work to review",
  });
  await expect(work).toContainText(
    "separately tracked copy from Payment requirements",
  );
  await expect(work).toContainText("local copy payments.md");
  await work
    .getByRole("button", { name: "Open tracked copy", exact: true })
    .click();
  await expect(
    page.getByText("Retry three times.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/fork-attention.png"),
    fullPage: true,
  });
  console.log(
    "A kept local policy reports its upstream divergence and opens the independently retained upstream text.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
