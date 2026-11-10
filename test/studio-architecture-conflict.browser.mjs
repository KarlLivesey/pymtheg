import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { startStudio } from "../dist/studio/server.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-arch-conflict-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1500, height: 1050 },
    }),
    first = await context.newPage(),
    second = await context.newPage();
  for (const page of [first, second]) {
    await page.goto(app.url);
    await page
      .getByRole("button", { name: "Architecture", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Add planning record", exact: true }),
    ).toBeEnabled();
  }
  await first
    .getByRole("button", { name: "Add planning record", exact: true })
    .click();
  const saved = first.waitForResponse(
    (r) =>
      r.url().endsWith("/api/architecture/draft") &&
      r.request().method() === "POST" &&
      r.request().postDataJSON()?.draft?.item?.title === "First writer",
  );
  await first.getByLabel("Short title").fill("First writer");
  if (!(await saved).ok()) throw Error("First draft was not stored");
  await second
    .getByRole("button", { name: "Add planning record", exact: true })
    .click();
  await second.getByLabel("Short title").fill("Losing writer still needs this");
  await expect(
    second.getByRole("alert").filter({ hasText: "another session" }),
  ).toBeVisible();
  await second
    .getByRole("region", { name: "Planning record" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  const downloaded = second.waitForEvent("download");
  await second
    .getByRole("button", { name: "Download local draft", exact: true })
    .click();
  const file = await (await downloaded).path();
  if (!file) throw Error("No local draft artifact");
  const content = JSON.parse(await readFile(file, "utf8"));
  if (content?.item?.title !== "Losing writer still needs this")
    throw Error(
      "Conflict handling lost the local draft: " + JSON.stringify(content),
    );
  const stored = await app.service.architectureDraft();
  if (
    stored.draft?.kind !== "plan" ||
    stored.draft.item.title !== "First writer"
  )
    throw Error("Conflicting session changed the stored draft");
  console.log(
    "Architecture conflict: retained first writer and downloadable losing local draft, including after a failed discard.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
