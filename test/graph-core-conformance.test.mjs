import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLanguageConformance } from "../dist/graph/index.js";
import { compilerModule } from "./fixtures/graph-core/compiler.mjs";
import toy from "../dist/graph/languages/toy/index.js";

for (const [label, prefix] of [
  ["shebang", "#!/usr/bin/env node\n"],
  ["CRLF shebang", "#!/usr/bin/env node\r\n"],
  ["CR shebang", "#!/usr/bin/env node\r"],
  ["BOM", "\uFEFF"],
]) {
  test(`compiler-backed kit preserves a leading ${label} and exact context text`, async () => {
    const api = "export function f() {}\n";
    const main =
      "import { f } from '@api'; export function run() { f(); missing(); }\n";
    const config = JSON.stringify({
      compilerOptions: { paths: { "@api": ["barrel.ts"] } },
    });
    const compiler = compilerModule([]);
    let analyses = 0;
    await checkLanguageConformance(
      {
        ...compiler,
        analyze(context) {
          analyses++;
          assert.equal(
            context.contextFiles[0].text,
            config,
            "Context fixtures must never be edited",
          );
          if (analyses > 1) assert.deepEqual(context.changedContextFiles, []);
          if (analyses === 4) {
            for (const file of context.files.filter(
              (file) => file.path !== "barrel.ts",
            ))
              assert.equal(
                file.text,
                `${prefix}${prefix.endsWith("\r\n") ? "\r\n" : prefix.endsWith("\r") ? "\r" : "\n"}${file.path === "api.ts" ? api : main}`,
              );
          }
          return compiler.analyze(context);
        },
      },
      [
        { path: "api.ts", text: prefix + api },
        { path: "barrel.ts", text: "export { f } from './api';\n" },
        { path: "main.ts", text: prefix + main },
        { path: "tsconfig.json", text: config, context: true },
      ],
      {
        symbols: [
          {
            file: "api.ts",
            name: "f",
            identity: "f",
            kind: "function",
            at: api.trimEnd(),
          },
          {
            file: "main.ts",
            name: "run",
            identity: "run",
            kind: "function",
            at: "export function run() { f(); missing(); }",
          },
        ],
        links: [
          {
            file: "main.ts",
            kind: "calls",
            targetName: "f",
            source: { name: "run", kind: "function" },
            target: { file: "api.ts", name: "f", kind: "function" },
            at: "f()",
          },
          {
            file: "main.ts",
            kind: "calls",
            targetName: "missing",
            source: { name: "run", kind: "function" },
            target: null,
            at: "missing()",
          },
        ],
      },
    );
    assert.equal(analyses, 4);
  });
}

test("other line-sensitive preambles require an explicit exclusion with a reason", async () => {
  const text = "def f\ncall missing\n";
  const module = {
    ...toy,
    parse(input) {
      assert.ok(input.text.startsWith("def"), "first line must stay first");
      return toy.parse(input);
    },
  };
  const fixtures = [{ path: "fixed.toy", text }];
  const expected = {
    symbols: [
      {
        file: "fixed.toy",
        name: "fixed.toy",
        identity: "fixed.toy",
        kind: "file",
        at: text,
      },
      {
        file: "fixed.toy",
        name: "f",
        identity: "f",
        kind: "function",
        at: "def f",
      },
    ],
    links: [
      {
        file: "fixed.toy",
        kind: "calls",
        targetName: "missing",
        source: { name: "f", kind: "function" },
        target: null,
        at: "call missing",
      },
    ],
  };
  await checkLanguageConformance(module, fixtures, {
    ...expected,
    identityEditExclusions: [
      {
        file: "fixed.toy",
        reason: "This fixture has a position-sensitive first line.",
      },
    ],
  });
  await assert.rejects(
    checkLanguageConformance(module, fixtures, {
      ...expected,
      identityEditExclusions: [{ file: "fixed.toy", reason: " " }],
    }),
    /needs a reason/,
  );
  await assert.rejects(
    checkLanguageConformance(module, fixtures, {
      ...expected,
      identityEditExclusions: [
        { file: "missing.toy", reason: "Typo must not bypass the check." },
      ],
    }),
    /unique source fixture/,
  );
});
