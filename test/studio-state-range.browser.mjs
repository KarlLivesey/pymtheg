import { browserExecutable } from "./browser-launch.mjs";
import {
  chromium,
  firefox,
  webkit,
  expect as baseExpect,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { waitForRecovery } from "./recovery-ack.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-range-ui-"));
const original = `machine Counter {
  state count: Nat in 0..2 = 0;
  event inc when count < 4 { count = count + 1; }
  invariant safe = count <= 4;
}\n`;
const engine = process.env.PYM_TEST_ENGINE ?? "chromium";
let app, browser;
try {
  await writeFile(join(root, "main.pym"), original);
  await writeFile(
    join(root, "other.pym"),
    "op use(n: Nat) -> Unit requires n > 0 effects(remote.Net);\nflow caller(n: Nat) -> Unit effects(remote.Net) {\n  call use(n);\n  return unit;\n}\n",
  );
  app = await startStudio({ path: root });
  browser = await { chromium, firefox, webkit }[engine].launch({
    headless: true,
    executablePath: browserExecutable(engine),
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  ).newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  await blocks.locator(".visual-definition > summary").click();
  const form = page.getByRole("form", {
    name: "Range for Counter.count",
    exact: true,
  });
  const min = form.getByLabel("Minimum for Counter.count", { exact: true });
  const max = form.getByLabel("Maximum for Counter.count", { exact: true });
  await page.getByLabel("Behaviour entry point").selectOption("Counter");
  await page.getByRole("button", { name: /Simulate/ }).click();
  await expect(page.getByText("B011", { exact: true })).toBeVisible();
  console.log("initial range counterexample visible");
  await min.fill("-");
  await waitForRecovery(app, (r) => r.context.rangeDrafts?.[0]?.min, "-");
  await expect(page.locator(".cm-content")).toContainText("0..2");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  await expect(min).toHaveValue("-");
  await page
    .getByRole("navigation", { name: "Source files" })
    .getByRole("button", { name: /other.pym/ })
    .click();
  await expect(
    page.getByRole("region", { name: "Unfinished range edits" }),
  ).toContainText("Counter.count");
  await page
    .getByRole("button", { name: "Open range for Counter.count", exact: true })
    .click();
  await expect(min).toHaveValue("-");
  console.log("draft retained across files before restart");
  await app.close();
  app = await startStudio({ path: root });
  await page.goto(app.url);
  // Recovered drafts automatically open the relevant definition, without positional IDs.
  console.log("restarted");
  await expect(min).toBeVisible();
  await expect(min).toHaveValue("-");
  await expect(page.locator(".statusbar")).toContainText("Draft saved locally");
  console.log("recovery complete");
  await min.fill("5");
  await max.fill("4");
  await expect(form).toContainText("minimum must not exceed maximum");
  await expect(
    form.getByRole("button", { name: "Apply range", exact: true }),
  ).toBeDisabled();
  await min.fill("-1");
  await expect(form).toContainText("Nat values cannot be negative");
  await min.fill("0");
  console.log("valid range entered");
  await max.press("Enter");
  await expect(page.locator(".cm-content")).toContainText("0..4");
  assert.equal(
    await page.evaluate(
      () => !!document.activeElement?.closest(".block-editor"),
    ),
    true,
    "Range Apply must keep keyboard focus in Blocks while its check is pending",
  );
  await expect(blocks.getByRole("status")).toContainText(
    "Blocks match the current source",
  );
  await expect
    .poll(
      () =>
        page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
      { timeout: 0 },
    )
    .toBe("Minimum for Counter.count");
  await page.getByLabel("Behaviour entry point").selectOption("Counter");
  await page.getByRole("button", { name: /Simulate/ }).click();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(
    page.getByText("No violation in sampled runs", { exact: true }),
  ).toBeVisible();
  console.log("applied range passes the same bounded simulation");
  await waitForRecovery(app, (r) => r.context.rangeDrafts?.length, 0);
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  await blocks.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("0..2");
  await expect(max).toHaveValue("2");
  console.log("undo complete");
  await max.fill("8");
  await waitForRecovery(app, (r) => r.context.rangeDrafts?.[0]?.max, "8");
  await writeFile(join(root, "main.pym"), original.replace("0..2", "0..6"));
  await page
    .getByRole("button", { name: "Open range for Counter.count", exact: true })
    .click();
  console.log("reopened external edit");
  await expect(form).toContainText("This state changed since you started");
  await expect(max).toHaveValue("8");
  await form
    .getByRole("button", { name: "Restart with current range", exact: true })
    .click();
  await expect(max).toHaveValue("6");
  await max.fill("7");
  await page.setViewportSize({ width: 390, height: 844 });
  await form
    .getByRole("button", { name: "Apply range", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    form.getByRole("button", { name: "Apply range", exact: true }),
  ).toBeInViewport();
  const axe = await new AxeBuilder({ page })
    .include(".state-range-editor")
    .analyze();
  assert.deepEqual(axe.violations, []);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/state-range-narrow.png"),
    fullPage: true,
  });
  await min.fill("1");
  await expect(form).toContainText(
    "current starting value 0 is outside these bounds",
  );
  const applyRange = form.getByRole("button", {
    name: "Apply range",
    exact: true,
  });
  await applyRange.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".cm-content")).toContainText("1..7");
  assert.equal(
    await page.evaluate(
      () => !!document.activeElement?.closest(".block-editor"),
    ),
    true,
  );
  await expect(blocks.locator(".visual-status")).toContainText(
    "Blocks match the current source",
  );
  await expect(min).toBeFocused();
  await page.getByRole("button", { name: "Findings", exact: true }).click();
  await expect(page.getByText("B012", { exact: true })).toBeVisible();
  const initial = blocks.getByLabel("Initial value", { exact: true });
  await initial.fill("1");
  await initial.press("Enter");
  await expect(page.getByText("B012", { exact: true })).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Source files" })
    .getByRole("button", { name: /other.pym/ })
    .click();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(
    page
      .locator(".obligations")
      .filter({ hasText: "Establish use precondition" }),
  ).toContainText("other.pym:3:3");
  console.log(
    "Located initial-domain error, corrected starting value, Space-activated range focus and pending-call line/column verified.",
  );
  console.log(
    `${engine}: incomplete range survives Text/Blocks and restart; invalid ranges keep source; Enter applies both bounds, one Undo restores; stale state requires explicit reset; narrow form has no axe violation.`,
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
