import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-large-sources-ui-"));
let app, browser;
try {
  await writeFile(
    join(root, "main.pym"),
    "flow healthy() -> Bool { return true; }",
  );
  await writeFile(
    join(root, "unrelated.pym"),
    "flow broken() -> Bool { return 1; }",
  );
  await writeFile(join(root, "latin1.pym"), Buffer.from([255, 254]));
  for (let i = 0; i < 260; i++)
    await writeFile(join(root, `file${i}.pym`), `flow f${i}() -> Unit {}`);
  const comment = ("//" + "x".repeat(120) + "\n").repeat(8500);
  for (let i = 0; i < 9; i++)
    await writeFile(
      join(root, `large${i}.pym`),
      comment + `flow lazy${i}() -> Bool {return true;}`,
    );
  app = await startStudio({ path: join(root, "main.pym") });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(0);
  page.on("response", async (response) => {
    if (response.status() >= 400)
      console.error(response.url(), response.status(), await response.text());
  });
  page.on("pageerror", (error) => console.error("PAGE ERROR", String(error)));
  console.log("Opening large workspace");
  await page.goto(app.url);
  await expect(page.locator(".current-file")).toContainText("main.pym");
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect
    .poll(async () => app.service.runs.some((r) => r.status === "completed"))
    .toBe(true);
  console.log("Initial scoped check completed");
  const initial = app.service.runs.find((r) => r.status === "completed");
  assert.equal(
    initial.report.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
  assert.equal(initial.report.snapshot.files.length, 1);
  await expect(
    page.getByRole("button", { name: "Show 200 more files", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".workspace-name")).toContainText("271 files");
  const lazy = (await app.service.project()).files
    .filter((f) => f.loaded === false)
    .at(-1);
  assert.ok(lazy);
  await page.getByLabel("Find source files", { exact: true }).fill(lazy.path);
  await page
    .getByRole("button", { name: new RegExp(lazy.path.replace(".", "\\.")) })
    .click();
  await expect(page.locator(".current-file")).toContainText(lazy.path);
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await expect(page.locator(".cm-content")).toContainText("flow lazy");
  await expect
    .poll(async () =>
      app.service.runs.some(
        (r) => r.request.file === lazy.path && r.status === "completed",
      ),
    )
    .toBe(true);
  const loaded = app.service.runs.find(
    (r) => r.request.file === lazy.path && r.status === "completed",
  );
  assert.equal(
    loaded.report.snapshot.files[0].text.length,
    comment.length + "flow lazy8() -> Bool {return true;}".length,
  );
  assert.equal(
    loaded.request.buffers[lazy.path],
    undefined,
    "Opening an unchanged lazy source never sends an empty overlay",
  );
  console.log(
    "271-file workspace opens connected, isolates unrelated failures, pages its files, and loads a deferred source without an empty overlay.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
