import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-code-file-picker-"));
let app, browser;
try {
  const store = await ArchitectureStore.open(root);
  store.save("Plan", "fixture", [
    {
      path: "plan.json",
      text: JSON.stringify({
        schema: "pymtheg.plan/v1",
        items: [{ ...newPlanItem("Use existing code"), id: "R1" }],
      }),
    },
  ]);
  store.close();
  await mkdir(join(root, "src"));
  const source = "export function main(): boolean { return true; }";
  await writeFile(join(root, "main.ts"), source);
  for (let index = 0; index < 25; index++)
    await writeFile(
      join(root, "src", `part${String(index).padStart(2, "0")}.ts`),
      `export function part${index}(): number { return ${index}; }`,
    );
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
  let captures = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/implementation/observe")) captures++;
  });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Plan & code graphs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Capture code version", exact: true })
    .click();
  await page.evaluate(() => {
    window.__pymSubmitCount = 0;
    document
      .querySelector(".implementation-capture")
      .addEventListener("submit", () => {
        window.__pymSubmitCount++;
      });
  });
  const picker = page.getByRole("group", {
    name: "Choose code files",
    exact: true,
  });
  await picker.getByRole("checkbox", { name: "main.ts", exact: true }).check();
  await picker.getByRole("button", { name: "Next files", exact: true }).click();
  await picker
    .getByRole("checkbox", { name: "src/part24.ts", exact: true })
    .check();
  const files = page.getByLabel(
    "Source files, one project-relative path per line",
  );
  await expect(files).toHaveValue("main.ts\nsrc/part24.ts");
  await picker.getByLabel("Find code files", { exact: true }).fill("main");
  await expect(
    picker.getByRole("checkbox", { name: "main.ts", exact: true }),
  ).toBeChecked();
  await picker.getByLabel("Find code files", { exact: true }).press("Enter");
  assert.equal(
    await page.evaluate(() => window.__pymSubmitCount),
    0,
    "Search Enter must not submit the capture form",
  );
  assert.equal(captures, 0, "Searching must not capture a code version");
  await writeFile(join(root, "new.ts"), "export const added = true;");
  await picker.getByLabel("Find code files", { exact: true }).fill("new.ts");
  await expect(picker).toContainText("No matching code files");
  await picker
    .getByRole("button", { name: "Refresh file list", exact: true })
    .click();
  await expect(
    picker.getByRole("checkbox", { name: "new.ts", exact: true }),
  ).toBeVisible();
  await expect(files).toHaveValue("main.ts\nsrc/part24.ts");
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    audit.violations.map((entry) => ({
      id: entry.id,
      nodes: entry.nodes.map((node) => node.target),
    })),
    [],
  );
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/code-file-picker.png"),
    fullPage: true,
  });
  const captured = page.waitForResponse((response) =>
    response.url().endsWith("/api/implementation/observe"),
  );
  await page
    .getByRole("button", { name: "Read files and retain version", exact: true })
    .click();
  assert.equal((await captured).status(), 200);
  await expect(
    page.getByRole("region", {
      name: "Planned and existing system",
      exact: true,
    }),
  ).toContainText("Code version retained");
  assert.equal(captures, 1);
  assert.equal(await readFile(join(root, "main.ts"), "utf8"), source);
  console.log(
    "Code candidates page and filter without capture; refresh sees new files and retains selection. Explicit capture reads the chosen files only; axe passes and source is unchanged.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
