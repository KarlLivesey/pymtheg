import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { waitForRecovery } from "./recovery-ack.mjs";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-block-recovery-"));
const original =
  'flow main() -> Unit { for i in 3 { unknown "Decide cleanup"; } }';
let app, browser, page;
try {
  await writeFile(join(root, "main.pym"), original);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1300, height: 1000 },
  });
  const unavailableBlocks = [];
  context.on("page", (opened) =>
    opened.on("response", (response) => {
      if (response.url().endsWith("/api/blocks") && response.status() >= 400)
        unavailableBlocks.push(response.status());
    }),
  );
  page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(page.locator(".cm-content")).toContainText("for i in 3");
  await page.getByLabel("Check as I edit").uncheck();
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const field = () => page.getByLabel("Number of repetitions", { exact: true });
  await expect(field()).toHaveValue("3");
  let release, fetched;
  const gate = new Promise((r) => (release = r)),
    ready = new Promise((r) => (fetched = r));
  await page.route("**/api/blocks", async (route) => {
    const result = await route.fetch();
    fetched();
    await gate;
    await route.fulfill({ response: result });
  });
  await field().fill("6");
  await page.getByRole("button", { name: "Check source", exact: true }).click();
  await ready;
  await field().fill("7");
  const delivered = page.waitForResponse((r) =>
    r.url().endsWith("/api/blocks"),
  );
  release();
  await delivered;
  await page.unroute("**/api/blocks");
  await expect(page.locator(".visual-status")).not.toContainText("Loading");
  await expect(field()).toHaveValue("7");
  await expect(page.locator(".cm-content")).toContainText("in 7");
  console.log("An older real check response cannot replace a newer field edit");
  await field().fill("");
  await page.getByRole("button", { name: "Check source", exact: true }).click();
  await expect(page.locator(".visual-status")).toContainText(
    "Some text is incomplete",
  );
  await expect(field()).toHaveValue("");
  await waitForRecovery(
    app,
    (r) => r.drafts.find((d) => d.path === "main.pym")?.text,
    original.replace("in 3", "in "),
  );
  await page.close();
  await app.close();
  app = await startStudio({ path: root });
  page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(field()).toHaveValue("");
  console.log(
    "A blank field remains editable after a real restart; parser recovery retains its source block.",
  );
  await field().fill("8");
  const recovery = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/recovery") &&
      r
        .request()
        .postDataJSON()
        ?.workspace?.drafts?.some(
          (d) => /\bin\s+8\b/.test(d.text) && d.text.includes("Cancel safely"),
        ),
  );
  await page
    .getByLabel("What still needs deciding?", { exact: true })
    .fill("Cancel safely");
  await recovery;
  await expect(page.locator(".statusbar")).toContainText("Draft saved locally");
  await page.close();
  await app.close();
  app = await startStudio({ path: root });
  page = await context.newPage();
  page.setDefaultTimeout(0);
  await page.goto(app.url);
  await expect(
    page.getByRole("button", { name: "Blocks", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(field()).toHaveValue("8");
  await expect(
    page.getByLabel("What still needs deciding?", { exact: true }),
  ).toHaveValue("Cancel safely");
  assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  assert.deepEqual(
    unavailableBlocks,
    [],
    "Restored Blocks must wait for a fresh checked model rather than request an unavailable old run",
  );
  console.log(
    "Incomplete fields survive checking; edited block source and mode survive a real Studio restart without saving",
  );
} finally {
  await page?.close();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
