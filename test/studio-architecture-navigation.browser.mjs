import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-arch-navigation-"));
let app, browser, release;
try {
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1050 },
  });
  await page.goto(app.url);
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await page
    .getByRole("button", { name: "Add planning record", exact: true })
    .click();
  let started;
  const ready = new Promise((r) => (started = r)),
    gate = new Promise((r) => (release = r));
  await page.route("**/api/architecture/draft", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON()?.draft?.item?.title ===
        "Pending across views"
    ) {
      started();
      await gate;
    }
    await route.continue();
  });
  const persisted = page
    .waitForResponse(
      (r) =>
        r.url().endsWith("/api/architecture/draft") &&
        r.request().method() === "POST" &&
        r.request().postDataJSON()?.draft?.item?.title ===
          "Pending across views",
    )
    .catch(() => null);
  await page.getByLabel("Short title").fill("Pending across views");
  await ready;
  await page
    .getByRole("button", { name: "Design editor", exact: true })
    .click();
  await page.getByRole("button", { name: "Architecture", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Architecture workspace", exact: true }),
  ).toBeVisible();
  assert.equal(
    await page.getByLabel("Short title").count(),
    1,
    "Changing workspace must preserve the unfinished form while its save is held",
  );
  await expect(page.getByLabel("Short title")).toHaveValue(
    "Pending across views",
  );
  release();
  const response = await persisted;
  assert.ok(response);
  assert.equal(response.ok(), true);
  await expect(
    page.getByText("Draft saved for recovery", { exact: true }),
  ).toBeVisible();
  console.log(
    "Architecture navigation: unfinished form and pending save survive editor/planner switches using a held request handshake.",
  );
} finally {
  release?.();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
