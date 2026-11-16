// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Run only through pc-tools headless.
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { startStudio } from "../dist/studio/server.js";
import { writeFile, mkdir } from "node:fs/promises";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-a11y-"));
let browser, app, typedRoot;
try {
  await cp("examples", join(root, "examples"), { recursive: true });
  await mkdir(join(root, ".pymtheg"), { recursive: true });
  await cp(".pymtheg/settings.json", join(root, ".pymtheg/settings.json"));
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    globalThis.__pymCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      globalThis.__pymCspViolations.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
      });
    });
  });
  await page.goto(app.url);
  await expect(page.locator(".statusbar")).toContainText("completed");
  const results = [];
  for (const view of ["workspace", "structure", "scenario", "guide", "agent"]) {
    if (view !== "workspace")
      await page
        .getByRole("button", {
          name:
            view === "structure"
              ? "Structure"
              : view === "scenario"
                ? "Scenario"
                : view === "agent"
                  ? "Connect agent"
                  : /Guide/,
        })
        .click();
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    results.push({
      view,
      violations: audit.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => ({
          html: n.html,
          summary: n.failureSummary,
        })),
      })),
    });
    if (view === "structure")
      await page.getByRole("button", { name: "Findings", exact: true }).click();
    else if (view !== "workspace") await page.keyboard.press("Escape");
  }
  const originalScriptPolicy = await page.evaluate(
    () => globalThis.__pymCspViolations,
  );
  // A realistic first/current line must exercise the coloured type tokens.
  typedRoot = await mkdtemp(join(tmpdir(), "pym-a11y-typed-"));
  const typed = join(typedRoot, "typed.pym");
  await writeFile(typed, "op typed(value: Int) -> Bool;\n");
  await app.close();
  app = await startStudio({ path: typed });
  await page.goto(app.url);
  await expect(page.locator(".summary-strip")).toBeVisible();
  await expect(page.locator(".current-file strong")).toHaveText("typed.pym");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".cm-activeLine")).toContainText("Int");
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    results.push({
      view: `typed-current-line-${width}`,
      violations: audit.violations,
    });
  }
  await mkdir(browserEvidence("evidence/studio"), { recursive: true });
  await writeFile(
    browserEvidence("evidence/studio/accessibility.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  const scriptPolicy = [
    ...originalScriptPolicy,
    ...(await page.evaluate(() => globalThis.__pymCspViolations)),
  ];
  await writeFile(
    browserEvidence("evidence/studio/script-policy.json"),
    JSON.stringify(scriptPolicy, null, 2),
  );
  if (scriptPolicy.some((event) => event.blocked === "eval"))
    throw Error(
      "Studio attempted runtime code generation despite its no-eval CSP",
    );
  if (results.some((r) => r.violations.length))
    throw Error(JSON.stringify(results, null, 2));
  console.log(
    "WCAG 2/2.1 A/AA automated scan: workspace, structure, scenario, guide and agent connection have no violations.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
  if (typedRoot) await rm(typedRoot, { recursive: true, force: true });
}
