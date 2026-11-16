// SPDX-License-Identifier: MIT
import {
  chromium,
  firefox,
  webkit,
  expect as baseExpect,
} from "@playwright/test";
import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { browserLaunchOptions } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
const engine = process.env.PYM_TEST_ENGINE ?? "chromium";
// esbuild is Go-based; respect the helper's single-core process/thread budget.
process.env.GOMAXPROCS ??= "1";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-virtual-reader-"));
const source = "flow quote(quantity: Nat) -> Bool { return quantity > 0; }\n";
let app, browser, page;
const evidence = {
  engine,
  scope:
    "Guidepup virtual screen-reader navigation plus real browser accessibility-tree checks. Not a human or native OS screen-reader assessment.",
  library: "@guidepup/virtual-screen-reader@0.33.0",
  stages: [],
};
try {
  await writeFile(join(root, "main.pym"), source);
  app = await startStudio({ path: root });
  browser = await { chromium, firefox, webkit }[engine].launch(
    browserLaunchOptions(engine),
  );
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  const bundled = await build({
    entryPoints: [
      "node_modules/@guidepup/virtual-screen-reader/lib/esm/index.browser.js",
    ],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "HeadlessReader",
    platform: "browser",
    target: "es2022",
  });
  await page.evaluate(
    bundled.outputFiles[0].text + ";window.reader=HeadlessReader.virtual;",
  );
  async function read(stage) {
    const spoken = await page.evaluate(async () => {
      await window.reader.stop();
      await window.reader.start({ container: document.body });
      const seen = new Map();
      for (let i = 0; i < 900; i++) {
        const phrase = await window.reader.lastSpokenPhrase();
        const node = window.reader.activeNode;
        if (phrase === "end of document")
          return window.reader.spokenPhraseLog();
        const previous = seen.get(node) ?? new Set();
        // Modal navigation intentionally cycles within its dialog instead of
        // reaching the outer document's end marker.
        if (previous.has(phrase)) return window.reader.spokenPhraseLog();
        previous.add(phrase);
        seen.set(node, previous);
        await window.reader.next();
      }
      throw Error(
        "Virtual reading exceeded its 900-item bound; last=" +
          JSON.stringify((await window.reader.spokenPhraseLog()).slice(-20)) +
          " node=" +
          window.reader.activeNode?.nodeName,
      );
    });
    evidence.stages.push({ stage, spoken });
    console.log("Read", stage, spoken.length);
    return spoken.join("\n");
  }
  async function act(name, selector = "button", type) {
    const result = await page.evaluate(
      async ({ name, selector, type }) => {
        await window.reader.stop();
        await window.reader.start({ container: document.body });
        for (let i = 0; i < 900; i++) {
          const node = window.reader.activeNode;
          if (node instanceof HTMLElement && node.matches(selector)) {
            const label =
              node.getAttribute("aria-label") ??
              (node.labels?.[0]?.textContent ?? node.textContent ?? "").trim();
            if (
              label === name ||
              (selector === "input" && label.includes(name))
            ) {
              const announcement = await window.reader.lastSpokenPhrase();
              await window.reader.act();
              if (type !== undefined) {
                await window.reader.press("Control+a");
                await window.reader.press("Backspace");
                await window.reader.type(type);
              }
              return { name, announcement, steps: i, value: node.value };
            }
          }
          if ((await window.reader.lastSpokenPhrase()) === "end of document")
            break;
          await window.reader.next();
        }
        throw Error(
          "Virtual reader could not reach " +
            name +
            "; last announcements: " +
            JSON.stringify((await window.reader.spokenPhraseLog()).slice(-15)),
        );
      },
      { name, selector, type },
    );
    evidence.stages.push({ stage: "act", ...result });
    console.log("Act", JSON.stringify(result));
    if (type !== undefined)
      assert.equal(
        result.value,
        type,
        "Reader-driven typing changes the intended value",
      );
  }
  const initial = await read("Initial design");
  assert.match(initial, /Edit inputs and output/);
  await act("Edit inputs and output");
  const dialog = page.getByRole("dialog", {
    name: "Inputs and output for quote",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const modal = await read("Interface modal");
  assert.match(modal, /Inputs and output for quote/);
  assert.match(modal, /Component name/);
  assert.match(modal, /Preview interface changes/);
  assert.match(modal, /Apply to editor and check/);
  assert.ok(
    !modal.includes("Project setup"),
    "Inert background must not enter virtual reading order",
  );
  const ax = await page._channel.accessibilitySnapshot({
    interestingOnly: false,
  });
  function flatten(n) {
    return !n ? [] : [n, ...(n.children ?? []).flatMap(flatten)];
  }
  const realTree = flatten(ax.rootAXNode);
  assert.ok(
    realTree.some(
      (n) => n.role === "dialog" && n.name === "Inputs and output for quote",
    ),
  );
  assert.ok(
    !realTree.some((n) => n.role === "button" && n.name === "Project setup"),
    "Native browser accessibility tree must also exclude background controls",
  );
  await act("Component name", "input", "quoteReady");
  await expect(
    dialog.getByLabel("Component name", { exact: true }),
  ).toHaveValue("quoteReady");
  await act("Preview interface changes");
  await expect(
    dialog.getByRole("region", { name: "Interface changes", exact: true }),
  ).toContainText("quoteReady");
  const preview = await read("Readable preview");
  assert.match(preview, /quoteReady/);
  await act("Apply to editor and check");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("quoteReady");
  await expect(page.locator(".statusbar")).toContainText("completed");
  assert.equal(
    await page.locator(":focus").evaluate((n) => !!n.closest(".cm-content")),
    true,
    "Applying returns keyboard focus to the source editor",
  );
  await act("Blocks");
  await expect(
    page.getByLabel("Visual block editor", { exact: true }),
  ).toBeVisible();
  await act("Add to this design");
  const declaration = page.getByRole("dialog", {
    name: "Add to this design",
    exact: true,
  });
  await expect(declaration).toBeVisible();
  const creation = await read("New declaration choices");
  assert.match(creation, /External operation/);
  assert.match(creation, /Data shape/);
  assert.ok(!creation.includes("Project setup"));
  await act("Close");
  await expect(declaration).toHaveCount(0);
  assert.equal(
    await readFile(join(root, "main.pym"), "utf8"),
    source,
    "Virtual reader edits remain unsaved until explicit Save",
  );
  evidence.browserVersion = browser.version();
  evidence.status = "passed";
  await writeFile(
    browserEvidence(
      "evidence/product-audit/virtual-reader-" + engine + ".json",
    ),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      engine,
      version: browser.version(),
      result:
        "Virtual reading order, modal isolation, native accessibility cross-check, reader-driven edit/preview/apply, source focus and unchanged disk pass.",
    }),
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
