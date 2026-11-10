import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { startStudio } from "../dist/studio/server.js";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-link-draft-"));
let app, browser;
try {
  const store = await ArchitectureStore.open(root);
  store.save("Two plans", "fixture", [
    {
      path: "plan.json",
      text: JSON.stringify({
        schema: "pymtheg.plan/v1",
        items: ["First", "Second"].map((name, i) => ({
          ...newPlanItem(name),
          id: "R" + (i + 1),
          title: name,
        })),
      }),
    },
  ]);
  store.close();
  await writeFile(
    join(root, "main.ts"),
    "export function first() { return 1; } export function second() { return 2; }",
  );
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  ).newPage();
  page.setDefaultTimeout(0);
  const graph = page.getByRole("region", {
    name: "Planned and existing system",
  });
  const list = graph.getByRole("list", { name: "System records" });
  const open = async () => {
    await page.goto(app.url);
    await page
      .getByRole("button", { name: "Plan & code graphs", exact: true })
      .click();
  };
  await open();
  await graph
    .getByRole("button", { name: "Capture code version", exact: true })
    .click();
  await graph
    .getByLabel("Source files, one project-relative path per line")
    .fill("main.ts");
  await graph
    .getByRole("button", { name: "Read files and retain version", exact: true })
    .click();
  await expect(graph).toContainText("Code version retained");
  await list.getByRole("button").filter({ hasText: "First" }).click();
  await graph
    .getByLabel("Observed declaration", { exact: true })
    .selectOption({ label: "first · main.ts" });
  await graph
    .getByLabel("Reason for this link")
    .fill("First implementation reason");
  await list.getByRole("button").filter({ hasText: "Second" }).click();
  await expect(graph.getByLabel("Reason for this link")).toHaveValue("");
  await expect(
    graph.getByLabel("Observed declaration", { exact: true }),
  ).toHaveValue("");
  await graph
    .getByLabel("Observed declaration", { exact: true })
    .selectOption({ label: "second · main.ts" });
  const saved = page.waitForResponse(
    async (r) =>
      r.url().endsWith("/api/recovery") &&
      r.request().method() === "POST" &&
      JSON.stringify(r.request().postDataJSON()).includes(
        "Second implementation reason",
      ) &&
      r.ok(),
  );
  await graph
    .getByLabel("Reason for this link")
    .fill("Second implementation reason");
  await saved;
  await expect(
    graph.getByRole("region", { name: "Unfinished implementation links" }),
  ).toContainText("Link drafts saved locally");
  await app.close();
  app = await startStudio({ path: root });
  await open();
  await graph
    .getByRole("button", { name: "Resume link: First", exact: true })
    .click();
  await expect(graph.getByLabel("Reason for this link")).toHaveValue(
    "First implementation reason",
  );
  await expect(
    graph.getByLabel("Observed declaration", { exact: true }),
  ).not.toHaveValue("");
  await expect(
    graph.getByLabel("I reviewed the plan and this observed source"),
  ).not.toBeChecked();
  await graph
    .getByLabel("I reviewed the plan and this observed source")
    .check();
  const linked = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/implementation/link") &&
      r.request().method() === "POST",
  );
  await graph
    .getByRole("button", { name: "Save explicit link", exact: true })
    .click();
  const response = await linked;
  assert.equal(response.status(), 200, await response.text());
  assert.equal(
    response.request().postDataJSON().note,
    "First implementation reason",
  );
  assert.equal(response.request().postDataJSON().planId, "plan:R1");
  await expect(
    graph.getByRole("button", { name: "Resume link: First", exact: true }),
  ).toHaveCount(0);
  await graph
    .getByRole("button", { name: "Resume link: Second", exact: true })
    .click();
  await expect(graph.getByLabel("Reason for this link")).toHaveValue(
    "Second implementation reason",
  );
  await expect(
    graph.getByLabel("I reviewed the plan and this observed source"),
  ).not.toBeChecked();
  console.log(
    "Each plan retains its own target and reason across switches and a real Studio restart. Review is never restored. Saving one link preserves the other draft.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
