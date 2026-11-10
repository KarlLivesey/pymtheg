import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const root = await mkdtemp(join(tmpdir(), "pym-stale-source-ui-")),
  expect = baseExpect.configure({ timeout: 0 });
let app, browser;
try {
  const file = join(root, "source.pym");
  await writeFile(file, "flow decide() -> Bool { return true; }");
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page
    .getByRole("button", { name: "Add planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  await form.getByLabel("Short title").fill("Keep my reviewed source");
  await form.getByRole("button", { name: "Link decide", exact: true }).click();
  await writeFile(file, "flow decide() -> Bool {\n  return true;\n}");
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form.getByRole("alert")).toContainText(
    "selected component or a dependency changed",
  );
  await expect(
    form.getByRole("region", { name: "Review conflicting edit" }),
  ).toHaveCount(0);
  const refreshed = page.waitForResponse(
    (r) =>
      r.url().includes("/api/architecture/source-contracts?") &&
      r.request().method() === "GET",
  );
  await form
    .getByRole("button", { name: "Refresh checked components", exact: true })
    .click();
  await refreshed;
  await expect
    .poll(async () =>
      form
        .getByRole("region", {
          name: "Source link source:source.pym#decide",
          exact: true,
        })
        .locator("pre")
        .first()
        .textContent(),
    )
    .toBe("flow decide() -> Bool {\n  return true;\n}");
  await expect(
    form.getByText("Checking saved source…", { exact: true }),
  ).toHaveCount(0);
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/stale-source-review-recovered.png",
    ),
    fullPage: true,
  });
  console.log(
    "A changed source choice preserves the plan draft, requests source review rather than an unrelated edit conflict, and saves after refresh without forcing a review acknowledgement.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
