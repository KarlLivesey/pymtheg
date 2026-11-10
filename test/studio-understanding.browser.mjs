import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
// Entire browser lifecycle must run through pc-tools headless.
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-understanding-"));
let app, browser;
try {
  const original =
    'import "library.pym";\nflow main() -> Unit { call save(true); }\n';
  await writeFile(join(root, "main.pym"), original);
  await writeFile(join(root, "library.pym"), "op save(amount: Nat) -> Unit;\n");
  app = await startStudio({ path: join(root, "main.pym") });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(app.url);
  await expect(
    page.getByText("This value does not match the required type", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".finding-why")).toContainText("caller");
  await page.getByText("What to do next & evidence", { exact: true }).click();
  await expect(page.locator(".finding-details")).toContainText(
    "Compare the argument",
  );
  await mkdir(browserEvidence("evidence/rework"), { recursive: true });
  await page.screenshot({
    path: browserEvidence("evidence/rework/finding-explanation.png"),
    fullPage: true,
  });
  await page
    .locator(".finding-details")
    .getByRole("button", { name: /library.pym/ })
    .click();
  await expect(page.locator(".current-file")).toContainText("library.pym");
  await expect(page.locator(".cm-content")).toContainText("amount: Nat");
  await page
    .locator(".file-list")
    .getByRole("button", { name: /main.pym/ })
    .click();
  await expect(page.locator(".cm-content")).toContainText("save(true)");
  await page.locator(".cm-content").press("ControlOrMeta+a");
  await page.keyboard.insertText(original.replace("save(true)", "save(1)"));
  await page.getByRole("button", { name: /Check design/ }).click();
  await expect(page.locator(".finding-card")).toHaveCount(0);
  if ((await readFile(join(root, "main.pym"), "utf8")) !== original)
    throw Error("Unsaved correction wrote to disk");
  await page.getByRole("button", { name: "Structure", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Component dependencies" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Explore main", exact: true }).click();
  await expect(
    page.getByText("How main fits into the design", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Explore save", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect agent", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("mcpServers");
  await expect(page.getByRole("dialog")).toContainText(root);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await mkdir(browserEvidence("evidence/rework"), { recursive: true });
  await page.screenshot({
    path: browserEvidence("evidence/rework/checked-design.png"),
    fullPage: true,
  });
  console.log(
    "Human workflow: understand mismatch, inspect declaration, correct unsaved source, recheck, and find real MCP configuration passed.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
