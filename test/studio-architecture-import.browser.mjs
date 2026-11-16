// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-arch-import-"));
let app, browser;
try {
  app = await startStudio({ path: root });
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
  const files = page.getByLabel("Architecture files", { exact: true });
  await files.setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from([0xff, 0xfe]),
  });
  await page
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("not valid UTF-8");
  assert.equal((await app.service.architectureOverview()).index, null);
  const original =
    '\uFEFF{"types":{},"functions":[{"id":"service.run","name":"run","owner":"service","metadata":"Retain café exactly"}]}';
  await files.setInputFiles({
    name: "bom.json",
    mimeType: "application/json",
    buffer: Buffer.from(original, "utf8"),
  });
  await page
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  assert.equal((await app.service.architectureOverview()).index, null);
  await page
    .getByRole("button", { name: "Save reviewed import", exact: true })
    .click();
  await expect(
    page.locator(".architecture-row").filter({ hasText: "service.run" }),
  ).toBeVisible();
  const state = await app.service.architectureOverview();
  assert.equal(
    (await app.service.architectureDocument(state.index.id, "bom.json")).text,
    original,
  );
  await page
    .locator(".architecture-row")
    .filter({ hasText: "service.run" })
    .click();
  await page
    .getByRole("button", { name: "Propose a change", exact: true })
    .click();
  const proposal = page.getByRole("region", { name: "Planning record" });
  await expect(proposal.getByLabel("Short title")).toHaveValue(
    "Change service.run",
  );
  await proposal
    .getByLabel("What and why")
    .fill("Require an idempotency key before retrying this operation.");
  await proposal
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(proposal).toHaveCount(0);
  const changed = await app.service.architectureOverview();
  const decision = changed.index.entities.find((e) => e.kind === "decision");
  assert.ok(decision);
  const record = await app.service.architectureRecord(
    changed.index.id,
    decision.id,
  );
  assert.equal(record.data.originRevision, state.index.id);
  assert.equal(record.data.links[0].target, "function:service.run");
  assert.equal(
    (await app.service.architectureDocument(changed.index.id, "bom.json")).text,
    original,
  );
  console.log(
    "Architecture import: malformed UTF-8 refused before storage; BOM-bearing JSON indexed exactly; linked change proposal preserves the original contract.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
