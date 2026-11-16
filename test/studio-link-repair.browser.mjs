// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { prepareHeadingIdentities } from "../dist/architecture/heading-identities.js";
import { proposeContractChange } from "../dist/architecture/planning.js";
import { startStudio } from "../dist/studio/server.js";
const root = await mkdtemp(join(tmpdir(), "pym-link-repair-")),
  expect = baseExpect.configure({ timeout: 0 });
let store, app, browser;
try {
  store = await ArchitectureStore.open(root);
  const original = {
    path: "ops.md",
    text: "# Ops\n## Backups\nnightly full backup kept 30 days\n",
  };
  const first = prepareHeadingIdentities([], [original]),
    base = store.save("Original", "test", first),
    target = base.entities.find(
      (e) => e.kind === "heading" && e.name === "Backups",
    );
  const plan = {
    ...proposeContractChange("D1", target, base.id),
    title: "Keep backups",
    acceptance: "A backup is retained",
    status: "accepted",
  };
  const planned = prepareHeadingIdentities(first, [
    original,
    {
      path: "plan.json",
      text: JSON.stringify({ schema: "pymtheg.plan/v1", items: [plan] }),
    },
  ]);
  store.save("Planned", "test", planned);
  const next = prepareHeadingIdentities(planned, [
    {
      path: "ops.md",
      text: "# Ops\n## Backups\nno backups; rely on replicas\n",
    },
    {
      path: "legacy/ops.md",
      text: original.text.replace("# Ops", "# Ops (archived)"),
    },
    planned.find((d) => d.path === "plan.json"),
  ]);
  const index = store.save("Moved with edit", "test", next),
    replacement = index.entities.find(
      (e) =>
        e.kind === "heading" &&
        e.document === "legacy/ops.md" &&
        e.name === "Backups",
    );
  assert.ok(index.edges.some((e) => e.from === "plan:D1" && e.unresolved));
  store.close();
  store = null;
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Needs attention", exact: true })
    .click();
  const work = page.getByRole("region", {
    name: "Architecture work to review",
  });
  await work
    .getByRole("button", { name: "Keep backups", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  await expect(
    form.getByRole("region", { name: "Previously reviewed target" }),
  ).toContainText("nightly full backup");
  await form
    .getByText("Choose a different target for this link", { exact: true })
    .click();
  await form.getByLabel("Replacement target for link 1").fill(replacement.id);
  await form
    .getByRole("button", { name: "Replace link 1", exact: true })
    .click();
  await expect(
    form.getByRole("region", { name: "Current linked target" }),
  ).toContainText("legacy/ops.md");
  await expect(
    form.getByRole("region", { name: "Previously reviewed target" }),
  ).toContainText("nightly full backup");
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/post-eighth/link-repair.png"),
    fullPage: true,
  });
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  const head = (await app.service.architectureOverview()).index,
    saved = await app.service.architectureRecord(head.id, "plan:D1");
  assert.equal(saved.data.links[0].target, replacement.id);
  console.log(
    "Moved-and-edited heading stays unresolved until explicit repair; old and chosen content remain comparable and the repaired plan persists.",
  );
} finally {
  store?.close();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
