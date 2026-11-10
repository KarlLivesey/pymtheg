import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
// Run entirely through pc-tools headless; readiness comes from rendered results.
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
for (const width of [1440, 768, 390]) {
  const root = await mkdtemp(join(tmpdir(), "pym-regen-ui-")),
    expect = baseExpect.configure({ timeout: 0 });
  let app, browser;
  try {
    const original =
      "op decide(value: String) -> Bool;" +
      (width === 1440 ? "" : "\nflow f(n: Int) -> Unit { return unit; }\n");
    await writeFile(join(root, "main.pym"), original);
    app = await startStudio({ path: join(root, "main.pym") });
    browser = await browserType().launch({
      headless: true,
      executablePath: browserExecutable(),
    });
    const page = await browser.newPage({
      viewport: { width, height: 844 },
    });
    page.setDefaultTimeout(0);
    let releaseInitial, acknowledgeInitial;
    const initialGate = new Promise((resolve) => {
      releaseInitial = resolve;
    });
    const initialRequested = new Promise((resolve) => {
      acknowledgeInitial = resolve;
    });
    let firstRequest = true;
    const gateInitialCheck = async (route) => {
      if (firstRequest) {
        firstRequest = false;
        acknowledgeInitial();
        await initialGate;
      }
      await route.continue();
    };
    await page.route("**/api/run", gateInitialCheck);
    await page.goto(app.url);
    const tabs = page.getByRole("navigation", { name: "Analysis views" });
    await expect(tabs).toBeVisible();
    await initialRequested;
    const beforeInitial = await tabs.boundingBox();
    releaseInitial();
    await expect(page.locator(".summary-strip")).toBeVisible();
    const afterInitial = await tabs.boundingBox();
    assert.equal(
      afterInitial.y,
      beforeInitial.y,
      "Initial results must not move the analysis tabs",
    );
    assert.equal(afterInitial.x, beforeInitial.x);
    await page.unroute("**/api/run", gateInitialCheck);
    if (width === 390) {
      const region = page.locator("#analysis-content");
      const activate = async (label, key) => {
        const button = tabs.getByRole("button", { name: label, exact: true });
        await expect(button).toHaveAttribute(
          "aria-controls",
          "analysis-content",
        );
        if (key) {
          await button.focus();
          await button.press(key);
        } else await button.click();
        await expect(region).toHaveAttribute("aria-label", `${label} analysis`);
        await expect(region).toBeFocused();
        await expect(region).toBeInViewport();
        const bounds = await region.boundingBox();
        assert.ok(bounds.y >= -1 && bounds.y < 844, JSON.stringify(bounds));
      };
      await activate("Structure");
      await activate("History", "Enter");
      await activate("Code", "Space");
      // The same selected tab also returns the reader to its content.
      await activate("Code");
      console.log(
        "390px tab activation reveals and focuses the selected content (pointer, Enter, Space and current tab).",
      );
    }

    await page.getByRole("button", { name: "Code", exact: true }).click();
    await expect(page.locator(".scaffold-export")).toBeVisible();
    await expect(page.locator(".history-card")).toHaveCount(0);
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(page.locator(".scaffold-export")).toHaveCount(0);
    await expect(page.locator(".history-card").first()).toBeVisible();
    await page.getByRole("button", { name: "Code", exact: true }).click();
    if (width !== 1440) {
      const history = page.getByRole("button", {
        name: "History",
        exact: true,
      });
      await history.focus();
      await history.press("Enter");
      await expect(history).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Code", exact: true }).click();
      await expect(page.locator(".scaffold-export")).toBeVisible();
      assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
      console.log(
        `Initial report keeps navigation fixed; pointer/keyboard tabs pass at ${width}px.`,
      );
      continue;
    }
    await page.getByLabel("Output purpose").selectOption("contracts");
    await page
      .getByRole("button", {
        name: "Preview types and signatures",
        exact: true,
      })
      .click();
    await expect(page.locator(".scaffold-preview")).toContainText(
      "export interface PymthegContracts",
    );
    await expect(page.locator(".scaffold-preview")).not.toContainText(
      "throw new",
    );
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", {
        name: "Save contract comparison baseline",
        exact: true,
      })
      .click();
    const file = await download,
      baseline = join(root, "baseline.json");
    await file.saveAs(baseline);
    await page
      .getByLabel("Compare with a saved contract baseline")
      .setInputFiles(baseline);
    await expect(
      page.getByRole("region", { name: "Contract changes" }),
    ).toContainText("Declared contracts match");
    await page.locator(".cm-content").press("ControlOrMeta+a");
    await page.keyboard.insertText("op decide(value: String) -> String;");
    const stale = page.getByText(
      "This result is from an earlier buffer revision.",
      { exact: false },
    );
    await expect(stale).toBeVisible();
    await page.getByRole("button", { name: /Check design/ }).click();
    await expect(stale).toHaveCount(0);
    // The new run replaces the old report; wait on its visible signature, not a timer.
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Preview types and signatures",
        exact: true,
      })
      .click();
    await expect(page.locator(".scaffold-preview")).toContainText(
      "decide(value: string): string",
    );
    await page
      .getByLabel("Compare with a saved contract baseline")
      .setInputFiles(baseline);
    const changes = page.getByRole("region", { name: "Contract changes" });
    await expect(changes).toContainText("Changed: main.pym#decide");
    await expect(changes).toContainText("Output type: Bool → String");
    await changes
      .getByText("Changed: main.pym#decide", { exact: true })
      .click();
    const rawData = changes.getByText("Inspect exact contract data", {
      exact: true,
    });
    await rawData.click();
    await expect(changes).toContainText('"Bool"');
    await expect(changes).toContainText('"String"');
    await rawData.click();
    await changes
      .getByText("Output type: Bool → String", { exact: true })
      .scrollIntoViewIfNeeded();
    assert.equal(
      await readFile(join(root, "main.pym"), "utf8"),
      original,
      "Preview/check never writes source",
    );
    await page.screenshot({
      path: browserEvidence(
        "evidence/product-audit/post-eighth/contract-drift.png",
      ),
      fullPage: true,
    });
    console.log(
      "Contracts-only preview, saved baseline and return-type drift visible; source unchanged.",
    );
  } finally {
    await browser?.close();
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
}
