import { browserExecutable, browserType } from "./browser-launch.mjs";
import { browserEvidence } from "./browser-evidence.mjs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const expect = baseExpect.configure({ timeout: 0 }),
  root = await mkdtemp(join(tmpdir(), "pym-work-ui-"));
let app, browser, release;
try {
  app = await startStudio({ path: root });
  const signal = new AbortController().signal,
    catalogue = (returns) => ({
      path: "catalogue.json",
      text: JSON.stringify({
        types: {},
        functions: [
          { id: "api", name: "api", owner: "service", args: {}, returns },
        ],
      }),
    });
  let baseline = await app.service.importArchitecture(
    "Initial",
    [
      catalogue("Nat"),
      {
        path: "requirements.md",
        text: "## R03 Stable result\nReview API result types.",
      },
    ],
    signal,
  );
  let state = await app.service.savePlanItem(
    baseline.id,
    {
      ...newPlanItem("API-review"),
      title: "API review",
      owner: "service",
      status: "reviewed",
      acceptance: "Check result",
      evidence: "Reviewed the signature",
      evidenceRevision: baseline.id,
      links: [{ kind: "supports", target: "function:api" }],
    },
    "Review",
    signal,
  );
  await app.service.editArchitectureDocument(
    state.id,
    "catalogue.json",
    catalogue("Int").text,
    "Changed result",
    signal,
  );
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1050 },
  });
  let markReached;
  const reached = new Promise((resolve) => {
    markReached = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  await page.route("**/api/architecture/work?*", async (route) => {
    if (++attempts === 1) {
      markReached();
      await gate;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Controlled unavailable" }),
      });
    } else await route.continue();
  });
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Needs attention", exact: true })
    .click();
  const work = page.getByRole("region", {
    name: "Architecture work to review",
  });
  await reached;
  await expect(work.getByRole("status")).toContainText(
    "Checking recorded planning gaps",
  );
  await expect(work).not.toContainText("No gaps found");
  release();
  release = null;
  await expect(work.getByRole("alert")).toContainText(
    "Could not check planning gaps",
  );
  await expect(work).not.toContainText("No gaps found");
  await work
    .getByRole("button", { name: "Retry planning checks", exact: true })
    .click();
  await expect(work).toContainText("Linked target “api” changed");
  await expect(work).toContainText("API review");
  await page.screenshot({
    path: browserEvidence(
      "evidence/product-audit/planning-needs-attention.png",
    ),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Add planning record", exact: true })
    .click();
  const form = page.getByRole("region", { name: "Planning record" });
  await form.getByLabel("Short title").fill("Track requirement");
  await form.getByLabel("Planning record or document").fill("No such record");
  await form.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("No record called");
  await form.getByLabel("Planning record or document").fill("R03");
  await form.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(form).toContainText("Stable result");
  await form
    .getByRole("button", { name: "Save planning record", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  console.log(
    "Planning GUI: changed-contract evidence is flagged, unknown links are rejected, and requirement-heading names resolve without copying IDs.",
  );
} finally {
  release?.();
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
