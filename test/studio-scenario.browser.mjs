import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import AxeBuilder from "@axe-core/playwright";
// Run only inside pc-tools headless.
import { spawn } from "node:child_process";
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-scenario-ui-"));
let app, browser;
try {
  await writeFile(
    join(root, "main.pym"),
    "type Reader = { suspended: Bool, remaining: Nat }; type Choice = Keep(String) | Stop; flow main(reader: Reader, books: List<Nat>, label: String, choice: Choice) -> Unit bound books <= 3 { assert !reader.suspended; assert books.count <= reader.remaining; }",
  );
  app = await startStudio({ path: join(root, "main.pym") });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(app.url);
  await expect(page.getByLabel("Behaviour entry point")).toHaveValue("main");
  await page.getByRole("button", { name: "Scenario", exact: true }).click();
  const reader = page
    .locator("fieldset")
    .filter({ has: page.locator("legend").filter({ hasText: "reader" }) });
  await reader.getByLabel("Choose specific inputs").check();
  await page
    .getByLabel("reader example 1 / suspended", { exact: true })
    .selectOption("false");
  await page
    .getByLabel("reader example 1 / remaining", { exact: true })
    .fill("2");
  const books = page
    .locator("fieldset")
    .filter({ has: page.locator("legend").filter({ hasText: "books" }) });
  await books.getByLabel("Choose specific inputs").check();
  await books
    .getByRole("button", { name: "Add list item", exact: true })
    .click();
  await page.getByLabel("books example 1 / item 1", { exact: true }).fill("1");
  await page
    .locator("fieldset")
    .filter({ has: page.locator("legend").filter({ hasText: "label" }) })
    .getByLabel("Choose specific inputs")
    .check();
  await page.getByLabel("label example 1", { exact: true }).fill("Library A");
  await page
    .locator("fieldset")
    .filter({ has: page.locator("legend").filter({ hasText: "choice" }) })
    .getByLabel("Choose specific inputs")
    .check();
  await page
    .getByLabel("choice example 1 / outcome", { exact: true })
    .selectOption("Keep");
  await page
    .getByLabel("choice example 1 / Keep", { exact: true })
    .fill("reserved");
  await page.getByLabel("Scenario name", { exact: true }).fill("guided valid");
  await page
    .getByRole("button", { name: "Save scenario to project", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("guided valid");
  await page
    .getByRole("button", { name: "Apply scenario", exact: true })
    .click();
  const sent = page.waitForRequest(
    (r) =>
      r.url().endsWith("/api/run") && r.postDataJSON()?.kind === "simulate",
  );
  await page.getByRole("button", { name: /Simulate/ }).click();
  const request = (await sent).postDataJSON();
  if (
    request.scope.inputs.label[0] !== "Library A" ||
    request.scope.inputs.choice[0].value !== "reserved"
  )
    throw Error("String/tagged controls lost values");
  if (
    request.scope.inputs.reader[0].remaining !== "2" ||
    request.scope.inputs.books[0][0] !== "1"
  )
    throw Error("Controls did not produce the requested finite scope");
  await expect(page.locator(".statusbar")).toContainText("completed");
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(
    page.getByText("No violation in sampled runs", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Scenario", exact: true }).click();
  await mkdir(browserEvidence("evidence/recovery"), { recursive: true });
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/post-eighth/guided-scenario.png",
    ),
    fullPage: true,
  });
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  if (audit.violations.length) throw Error(JSON.stringify(audit.violations));
  const config = JSON.parse(
    await readFile(join(root, ".pymtheg.json"), "utf8"),
  );
  if (config.scenarios["guided valid"].scope.inputs.reader[0].remaining !== "2")
    throw Error("Named scenario was not persisted");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  for (const target of ["typescript", "rust", "go"]) {
    await page.getByLabel("Scaffold language").selectOption(target);
    const waiting = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download scaffold", exact: true })
      .click();
    const download = await waiting;
    const stream = await download.createReadStream();
    let source = "";
    for await (const chunk of stream) source += String(chunk);
    if (!source.includes("Not implemented"))
      throw Error("Downloaded scaffold does not contain fail-fast stubs");
    if (await download.failure()) throw Error("Scaffold download failed");
  }

  // The browser journey is complete; release its resources before the independent CLI replay.
  await browser.close();
  browser = null;
  await app.close();
  app = null;
  const child = spawn(
    process.execPath,
    [
      new URL("../dist/cli/main.js", import.meta.url).pathname,
      "simulate",
      join(root, "main.pym"),
      "--scenario",
      "guided valid",
      "--format",
      "json",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let out = "",
    err = "";
  child.stdout.on("data", (v) => (out += v));
  child.stderr.on("data", (v) => (err += v));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (code.code !== 0)
    throw Error(
      "Saved scenario CLI failed (exit " +
        code.code +
        ", signal " +
        code.signal +
        "): " +
        err +
        out,
    );
  const replay = JSON.parse(out);
  if (
    !replay.results.some(
      (r) =>
        r.analysisKind === "behaviour" && r.outcome === "no_counterexample",
    )
  )
    throw Error("Saved scenario did not reproduce");
  console.log(
    "Guided scenario: record fields and list items produced the exact finite inputs; real simulation completed without raw JSON editing.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
