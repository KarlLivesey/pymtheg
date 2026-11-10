import { browserExecutable, browserType } from "./browser-launch.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { browserEvidence } from "./browser-evidence.mjs";
const expect = baseExpect.configure({ timeout: 0 }),
  signal = new AbortController().signal;
const root = await mkdtemp(join(tmpdir(), "pym-design-live-ui-"));
let app, browser;
try {
  const source = "flow limit(qty: Nat) -> Bool { return qty <= 50; }";
  await writeFile(join(root, "limit.pym"), source);
  await writeFile(
    join(root, "limit.ts"),
    "export function limit(qty:number){return qty<=50;}",
  );
  app = await startStudio({ path: root });
  const saved = await app.service.savePlanItem(
    "",
    {
      ...newPlanItem("P"),
      title: "Respect quantity",
      links: [{ kind: "depends-on", target: "source:limit.pym#limit" }],
    },
    "Plan",
    signal,
  );
  await app.service.observeImplementation(
    { files: ["limit.ts"], label: "Before", expectedRevision: saved.id },
    signal,
  );
  for (const id of ["plan:P", "source:limit.pym#limit"]) {
    const page = await app.service.implementationGraph(
        { mode: "gaps" },
        signal,
      ),
      node = (
        await app.service.implementationGraph({ mode: "existing" }, signal)
      ).items[0],
      row = page.items.find((i) => i.id === id);
    await app.service.linkImplementation(
      {
        revision: page.activeRevision,
        planId: id,
        nodeId: node.id,
        planHash: row.planHash,
        observationId: page.observationId,
        note: "Respect quantity limit",
      },
      signal,
    );
  }
  let page = await app.service.implementationGraph({ mode: "gaps" }, signal);
  await writeFile(join(root, "limit.pym"), source.replace("50", "40"));
  await writeFile(
    join(root, "limit.ts"),
    "export function limit(qty:number){return qty<=40;}",
  );
  await app.service.observeImplementation(
    {
      files: ["limit.ts"],
      label: "After",
      expectedRevision: page.activeRevision,
    },
    signal,
  );
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const p = await (
    await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  ).newPage();
  p.setDefaultTimeout(0);
  await p.goto(app.url);
  await p.getByRole("button", { name: "Architecture", exact: true }).click();
  await p
    .getByRole("button", { name: "Plan & code graphs", exact: true })
    .click();
  const view = p.getByRole("region", { name: "Planned and existing system" });
  const row = view.locator('[data-record-id="source:limit.pym#limit"]');
  await expect(row).toContainText("Design changed");
  await expect(row).toContainText("Code changed");
  await row.click();
  await view
    .getByRole("button", { name: "Inspect this code", exact: true })
    .click();
  const review = p.getByRole("region", { name: "Review linked code changes" });
  await expect(
    review.getByRole("region", { name: "Plan being reviewed" }),
  ).toContainText("qty <= 50");
  await expect(
    review.getByRole("region", { name: "Current design changes" }),
  ).toContainText("qty <= 40");
  assert.ok(
    !(
      await review
        .getByRole("region", { name: "Plan being reviewed" })
        .innerText()
    ).includes('"kind"'),
  );
  await expect(
    review.getByRole("region", { name: "Source changes" }),
  ).toContainText("qty<=40");
  await p.screenshot({
    path: browserEvidence("evidence/product-audit/live-design-comparison.png"),
    fullPage: true,
  });
  console.log(
    "Live design and code drift coexist; retained/current source is readable in link comparison",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
