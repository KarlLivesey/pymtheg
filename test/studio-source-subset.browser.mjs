import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-subset-ui-"));
let app, browser;
try {
  await writeFile(
    join(root, "a.pym"),
    "type Customer = { name: String }; flow a(x: Customer) -> Bool { return true; }",
  );
  await writeFile(
    join(root, "b.pym"),
    "type Asset = { id: Nat }; flow b(x: Asset) -> Bool { return true; }",
  );
  app = await startStudio({ path: root });
  const saved = await app.service.savePlanItem(
    "",
    {
      ...newPlanItem("P"),
      title: "Keep the historical component",
      acceptance: "Retain its source",
      links: [
        { kind: "supports", target: "source:a.pym#a" },
        { kind: "supports", target: "source:b.pym#b" },
      ],
    },
    "Plan",
    new AbortController().signal,
  );
  await unlink(join(root, "a.pym"));
  await writeFile(
    join(root, "unrelated.pym"),
    "flow broken() -> Unit { let value = ; }",
  );
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1450, height: 1050 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page
    .locator(".architecture-row")
    .filter({ hasText: "Keep the historical component" })
    .click();
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  await form.getByLabel("Status", { exact: true }).selectOption("superseded");
  await form
    .getByRole("button", { name: "Remove link 2", exact: true })
    .click();
  const complete = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/architecture/plan") &&
      r.request().method() === "POST",
  );
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  const result = await complete;
  assert.equal(result.status(), 200, await result.text());
  await expect(form).toHaveCount(0);
  const current = await app.service.architectureOverview(),
    record = await app.service.architectureRecord(
      current.activeRevision,
      "plan:P",
    );
  assert.equal(record.data.status, "superseded");
  assert.equal(record.data.sourceExpectations["source:b.pym#Asset"], undefined);
  assert.ok(record.data.sourceExpectations["source:a.pym#Customer"]);
  const work = await app.service.architectureWork(current.activeRevision);
  assert.ok(
    work.some((i) => i.kind === "broken-link" && i.target === "source:a.pym#a"),
  );
  assert.ok(
    !work.some(
      (i) =>
        i.kind === "unknown-link-review" &&
        i.target === "source:a.pym#a" &&
        i.message.includes("checking is incomplete"),
    ),
  );
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/historical-source-subset.png",
    ),
    fullPage: true,
  });
  console.log(
    "A plan can be retired while retaining a missing component and detaching another; unrelated syntax does not disguise its broken source link.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
