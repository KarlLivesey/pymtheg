// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { startStudio } from "../dist/studio/server.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-gap-ui-"));
const code =
  'export function send(n: number): boolean { throw new Error("Not implemented"); } export function record(): boolean { return true; }';
let app, browser;
try {
  const store = await ArchitectureStore.open(root);
  store.save("Plan v1", "fixture", [
    {
      path: "plan.json",
      text: JSON.stringify({
        schema: "pymtheg.plan/v1",
        items: [
          {
            ...newPlanItem("Send once"),
            id: "R1",
            title: "Send once",
            acceptance: "Exactly one request",
          },
        ],
      }),
    },
  ]);
  store.close();
  await writeFile(join(root, "main.ts"), code);
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(0);
  page.on("console", (m) => console.log("browser:", m.text()));
  page.on("pageerror", (e) => console.log("pageerror:", String(e)));
  page.on("response", async (r) => {
    if (r.url().endsWith("/api/implementation")) {
      const b = await r.json().catch(() => null);
      console.log(
        "graph response",
        b?.mode,
        b?.items?.map((i) => i.name),
      );
    }
    if (r.status() >= 400)
      console.log("HTTP", r.status(), r.url(), await r.text());
  });
  await page.goto(app.url);
  console.log("Opened architecture-only fixture");
  await page
    .getByRole("button", { name: "Plan & code graphs", exact: true })
    .click();
  console.log("Opened graph workspace");
  const view = page.getByRole("region", {
    name: "Planned and existing system",
  });
  await view
    .getByRole("button", { name: "Capture code version", exact: true })
    .click();
  await view.getByLabel("Version name", { exact: true }).fill("Code v1");
  await view
    .getByLabel("Source files, one project-relative path per line")
    .fill("main.ts");
  const capture = page.waitForResponse((r) =>
    r.url().endsWith("/api/implementation/observe"),
  );
  await view
    .getByRole("button", { name: "Read files and retain version", exact: true })
    .click();
  const response = await capture;
  assert.equal(response.status(), 200, await response.text());
  await expect(view).toContainText("Code version retained");
  console.log("Submitted capture");
  const list = view.getByRole("list", { name: "System records" });
  await expect(list).toContainText("Send once");
  console.log("Found planned record");
  await list.getByRole("button").filter({ hasText: "Send once" }).click();
  await page.screenshot({
    path: browserEvidence("evidence/product-audit/gap-before-link.png"),
    fullPage: true,
  });
  console.log(
    "Selection text",
    await view.getByRole("complementary").innerText(),
  );
  await view
    .getByLabel("Observed declaration", { exact: true })
    .selectOption({ label: "send · main.ts" });
  await view
    .getByLabel("Reason for this link")
    .fill("This function will implement the send contract");
  await view.getByLabel("I reviewed the plan and this observed source").check();
  await view
    .getByRole("button", { name: "Save explicit link", exact: true })
    .click();
  await expect(list).toContainText("Fail-fast stub");
  console.log(
    "Actual source capture and explicit link report a stub, not a completed plan",
  );
  await list.getByRole("button").filter({ hasText: "Send once" }).click();
  await view
    .getByLabel("Observed declaration", { exact: true })
    .selectOption({ label: "record · main.ts" });
  await view.getByLabel("I reviewed the plan and this observed source").check();
  await view
    .getByRole("button", { name: "Save explicit link", exact: true })
    .click();
  await expect(list).toContainText("2 links");
  await list.getByRole("button").filter({ hasText: "Send once" }).click();
  const linked = view.getByRole("region", {
    name: "Linked implementation declarations",
  });
  await expect(linked).toContainText("send");
  await expect(linked).toContainText("record");
  await linked
    .getByRole("button", {
      name: "Remove implementation link to record",
      exact: true,
    })
    .click();
  await expect(list).toContainText("1 link");
  console.log(
    "Adding a second declaration retains both links; removing one preserves the original stub link.",
  );

  await view
    .getByRole("button", { name: "Existing code", exact: true })
    .click();
  await expect(list).toContainText("send");
  await view
    .getByRole("button", { name: "Planned system", exact: true })
    .click();
  await expect(list).toContainText("Send once");
  await writeFile(
    join(root, "main.ts"),
    code.replace('throw new Error("Not implemented");', "return n > 0;"),
  );
  await view
    .getByRole("button", { name: "Capture code version", exact: true })
    .click();
  await view.getByLabel("Version name", { exact: true }).fill("Code v2");
  await view
    .getByRole("button", { name: "Read files and retain version", exact: true })
    .click();
  await expect(list).toContainText("Code changed");
  await view
    .getByRole("button", { name: "Implementation gaps", exact: true })
    .click();
  await expect(list).toContainText("Code changed");
  await view
    .getByLabel("Code version", { exact: true })
    .selectOption({ label: "Code v1" });
  await expect(list).toContainText("Fail-fast stub");
  await view
    .getByLabel("Code version", { exact: true })
    .selectOption({ label: "Code v2" });
  await expect(list).toContainText("Code changed");
  console.log(
    "Independent code versions retain earlier gaps and expose changed implementation",
  );
  await view
    .getByRole("button", { name: "Inspect Send once", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(view.getByRole("complementary")).toContainText(
    "The linked code changed",
  );

  await page.screenshot({
    path: browserEvidence("evidence/product-audit/planned-existing-gap.png"),
    fullPage: true,
  });
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    accessibility.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/planned-existing-gap-narrow.png",
    ),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.match(await readFile(join(root, "main.ts"), "utf8"), /return n > 0/);
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
