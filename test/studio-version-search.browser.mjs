import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import {
  retainObservation,
  readImplementation,
  bindImplementation,
  compareImplementation,
} from "../dist/implementation/workspace.js";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { hash, json } from "../dist/shared/identity.js";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-version-ui-"));
let store, app, browser, release, page;
try {
  store = await ArchitectureStore.open(root);
  const item = {
    ...newPlanItem("Original requirement"),
    id: "R1",
    title: "Original requirement",
  };
  const original = store.save("Original intent", "Edited planning record", [
    {
      path: "plan.json",
      text: json({ schema: "pymtheg.plan/v1", items: [item] }),
    },
  ]);
  const observe = (text, label) =>
    observeTypescript([{ path: "main.ts", text, hash: hash(text) }], {
      label,
      gitCommit: null,
      dirty: true,
    });
  await retainObservation(
    store,
    observe(
      'export function send(): boolean { throw new Error("Not implemented"); }',
      "Original code",
    ),
    original.id,
    new AbortController().signal,
  );
  let state = await readImplementation(store);
  const row = compareImplementation(state, state)[0];
  await bindImplementation(
    store,
    {
      revision: state.index.id,
      planId: row.id,
      planHash: row.planHash,
      nodeId: state.graph.nodes[0].id,
      observationId: state.graph.snapshotId,
      note: "Reviewed stub",
    },
    new AbortController().signal,
  );
  state = await readImplementation(store);
  const currentCode = await retainObservation(
    store,
    observe("export function send(): boolean { return true; }", "Current code"),
    state.index.id,
    new AbortController().signal,
  );
  state = await readImplementation(store);
  await retainObservation(
    store,
    observe(
      "export function send(): boolean { return false; }",
      "Current code",
    ),
    state.index.id,
    new AbortController().signal,
  );
  state = await readImplementation(store);
  for (let i = 0; i < 25; i++)
    store.save(
      "Plan update " + i,
      "Edited planning record",
      state.documents.map((d) =>
        d.path === "plan.json"
          ? {
              ...d,
              text: json({
                schema: "pymtheg.plan/v1",
                items: [{ ...item, title: "Current requirement " + i }],
              }),
            }
          : d,
      ),
    );
  store.close();
  store = null;
  await writeFile(
    join(root, "main.ts"),
    "export function send(): boolean { return true; }",
  );
  const db = join(root, ".pymtheg/shared/architecture.sqlite"),
    before = await readFile(db);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  ).newPage();
  page.setDefaultTimeout(0);
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  page.on("response", async (r) => {
    if (r.status() >= 400) console.error("HTTP", r.status(), await r.text());
  });
  console.log("Opening graph");
  await page.goto(app.url);
  let intercepted;
  const seen = new Promise((r) => {
    intercepted = r;
  });
  const held = new Promise((r) => {
    release = r;
  });
  let first = true;
  await page.route("**/api/implementation/versions*", async (route) => {
    if (first) {
      first = false;
      intercepted();
      await held;
    }
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Plan & code graphs", exact: true })
    .click();
  console.log("Waiting for held version list");
  await seen;
  const view = page.getByRole("region", {
    name: "Planned and existing system",
  });
  await expect(view).toContainText("Loading retained versions");
  await expect(
    view.getByRole("heading", { name: "Start with the plan", exact: true }),
  ).toHaveCount(0);
  console.log("Version loading state checked");
  release();
  const plan = view.getByRole("region", { name: "Plan version selector" }),
    code = view.getByRole("region", { name: "Code version selector" });
  const list = view.getByRole("list", { name: "System records" });
  console.log("Loading current graph");
  await expect(list).toContainText("Current requirement 24");
  await plan
    .getByLabel("Find a plan checkpoint", { exact: true })
    .fill("Original intent");
  console.log("Searching old plan");
  await plan
    .getByLabel("Plan at checkpoint", { exact: true })
    .selectOption(original.id);
  console.log("Selected old plan");
  await expect(list).toContainText("Original requirement");
  await code
    .getByLabel("Find a code version", { exact: true })
    .fill("Original code");
  await code
    .getByLabel("Code version", { exact: true })
    .selectOption({ label: "Original code" });
  await view
    .getByRole("button", { name: "Existing code", exact: true })
    .click();
  console.log("Selected old code");
  await expect(list).toContainText("Fail-fast stub");
  await code
    .getByLabel("Find a code version", { exact: true })
    .fill("Current code");
  await expect(code.getByRole("option", { name: /Current code/ })).toHaveCount(
    2,
  );
  await code
    .getByLabel("Code version", { exact: true })
    .selectOption(currentCode.id);
  await expect(
    code.getByRole("option", {
      name: new RegExp("Current code.*" + currentCode.id.slice(0, 8)),
    }),
  ).toHaveCount(1);
  console.log("Selected current code");
  await expect(list).toContainText("Body present");
  await plan.getByLabel("Find a plan checkpoint", { exact: true }).fill("");
  await plan
    .getByLabel("Checkpoint type", { exact: true })
    .selectOption("links");
  await expect(plan.getByRole("status")).toHaveText("1–1 of 1");
  await expect(
    plan.getByLabel("Plan at checkpoint", { exact: true }),
  ).toHaveValue(original.id);
  await expect(plan).toContainText("selected outside this filtered page");
  assert.deepEqual(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations.map((v) => v.id),
    [],
  );
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/version-search-narrow.png"),
    fullPage: true,
  });
  assert.deepEqual(await readFile(db), before);
  console.log(
    "Search finds an older plan beyond the first page; plan/code searches are independent, categories do not change selection, loading is honest, and reads preserve the database. Axe and narrow layout pass.",
  );
} catch (error) {
  console.error(
    await page
      ?.locator("body")
      .innerText()
      .catch(() => null),
  );
  await page
    ?.screenshot({
      path: browserEvidence(
        "evidence/product-audit/version-search-failure.png",
      ),
      fullPage: true,
    })
    .catch(() => {});
  throw error;
} finally {
  release?.();
  store?.close();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
