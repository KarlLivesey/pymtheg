import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import typescript, {
  injectedExtractionFaults,
} from "../dist/graph/languages/typescript/index.js";

/**
 * Indexes `files` (twice when `again` is given, with `again` applied in
 * between) and returns the report, the files' results and every link with
 * its text and line.
 */
async function indexFiles(files, again) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-ts-crash-"));
  const root = join(scratch, "project");
  const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "crash");
  const write = async (entries) => {
    for (const [path, text] of Object.entries(entries)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
  };
  try {
    await write(files);
    const read = async () => {
      const report = await indexProject(
        root,
        new LanguageRegistry([typescript]),
        store,
      );
      const symbols = new Map(
        store.findSymbols().map((s) => [s.id, `${s.file}#${s.identity}`]),
      );
      const texts = new Map(store.files().map((f) => [f.path, f.text]));
      const results = new Map(store.files().map((f) => [f.path, f.result]));
      const links = store.links().map((l) => {
        const text = texts.get(l.file);
        const lineStart = text.lastIndexOf("\n", l.range.start - 1) + 1;
        const lineEnd = text.indexOf("\n", l.range.start);
        return {
          file: l.file,
          kind: l.kind,
          text: text.slice(l.range.start, l.range.end),
          line: text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd),
          resolution: l.resolution,
          reason: l.data?.reason,
          target: l.resolution === "resolved" ? symbols.get(l.targetId) : null,
        };
      });
      return { report, results, links };
    };
    const first = await read();
    if (!again) return first;
    await again(write);
    return { first, second: await read() };
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
const linkOn = (result, file, marker, text) => {
  const found = result.links.filter(
    (l) => l.file === file && l.text === text && l.line.includes(marker),
  );
  assert.equal(found.length, 1, `one link ${text} on ${marker}`);
  return found[0];
};

// The three shapes that crashed on this repository's own sources (src/mcp/
// architecture.ts, web/src/ArchitectureView.tsx, MachineDefinitionEditor.tsx,
// SourcePlanLinks.tsx): a member with no symbol (an `any` receiver) whose
// receiver is a name destructured from a PARAMETER. The extractor climbed
// from the binding element looking for a variable declaration and walked
// off the top of the tree.
test("destructured parameters as receivers are read (object rest, array, annotated object)", async () => {
  const result = await indexFiles({
    "use.ts": [
      "export class Real { run() {} }",
      "declare const rows: any[];",
      "rows.map(({ searchText, ...e }) => e.summary.slice(0)); // object-rest",
      "declare const groups: [string, any][];",
      "groups.map(([title, paths]) => paths.join(title)); // array-pattern",
      "export function Editor({ value, real }: { value: any; real: Real }) {",
      "  value.states.map(String); // annotated-object",
      "  real.run(); // annotated-resolved",
      "}",
      "",
    ].join("\n"),
  });
  assert.deepEqual(result.report.failed, []);
  assert.equal(result.results.get("use.ts").status, "clean");
  // Members of `any` have no declaration: unresolved, as the compiler says.
  for (const [marker, text] of [
    ["object-rest", "slice"],
    ["array-pattern", "join"],
    ["annotated-object", "map"],
  ]) {
    const link = linkOn(result, "use.ts", `// ${marker}`, text);
    assert.equal(link.resolution, "unresolved", marker);
  }
  // A member the compiler resolves through a destructured parameter.
  const run = linkOn(result, "use.ts", "// annotated-resolved", "run");
  assert.equal(run.resolution, "resolved");
  assert.equal(run.target, "use.ts#Real.run");
});

test("a destructured parameter is never mistaken for a require binding", async () => {
  // The require checks apply only to a variable's initialiser.
  const result = await indexFiles({
    "tsconfig.json": '{ "compilerOptions": { "allowJs": true } }\n',
    "lib.js": "exports.helper = function () {};\n",
    "use.js": [
      'const { helper } = require("./lib");',
      "helper(); // variable-binding",
      "module.exports = function ({ helper: h }) {",
      "  h.anything(); // parameter-binding",
      "};",
      "",
    ].join("\n"),
  });
  assert.deepEqual(result.report.failed, []);
  const parameter = linkOn(
    result,
    "use.js",
    "// parameter-binding",
    "anything",
  );
  assert.equal(parameter.resolution, "unresolved");
  assert.notEqual(parameter.reason, "untyped-require");
});

test("an internal exception is reported as the module's fault, transient, distinct from a syntax error, and retried", async () => {
  injectedExtractionFaults.add("crash.ts");
  try {
    const { first, second } = await indexFiles(
      {
        "crash.ts": "export const fine = 1;\n",
        "broken.ts": "export const x = (;\n",
        "ok.ts": "export const ok = 2;\n",
      },
      async () => {
        // The defect is fixed; the file itself did not change.
        injectedExtractionFaults.clear();
      },
    );
    const crash = first.results.get("crash.ts");
    assert.equal(crash.status, "failed");
    assert.equal(crash.failureKind, "transient");
    assert.match(
      crash.diagnostics[0].message,
      /^Internal error in the TypeScript module while reading crash\.ts \(a defect in pymtheg, not a problem in this file; it is retried on the next index\): injected internal fault/,
    );
    // A syntax error is the file's content: no failureKind (content).
    const broken = first.results.get("broken.ts");
    assert.equal(broken.status, "failed");
    assert.equal(broken.failureKind, "content");
    assert.match(broken.diagnostics[0].message, /^Syntax error at line 1/);
    // The other files are unaffected.
    assert.equal(first.results.get("ok.ts").status, "clean");
    // Next index, same content: the file is read again, not reused.
    assert.equal(second.results.get("crash.ts").status, "clean");
    assert.equal(second.results.get("broken.ts").status, "failed");
  } finally {
    injectedExtractionFaults.clear();
  }
});

test("a file of two tied configs keeps the transient marking of an internal error", async () => {
  // Two configs of the same rank both include src/: the file is analysed
  // under both and merged (mergeTied). A transient failure in any variant
  // keeps the merged failure transient (retried, never cached as content).
  injectedExtractionFaults.add("src/a.ts");
  try {
    const result = await indexFiles({
      "tsconfig.a.json": '{ "include": ["src"] }\n',
      "tsconfig.b.json": '{ "include": ["src"] }\n',
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": 'import { a } from "./a";\nexport const b = a;\n',
    });
    const a = result.results.get("src/a.ts");
    assert.equal(a.status, "failed");
    assert.equal(a.failureKind, "transient");
    assert.match(
      a.diagnostics[0].message,
      /^Internal error in the TypeScript module while reading src\/a\.ts/,
    );
    assert.equal(result.results.get("src/b.ts").status, "clean");
  } finally {
    injectedExtractionFaults.clear();
  }
});
