import { browserExecutable, browserType } from "./browser-launch.mjs";
import { formatSource } from "../dist/language/format.js";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-block-focus-"));
let app, browser;
try {
  await writeFile(
    join(root, "main.pym"),
    'flow main() -> Unit {\n unknown "first";\n unknown "second";\n unknown "third";\n return unit;\n}',
  );
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await (
    await browser.newContext({ viewport: { width: 800, height: 1000 } })
  ).newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".cm-content")).toContainText("second");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const blocks = page.getByLabel("Visual block editor", { exact: true });
  const move = blocks
    .getByRole("button", { name: "Move Open question up", exact: true })
    .nth(1);
  await move.focus();
  await move.press("Enter");
  await expect(
    blocks.getByLabel("What still needs deciding?", { exact: true }).nth(0),
  ).toHaveValue("second");
  await expect
    .poll(() => page.locator(":focus").getAttribute("data-block-id"), {
      message: "Moving a block must keep keyboard focus in that block",
    })
    .toBe("declaration/0/body/0");
  const remove = blocks
    .getByRole("button", { name: "Remove Open question", exact: true })
    .nth(0);
  await remove.focus();
  await remove.press("Enter");
  const first = blocks
    .getByLabel("What still needs deciding?", { exact: true })
    .first();
  await expect(first).toHaveValue("first");
  await expect(first).toBeFocused();
  await blocks.getByText("Add a step", { exact: true }).click();
  const add = blocks.getByRole("button", {
    name: "Open question",
    exact: true,
  });
  await add.focus();
  await add.press("Enter");
  const inserted = blocks
    .getByLabel("What still needs deciding?", { exact: true })
    .last();
  await expect(inserted).toHaveValue("What should happen here?");
  await expect(inserted).toBeFocused();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/save") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  assert.equal((await saved).status(), 200);
  const written = await readFile(join(root, "main.pym"), "utf8");
  assert.equal(
    written,
    formatSource("main.pym", written),
    "Block edits save canonical formatted source",
  );
  let release, started;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const requested = new Promise((resolve) => {
    started = resolve;
  });
  await page.route("**/api/format", async (route) => {
    started();
    await held;
    await route.continue();
  });
  const formattedResponse = page.waitForResponse((r) =>
    r.url().endsWith("/api/format"),
  );
  await add.click();
  await requested;
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const editor = page.locator(".cm-content");
  await editor.fill(written + "// newer manual edit");
  release();
  await formattedResponse;
  await page.unroute("**/api/format");
  await expect(editor).toContainText("// newer manual edit");
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  await expect(editor).toContainText("// newer manual edit");
  console.log(
    "Keyboard move retains the moved card; removal focuses a remaining field; insertion focuses the new question. Focus never returns to the page logo.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
