// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { hash } from "../dist/shared/identity.js";
import {
  retainObservation,
  readImplementation,
  bindImplementation,
  compareImplementation,
} from "../dist/implementation/workspace.js";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-combined-gaps-"));
let store, app, browser;
try {
  store = await ArchitectureStore.open(root);
  const item = {
    ...newPlanItem("R1"),
    title: "Archive safely",
    acceptance: "Close the file",
  };
  let revision = store.save("Original plan", "test", [
    {
      path: "plan.json",
      text: JSON.stringify({ schema: "pymtheg.plan/v1", items: [item] }),
    },
  ]);
  const original = "export function archive(): boolean { return true; }";
  const observe = (text) =>
    observeTypescript([{ path: "archive.ts", text, hash: hash(text) }], {
      label: "Code",
      gitCommit: null,
      dirty: true,
    });
  revision = await retainObservation(
    store,
    observe(original),
    revision.id,
    new AbortController().signal,
  );
  let state = await readImplementation(store);
  const row = compareImplementation(state, state)[0];
  revision = await bindImplementation(
    store,
    {
      revision: revision.id,
      planId: row.id,
      planHash: row.planHash,
      nodeId: state.graph.nodes.find((n) => n.name === "archive").id,
      observationId: state.graph.snapshotId,
      note: "Implements archive",
    },
    new AbortController().signal,
  );
  state = await readImplementation(store);
  revision = store.save(
    "Changed plan",
    "test",
    state.documents.map((d) =>
      d.path === "plan.json"
        ? {
            ...d,
            text: JSON.stringify({
              schema: "pymtheg.plan/v1",
              items: [{ ...item, acceptance: "Close and sync the file" }],
            }),
          }
        : d,
    ),
    undefined,
    state.index.id,
  );
  await retainObservation(
    store,
    observe("export const other = 1;"),
    revision.id,
    new AbortController().signal,
  );
  store.close();
  store = null;
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  ).newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".architecture-workspace")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByRole("button", { name: "Plan & code graphs", exact: true })
    .click();
  const view = page.getByRole("region", {
    name: "Planned and existing system",
  });
  const record = view
    .getByRole("list", { name: "System records" })
    .getByRole("button")
    .filter({ hasText: "Archive safely" });
  await expect(record).toContainText("Linked code missing + Plan changed");
  await record.click();
  const links = view.getByRole("region", {
    name: "Linked implementation declarations",
  });
  await expect(links).toContainText("Linked code missing + Plan changed");
  await expect(links).toContainText(
    "absent in the selected covered code version",
  );
  await expect(links).toContainText("plan changed");
  await expect(view.locator(".implementation-counts")).toContainText(
    "1 Linked code missing",
  );
  await expect(view.locator(".implementation-counts")).toContainText(
    "1 Plan changed",
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/simultaneous-gaps.png"),
    fullPage: true,
  });
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  if (audit.violations.length) throw Error(JSON.stringify(audit.violations));
  console.log(
    "PASS: a changed plan and deleted function are both visible in the graph list, per-link detail, and independent counts.",
  );
} finally {
  store?.close();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
