import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-arch-recovery-"));
let app, browser;
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
  const form = page.getByRole("region", { name: "Planning record" });
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Open architecture workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add planning record", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", {
      name: "Restore architecture draft",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add planning record", exact: true })
    .click();
  const stored = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/architecture/draft") &&
      r.request().method() === "POST" &&
      r.request().postDataJSON()?.draft?.item?.title === "Unfinished idea",
  );
  await form.getByLabel("Short title").fill("Unfinished idea");
  const response = await stored;
  if (!response.ok()) throw Error(await response.text());
  await expect(
    page.getByText("Draft saved for recovery", { exact: true }),
  ).toBeVisible();
  await app.close();
  app = await startStudio({ path: root });
  await page.goto(app.url);
  await expect(
    page.getByRole("heading", { name: "Architecture workspace", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/requirement: Unfinished idea\./)).toBeVisible();
  const addRecord = page.getByRole("button", {
    name: "Add planning record",
    exact: true,
  });
  await expect(addRecord).toBeDisabled();
  await expect(addRecord).toHaveAttribute(
    "aria-describedby",
    "planning-action-help",
  );
  await expect(page.locator("#planning-action-help")).toContainText(
    "Restore or discard",
  );
  await expect(
    page.getByText(/Use Add planning record to describe/),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Restore architecture draft", exact: true })
    .click();
  await expect(form.getByLabel("Short title")).toHaveValue("Unfinished idea");
  await expect(form.getByLabel("What and why")).toHaveValue("");
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Architecture workspace", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".architecture-row")).toContainText(
    "Unfinished idea",
  );
  await expect(
    page.getByRole("button", { name: "Restore architecture draft" }),
  ).toHaveCount(0);
  await page
    .locator(".architecture-row")
    .filter({ hasText: "Unfinished idea" })
    .click();
  await page
    .getByRole("button", { name: "Edit planning record", exact: true })
    .click();
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Add planning record", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Restore architecture draft" }),
  ).toHaveCount(0);
  console.log(
    "Architecture recovery: incomplete input persisted, restored across server restart, explicitly committed and draft cleared.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
