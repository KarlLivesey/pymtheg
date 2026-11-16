// SPDX-License-Identifier: MIT
import { browserExecutable } from "./browser-launch.mjs";
import {
  chromium,
  firefox,
  webkit,
  expect as baseExpect,
} from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const engine = process.env.PYM_BROWSER_ENGINE ?? "chromium",
  engines = { chromium, firefox, webkit },
  expect = baseExpect.configure({ timeout: 0 });
assert.ok(Object.hasOwn(engines, engine));
const root = await mkdtemp(join(tmpdir(), "pym-header-"));
let app, browser;
try {
  await writeFile(
    join(root, "design.pym"),
    "flow main() -> Bool { return true; }",
  );
  app = await startStudio({
    path: join(root, "design.pym"),
    ...(process.env.PYM_LAYOUT_BASELINE
      ? { assets: process.env.PYM_LAYOUT_BASELINE }
      : {}),
  });
  browser = await engines[engine].launch({
    headless: true,
    executablePath:
      process.env.PYM_BROWSER_EXECUTABLE ?? browserExecutable(engine),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  const visibleEditor = () =>
    page.locator(".cm-scroller").evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      let top = Math.max(bounds.top, 0),
        bottom = Math.min(bounds.bottom, innerHeight);
      for (
        let parent = el.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (
          /(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)
        ) {
          const b = parent.getBoundingClientRect();
          top = Math.max(top, b.top);
          bottom = Math.min(bottom, b.bottom);
        }
      }
      return {
        height: bounds.height,
        visible: Math.max(0, bottom - top),
        line: parseFloat(
          getComputedStyle(el.querySelector(".cm-line")).lineHeight,
        ),
      };
    });

  page.on("pageerror", (error) => console.error("Page error:", String(error)));
  await page.goto(app.url);
  await expect(page.locator(".connection.online")).toHaveText("Connected");
  for (let width = 320; width <= 1440; width += 20) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      0,
      `Connected workspace overflows at ${width}px`,
    );
  }
  for (const [width, height] of [
    [1366, 657],
    [1280, 650],
    [1280, 600],
    [1024, 600],
    [1024, 768],
    [921, 844],
    [920, 844],
    [800, 600],
    [768, 600],
    [720, 500],
    [800, 1000],
    [768, 1024],
    [768, 844],
    [640, 844],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator(".cm-content").focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await expect(page.locator(".interface-hint")).toBeVisible();
    if (width === 768 || width === 1280) {
      const details = page.locator(".interface-hint details");
      if (!(await details.evaluate((el) => el.open)))
        await details.locator("summary").click();
      await expect(details).toHaveAttribute("open", "");
    }
    // Clipping ancestors and the viewport matter; a tall off-screen editor
    // does not supply usable visible lines. Do not let focus hide the defect.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      for (const el of document.querySelectorAll("*"))
        if (el.scrollTop) el.scrollTop = 0;
    });
    // On stacked layouts the page/work area scrolls by design. Reach the text
    // editing surface before measuring it; desktop checks retain the default top.
    if (width <= 920)
      await page
        .locator(".text-editor-container")
        .evaluate((el) => el.scrollIntoView({ block: "start" }));
    const measure = await visibleEditor();
    console.log(JSON.stringify({ width, viewportHeight: height, ...measure }));
    assert.ok(
      measure.visible >= 10 * measure.line,
      JSON.stringify({ width, viewportHeight: height, ...measure }),
    );
    await page.locator(".cm-content").focus();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(`// viewport edit ${width}x${height}`);
    await expect(page.locator(".cm-content")).toContainText("// viewport edit");
    const savedResponse = page.waitForResponse(
      (r) => r.url().includes("/api/save") && r.request().method() === "POST",
    );
    await page.keyboard.press("ControlOrMeta+s");
    assert.equal((await savedResponse).status(), 200);
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    assert.ok(
      (await readFile(join(root, "design.pym"), "utf8")).includes(
        `// viewport edit ${width}x${height}`,
      ),
    );
    await page.evaluate(() => {
      scrollTo(0, 0);
      for (const el of document.querySelectorAll("*"))
        if (el.scrollTop) el.scrollTop = 0;
    });
    if (width <= 920)
      await page
        .locator(".text-editor-container")
        .evaluate((el) => el.scrollIntoView({ block: "start" }));
    const afterSave = await visibleEditor();
    assert.ok(
      afterSave.visible >= 10 * afterSave.line,
      JSON.stringify({
        width,
        viewportHeight: height,
        phase: "after-save",
        ...afterSave,
      }),
    );
    const analysis = page.locator("#analysis-content");
    await page
      .getByRole("navigation", { name: "Analysis views" })
      .getByRole("button", { name: "Structure", exact: true })
      .click();
    if (width <= 920) {
      await expect(analysis).toBeFocused();
      const hit = await analysis.evaluate((el) => {
        const b = el.getBoundingClientRect();
        const target = document.elementFromPoint(b.left + 10, b.top + 10);
        return (
          b.top >= -1 &&
          b.top < innerHeight &&
          !!target &&
          (el === target || el.contains(target))
        );
      });
      assert.ok(hit, `Analysis occluded at ${width}x${height}`);
    }
  }
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page
    .getByRole("button", { name: "Add planning record", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Planning record" }),
  ).toBeVisible();
  for (const width of Array.from({ length: 57 }, (_, i) => 320 + i * 20)) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.evaluate(() => {
      const header = document.querySelector(".topbar").getBoundingClientRect(),
        main = document.querySelector("main").getBoundingClientRect();
      return {
        headerBottom: header.bottom,
        mainTop: main.top,
        overflow: document.documentElement.scrollWidth > innerWidth,
        actionRows: new Set(
          [...document.querySelectorAll(".top-actions button")].map((el) =>
            Math.round(el.getBoundingClientRect().top),
          ),
        ).size,
        controls: [
          ...document.querySelectorAll(
            ".topbar button,.topbar .brand,.topbar .connection",
          ),
        ].map((el) => el.getBoundingClientRect().bottom),
      };
    });
    if (width >= 980)
      assert.equal(layout.actionRows, 1, JSON.stringify({ width, ...layout }));
    assert.equal(layout.overflow, false, JSON.stringify({ width, ...layout }));
    assert.ok(
      layout.controls.every((bottom) => bottom <= layout.headerBottom + 1),
      JSON.stringify({ width, ...layout }),
    );
    assert.ok(
      layout.mainTop >= layout.headerBottom - 1,
      JSON.stringify({ width, ...layout }),
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/header-" + engine + ".png"),
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      engine,
      version: browser.version(),
      result:
        "Header controls fit a 320–1440px width sweep; text editing and unoccluded analysis pass laptop/tablet sizes",
    }),
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
