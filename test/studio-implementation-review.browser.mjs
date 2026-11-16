// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { hash, json } from "../dist/shared/identity.js";
import {
  retainObservation,
  readImplementation,
  bindImplementation,
  compareImplementation,
} from "../dist/implementation/workspace.js";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-review-ui-"));
const observe = (text) =>
  observeTypescript([{ path: "main.ts", text, hash: hash(text) }], {
    label: "Current code",
    gitCommit: null,
    dirty: true,
  });
let store, app, browser;
try {
  store = await ArchitectureStore.open(root);
  const plan = store.save("Intent", "fixture", [
    {
      path: "plan.json",
      text: json({
        schema: "pymtheg.plan/v1",
        items: [
          {
            ...newPlanItem("R1"),
            title: "Send and close",
            acceptance: "Send once, then close the resource.",
          },
        ],
      }),
    },
  ]);
  await retainObservation(
    store,
    observe(
      "const MAX_FEE=5000;\nfunction close() {}\nfunction send() { return MAX_FEE; }\nexport function run() { send(); close(); }\nexport function other() {}",
    ),
    plan.id,
    new AbortController().signal,
  );
  for (const name of ["run", "other"]) {
    const state = await readImplementation(store),
      row = compareImplementation(state, state)[0];
    await bindImplementation(
      store,
      {
        revision: state.index.id,
        planId: row.id,
        planHash: row.planHash,
        nodeId: state.graph.nodes.find((n) => n.name === name).id,
        observationId: state.graph.snapshotId,
        note: "Review reason for " + name,
      },
      new AbortController().signal,
    );
  }
  let state = await readImplementation(store);
  const nodeId = state.graph.nodes.find((n) => n.name === "run").id;
  await retainObservation(
    store,
    observe(
      "const MAX_FEE=6000;\nfunction close() {}\nfunction send() { return MAX_FEE; }\nexport function run() { send(); send(); }\nexport function other() { send(); }",
    ),
    state.index.id,
    new AbortController().signal,
  );
  store.close();
  store = null;
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  page.on("pageerror", (e) => console.error(e));
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Plan & code graphs", exact: true })
    .click();
  const view = page.getByRole("region", {
    name: "Planned and existing system",
  });
  await view
    .getByRole("list", { name: "System records" })
    .getByRole("button")
    .filter({ hasText: "Send and close" })
    .click();
  await expect(
    view
      .getByRole("definition")
      .filter({ hasText: "Send once, then close the resource." }),
  ).toBeVisible();
  await view
    .getByLabel("Reason for this link")
    .fill("Unfinished unrelated new link");
  const target = view.getByLabel("Observed declaration", { exact: true });
  await target.selectOption(nodeId);
  const link = view
    .locator(".implementation-linked-code li")
    .filter({ has: page.getByText("run", { exact: true }) });
  await link
    .getByRole("button", { name: "Inspect this code", exact: true })
    .click();
  const review = view.getByRole("region", {
    name: "Review linked code changes",
  });
  await expect(
    review.getByRole("cell", {
      name: "export function run() { send(); close(); }",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    review.getByRole("cell", {
      name: "export function run() { send(); send(); }",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    review.getByRole("region", { name: "Relationship changes" }),
  ).toContainText("close — 1 → 0");
  await expect(
    review.getByRole("region", { name: "Relationship changes" }),
  ).toContainText("send — 1 → 2");
  const dependencies = review.getByRole("region", {
    name: "Observed dependency changes",
  });
  await expect(dependencies).toContainText("2 changed dependencies");
  await dependencies
    .getByText("MAX_FEE — changed (main.ts)", { exact: true })
    .click();
  await expect(
    dependencies.getByText("MAX_FEE=5000", { exact: true }),
  ).toBeVisible();
  await expect(
    dependencies.getByText("MAX_FEE=6000", { exact: true }),
  ).toBeVisible();
  await expect(view.getByLabel("Reason for this link")).toHaveValue(
    "Unfinished unrelated new link",
  );
  await expect(target).toHaveValue(nodeId);
  await review
    .getByRole("button", { name: "Read reviewed source", exact: true })
    .click();
  await expect(
    review.getByRole("region", { name: "Full retained source" }),
  ).toContainText("close();");
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/implementation-code-review.png",
    ),
    fullPage: true,
  });
  assert.equal(
    await review
      .locator("tbody tr")
      .first()
      .evaluate((el) => getComputedStyle(el).display),
    "table-row",
  );
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    accessibility.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/implementation-code-review-narrow.png",
    ),
    fullPage: true,
  });
  await review
    .getByRole("checkbox", {
      name: "I reviewed this plan and the selected code version",
      exact: true,
    })
    .check();
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/implementation/link") &&
      r.request().method() === "POST",
  );
  await review
    .getByRole("button", {
      name: "Accept this version for this link",
      exact: true,
    })
    .click();
  assert.equal((await saved).status(), 200);
  await expect(view).toContainText(
    "Other links and unfinished drafts are unchanged.",
  );
  await expect(view.getByLabel("Reason for this link")).toHaveValue(
    "Unfinished unrelated new link",
  );
  const returnedRecord = view
    .getByRole("list", { name: "System records" })
    .getByRole("button")
    .filter({ hasText: "Send and close" });
  await expect(returnedRecord).toHaveClass(/selected/);
  assert.equal(
    await returnedRecord.evaluate((el) => document.activeElement === el),
    true,
    "Acceptance should return keyboard focus to the selected record",
  );
  store = await ArchitectureStore.open(root);
  state = await readImplementation(store);
  assert.equal(compareImplementation(state, state)[0].status, "code-changed");
  assert.equal(
    state.bindings.find((b) => b.nodeId === nodeId).note,
    "Review reason for run",
  );
  // Another explicit writer moves the checkpoint after the comparison was read.
  const other = view
    .locator(".implementation-linked-code li")
    .filter({ has: page.getByText("other", { exact: true }) });
  const loaded = page.waitForResponse((r) =>
    r.url().endsWith("/api/implementation/compare"),
  );
  await other
    .getByRole("button", { name: "Inspect this code", exact: true })
    .click();
  const stale = await (await loaded).json();
  await expect(
    review.getByRole("button", {
      name: "Accept this version for this link",
      exact: true,
    }),
  ).toBeVisible();
  const external = await page.request.post(
    new URL("/api/implementation/link", app.url).href,
    {
      headers: { Authorization: "Bearer " + app.token },
      data: {
        revision: stale.activeRevision,
        planId: stale.planId,
        nodeId: stale.nodeId,
        planHash: stale.planHash,
        observationId: stale.after.observationId,
        note: "Reviewed in another session",
      },
    },
  );
  assert.equal(external.status(), 200, await external.text());
  await review
    .getByRole("checkbox", {
      name: "I reviewed this plan and the selected code version",
      exact: true,
    })
    .check();
  const refused = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/implementation/link") &&
      r.request().method() === "POST",
  );
  await review
    .getByRole("button", {
      name: "Accept this version for this link",
      exact: true,
    })
    .click();
  assert.equal((await refused).status(), 409);
  await expect(review.getByRole("alert")).toContainText("Architecture changed");
  await expect(
    review.getByRole("checkbox", {
      name: "I reviewed this plan and the selected code version",
      exact: true,
    }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(review).toHaveCount(0);
  await expect(
    other.getByRole("button", { name: "Inspect this code", exact: true }),
  ).toBeFocused();
  await expect(view.getByLabel("Reason for this link")).toHaveValue(
    "Unfinished unrelated new link",
  );
  console.log(
    "PASS: exact source/call-site comparison, narrow layout, accessibility, explicit pair review and draft preservation",
  );
} finally {
  store?.close();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
