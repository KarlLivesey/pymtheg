// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const unanswered = { kind: "unselected" };
const noAction = () => {};
async function view(component, props) {
  const root = await mkdtemp(join(tmpdir(), "pym-type-conflict-render-"));
  try {
    const require = createRequire(import.meta.url),
      outfile = join(root, "view.mjs");
    await build({
      entryPoints: [resolve(`web/src/${component}.tsx`)],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      jsx: "automatic",
      plugins: [
        {
          name: "no-network-in-render",
          setup(builder) {
            builder.onResolve({ filter: /^\.\/api$/ }, () => ({
              path: "api",
              namespace: "render-test",
            }));
            builder.onLoad({ filter: /.*/, namespace: "render-test" }, () => ({
              contents:
                'export function api() { throw new Error("Render must not call the network"); }',
              loader: "js",
            }));
          },
        },
        {
          name: "one-react",
          setup(builder) {
            builder.onResolve({ filter: /^react(?:\/|$)/ }, (args) => ({
              path: require.resolve(args.path),
              external: true,
            }));
          },
        },
      ],
    });
    const module = await import(pathToFileURL(outfile).href);
    return renderToStaticMarkup(createElement(module[component], props));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("saved unanswered type and concurrent field change render both choices instead of crashing", async () => {
  const base = {
    kind: "record",
    name: "Request",
    fields: [{ name: "amount", type: "Nat" }],
  };
  const html = await view("TypeEditor", {
    description: {
      name: "Request",
      definition: { ...base, fields: [{ name: "amount", type: "Int" }] },
    },
    file: "main.pym",
    runId: "run",
    knownTypes: [],
    onDraft: noAction,
    onClose: noAction,
    onApply: noAction,
    initialDraft: {
      schema: "pymtheg.type-draft/v1",
      file: "main.pym",
      name: "Request",
      baseline: base,
      definition: { ...base, fields: [{ name: "amount", type: unanswered }] },
    },
  });
  assert.match(html, /The source and saved form both changed/);
  assert.match(html, /amount: .*type not chosen/);
  assert.match(html, /amount: Int/);
  assert.match(html, /Continue with these choices/);
});
test("saved unanswered input and output render in interface conflict choices", async () => {
  const base = {
    name: "charge",
    inputs: [{ name: "amount", type: "Nat" }],
    output: "Bool",
    effects: [],
  };
  const html = await view("InterfaceConflict", {
    value: {
      draft: {
        edit: {
          ...base,
          inputs: [{ name: "amount", type: unanswered }],
          output: { kind: "list", element: unanswered },
        },
        baseline: { signature: base },
      },
      description: {
        ...base,
        inputs: [{ name: "amount", type: "Int" }],
        output: "Int",
      },
      conflicts: ["Changed"],
      candidates: [],
    },
    onClose: noAction,
    onChoose: noAction,
    onContinue: noAction,
  });
  assert.match(html, /Review changed interface/);
  assert.match(html, /amount: .*type not chosen/);
  assert.match(html, /amount: Int/);
  assert.match(html, /List&lt;.*type not chosen/);
  assert.doesNotMatch(html, /&quot;kind&quot;:&quot;unselected&quot;/);
});
