import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
// Run only through Karl's bounded pc-tools helper, after the review's browser work has finished.
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "orders-proj-"));
let app, browser;
try {
  const source =
    Array.from(
      { length: 1000 },
      (_, i) =>
        `type ${i === 0 ? "Order" : "Record" + i} = {id: Nat, name: String};`,
    ).join("\n") + "\nflow run(value: Order) -> Bool {return true;}\n";
  await writeFile(join(root, "main.pym"), source);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(0);
  const requested = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/interface")) {
      const data = request.postDataJSON();
      if (data?.action === "type") requested.push(data.symbolId);
    }
  });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Edit inputs and output", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  assert.equal(
    requested.length,
    0,
    "Opening a signature must not request unrelated definitions",
  );
  assert.ok(
    (await dialog.locator("input,select").count()) < 20,
    "Unopened types must not create hundreds of hidden form controls",
  );
  assert.ok(
    (await dialog.locator("option").count()) < 100,
    "Named choices must be bounded with search",
  );
  await dialog
    .locator("summary")
    .filter({ hasText: "Shared records and error cases" })
    .click();
  await dialog.getByLabel("Find a shared type", { exact: true }).fill("Order");
  await expect(
    dialog.locator("summary").filter({ hasText: /Order · record/ }),
  ).toHaveCount(1);
  await expect(
    dialog.locator("summary").filter({ hasText: /Record[0-9]+ · record/ }),
  ).toHaveCount(0);
  await dialog
    .getByLabel("Find a shared type", { exact: true })
    .fill("Record999");
  await dialog
    .locator("summary")
    .filter({ hasText: "Record999 · record" })
    .click();
  await expect(
    dialog.getByLabel("Record999 field 1 name", { exact: true }),
  ).toHaveValue("id");
  assert.equal(requested.length, 1, "Only the opened type is loaded");
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/large-type-editor.png"),
    fullPage: true,
  });
  await dialog
    .getByLabel("Record999 field 1 name", { exact: true })
    .fill("identifier");
  await dialog
    .getByRole("button", { name: "Preview interface changes", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Interface changes" }),
  ).toContainText("identifier: Nat");
  await dialog
    .getByRole("button", { name: "Apply to editor and check", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await expect(page.locator(".cm-content")).toContainText("return true;");
  await expect(page.locator(".cm-content")).toContainText("identifier: Nat");
  assert.equal(
    await readFile(join(root, "main.pym"), "utf8"),
    source,
    "Applying remains an unsaved buffer edit",
  );
  console.log(
    "1000-type design: bounded initial controls, one requested definition, edited type preview, original body and disk preserved.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
