// SPDX-License-Identifier: MIT
import { browserExecutable, browserType } from "./browser-launch.mjs";
import { expect as baseExpect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { startStudio } from "../dist/studio/server.js";
import { build } from "esbuild";
const expect = baseExpect.configure({ timeout: 0 });
const root = await mkdtemp(join(tmpdir(), "pym-field-events-"));
let app, browser;
try {
  app = await startStudio({ path: root });
  browser = await browserType().launch({
    headless: true,
    executablePath: browserExecutable(),
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  const fixture = await build({
    stdin: {
      contents: `import React, {useState, useRef} from 'react';
      import {createRoot} from 'react-dom/client';
      import {RecipeFields} from './web/src/RecipeForm';
      import {defaultRecipeOptions} from './src/studio/recipes';
      function Fixture() {
        const [options,setOptions] = useState({...defaultRecipeOptions, name:'checkout', inputs:[{name:'order',type:{kind:'record',name:'Order',fields:[{name:'customer',type:'String'},{name:'field2',type:{kind:'unselected'}}]}}]});
        const pending = useRef(options); const [render,setRender]=useState(0);
        return <><RecipeFields id="component" options={structuredClone(options)} onChange={edit => {pending.current=typeof edit === "function" ? edit(pending.current) : edit;}}/><button onClick={()=>setOptions(pending.current)}>Publish pending edits</button><button onClick={()=>setRender(render+1)}>Render older parent value</button><output data-testid="draft-value">{JSON.stringify(options)}</output></>;
      }
      createRoot(document.getElementById('fixture')).render(<Fixture/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    plugins: process.env.PYM_DRAFT_BASELINE
      ? [
          {
            name: "retained-owner-state",
            setup(build) {
              build.onLoad(
                {
                  filter:
                    /web\/src\/(RecipeForm\.tsx|InterfaceTypeEditor\.tsx|useDraftUpdate\.ts)$/,
                },
                async (args) => ({
                  contents: await readFile(
                    join(
                      process.env.PYM_DRAFT_BASELINE,
                      "web/src",
                      args.path.split("/").at(-1),
                    ),
                    "utf8",
                  ),
                  loader: args.path.endsWith("tsx") ? "tsx" : "ts",
                  resolveDir: join(process.cwd(), "web/src"),
                }),
              );
            },
          },
        ]
      : process.env.PYM_PENDING_BASELINE === "1"
        ? [
            {
              name: "retained-before-editor",
              setup(build) {
                build.onLoad(
                  { filter: /web\/src\/InterfaceTypeEditor\.tsx$/ },
                  async () => ({
                    contents: await readFile(
                      new URL(
                        "../evidence/project-fit/2026-11-09/follow-up/field-editor-before.tsx",
                        import.meta.url,
                      ),
                      "utf8",
                    ),
                    loader: "tsx",
                    resolveDir: join(process.cwd(), "web/src"),
                  }),
                );
              },
            },
          ]
        : [],
  });
  await page.route("**/__pending-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="fixture"></div>',
    }),
  );
  await page.goto(new URL("/__pending-fixture", app.url).href);
  await page.addScriptTag({ content: fixture.outputFiles[0].text });
  await page
    .getByLabel("Input 1 field 2 name", { exact: true })
    .fill("quantity");
  await page
    .getByLabel("Input 1 field 2 type", { exact: true })
    .selectOption("Nat");
  await page
    .getByRole("button", { name: "Publish pending edits", exact: true })
    .click();
  await expect(
    page.getByLabel("Input 1 field 2 type", { exact: true }),
  ).toHaveValue("Nat");
  assert.equal(
    await page.getByLabel("Input 1 field 2 name", { exact: true }).inputValue(),
    "quantity",
    "a type edit must preserve a field-name edit that has not rendered yet",
  );
  await page.getByLabel("Input 1 name", { exact: true }).fill("basket");
  await page
    .getByRole("button", { name: "Next: return value", exact: true })
    .click();
  await page.getByLabel("Output type", { exact: true }).selectOption("Bool");
  await page
    .getByRole("button", { name: "Publish pending edits", exact: true })
    .click();
  await expect(page.getByLabel("Output type", { exact: true })).toHaveValue(
    "Bool",
  );
  assert.equal(
    await page.getByLabel("Input 1 name", { exact: true }).inputValue(),
    "basket",
    "a return-type edit must preserve a pending input-name edit",
  );
  await page.getByLabel("Output type", { exact: true }).selectOption("result");
  await page
    .getByRole("button", { name: "Publish pending edits", exact: true })
    .click();
  await page
    .getByLabel("Output success type", { exact: true })
    .selectOption("record");
  await page
    .getByRole("button", { name: "Publish pending edits", exact: true })
    .click();
  await page
    .getByLabel("Output success record name", { exact: true })
    .fill("Quote");
  // Publish an older parent render after accepting the name edit, before its
  // acknowledgement. The next nested edit must compose from the owner's draft.
  await page
    .getByRole("button", { name: "Render older parent value", exact: true })
    .click();
  await page
    .getByLabel("Output success field 1 type", { exact: true })
    .selectOption("Nat");
  await page
    .getByRole("button", { name: "Publish pending edits", exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel("Output success record name", { exact: true })
      .inputValue(),
    "Quote",
    "An older nested prop must not replace the accepted record name",
  );
  console.log(
    "Controlled pending-render fixture retains nested edits and Quote across an older parent render.",
  );
  await page.goto(app.url);
  await page
    .getByRole("button", { name: "Start with a recipe", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Describe inputs and outputs/ })
    .click();
  await page.getByLabel("Component name", { exact: true }).fill("checkout");
  await page.getByLabel("Input 1 name", { exact: true }).fill("order");
  await page.getByLabel("Input 1 type", { exact: true }).selectOption("record");
  await page.getByLabel("Input 1 record name", { exact: true }).fill("Order");
  await page
    .getByLabel("Input 1 field 1 name", { exact: true })
    .fill("customer");
  await page
    .getByLabel("Input 1 field 1 type", { exact: true })
    .selectOption("String");
  await page
    .getByRole("button", { name: "Add Input 1 field", exact: true })
    .click();
  const name = page.getByLabel("Input 1 field 2 name", { exact: true });
  // Dispatch the type change inside the trusted native text-input event,
  // after React's root listener but before the browser ends that event turn.
  await name.evaluate((field) => {
    const update = (event) => {
      if (event.target !== field) return;
      document.removeEventListener("input", update);
      const select = document.querySelector(
        'select[aria-label="Input 1 field 2 type"]',
      );
      select.value = "Nat";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    document.addEventListener("input", update);
  });
  await name.fill("quantity");
  await expect(name).toHaveValue("quantity");
  await expect(
    page.getByLabel("Input 1 field 2 type", { exact: true }),
  ).toHaveValue("Nat");
  await page
    .getByRole("button", { name: "Next: return value", exact: true })
    .click();
  await page.getByLabel("Output type", { exact: true }).selectOption("Unit");
  await page
    .getByRole("button", { name: "Create and check", exact: true })
    .click();
  await expect(page.locator(".finding-card")).toContainText(
    "A design decision is still missing",
  );
  const text = await readFile(join(root, "component.pym"), "utf8");
  assert.match(text, /customer: String, quantity: Nat/);
  assert.ok(!text.includes("field2"));
  console.log(
    "Same-turn field-name/type events retain both edits in the generated design.",
  );
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
