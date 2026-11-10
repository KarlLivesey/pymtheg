import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { observeTypescript } from "../dist/implementation/typescript.js";
import {
  combinePartitions,
  partitionSources,
} from "../dist/implementation/partitions.js";
import { captureImplementation } from "../dist/implementation/capture.js";
import {
  observationDocuments,
  decodeObservation,
} from "../dist/implementation/storage.js";
import { hash } from "../dist/shared/identity.js";
import { rows } from "./fixtures/commonjs-review31-cases.mjs";
const version = {
  label: "Review 31 CommonJS origins",
  gitCommit: null,
  dirty: true,
};
const source = (files) =>
  files.map(([path, text]) => ({ path, text, hash: hash(text) }));
function partitions(files) {
  if (!files.length) return [[]];
  const [h, ...t] = files;
  return partitions(t).flatMap((p) => [
    [[h], ...p],
    ...p.map((_, i) => p.map((g, j) => (i === j ? [h, ...g] : g))),
  ]);
}
function runtime(files, load) {
  const root = mkdtempSync(join(tmpdir(), "pym-cjs-origin-"));
  try {
    for (const [path, text] of files) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    writeFileSync(join(root, "package.json"), '{"type":"commonjs"}');
    writeFileSync(
      join(root, "main.mjs"),
      `import{createRequire}from'node:module';const require=createRequire(import.meta.url);${load.map((p) => (p.endsWith(".mjs") ? `await import('./${p}');` : `require('./${p}');`)).join("\n")}let v;try{v=require('./b.js').run()}catch{v='throws'}process.stdout.write(String(v));`,
    );
    return execFileSync(
      process.execPath,
      ["--no-warnings", join(root, "main.mjs")],
      { encoding: "utf8" },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const values = { one: 1, two: 2, seven: 7, eight: 8 };
function check(graph, truth, name) {
  const calls = graph.edges.filter(
    (e) =>
      e.kind === "calls" &&
      e.from.startsWith("b.js#function:run") &&
      e.targetName !== "require",
  );
  assert.ok(calls.length, name);
  for (const e of calls) {
    if (!e.to) continue;
    const node = graph.nodes.find((n) => n.id === e.to);
    assert.ok(node.name in values, "Unexpected target " + e.to);
    assert.equal(String(values[node.name]), truth, name + " resolved " + e.to);
  }
}
for (const [name, files, load] of rows) {
  // Invalid ESM-in-CJS N25 and documented arbitrary loader boundaries N20/N21
  // are retained in the independent probe, not credited as regression passes.
  if (/^N(20|21|25) /.test(name)) continue;
  test("runtime identity across all partitions: " + name, () => {
    const truth = runtime(files, load),
      opts = { sourcePaths: files.map((f) => f[0]) };
    const full = observeTypescript(source(files), version, opts);
    check(full, truth, name);
    assert.deepEqual(decodeObservation(observationDocuments(full)), full);
    for (const groups of partitions(files)) {
      const parts = groups.map((g) =>
        observeTypescript(source(g), version, opts),
      );
      check(combinePartitions(parts), truth, name);
      check(combinePartitions([...parts].reverse()), truth, name + " reversed");
    }
  });
}
for (const text of [
  'const a=require("./a");let g=a.f;g=()=>7;exports.g=g',
  'let {f}=require("./a");f=()=>7;exports.g=f',
])
  test("local rebinding does not write an import: " + text, () => {
    const graph = observeTypescript(source([["c.js", text]]), version, {
      sourcePaths: ["a.js", "c.js"],
    });
    assert.equal(
      graph.importedWrites.filter((w) => w.file === "a.js").length,
      0,
    );
  });
for (const reader of [
  'const a=require("./a");exports.x=a.f()',
  'const a=require("./a");exports.x=[0].map(a.f)',
])
  test("member read preserves exported and private calls: " + reader, () => {
    const files = [
        [
          "a.js",
          "function helper(){return 1}function one(){return helper()}exports.f=one",
        ],
        ["b.js", 'const a=require("./a");exports.run=function(){return a.f()}'],
        ["c.js", reader],
      ],
      opts = { sourcePaths: files.map((f) => f[0]) };
    const parts = [
      observeTypescript(source([files[2]]), version, opts),
      observeTypescript(source(files.slice(0, 2)), version, opts),
    ];
    const graph = combinePartitions(parts);
    assert.equal(
      graph.edges.find(
        (e) =>
          e.kind === "calls" &&
          e.targetName === "a.f" &&
          e.span.file === "b.js",
      ).to,
      "a.js#function:one",
    );
    assert.equal(
      graph.edges.find((e) => e.kind === "calls" && e.targetName === "helper")
        .to,
      "a.js#function:helper",
    );
    assert.ok(parts[0].escapedImports.every((e) => !e.moduleObject));
  });
test("multiple assigned origins qualify both possible shared modules", () => {
  const files = [
    ["a.js", "function one(){return 1}exports.f=one"],
    ["x.js", "function two(){return 2}exports.f=two"],
    ["c.js", 'let m;m=require("./a");m=require("./x");m.f=()=>7'],
  ];
  const graph = observeTypescript(source([files[2]]), version, {
    sourcePaths: files.map((f) => f[0]),
  });
  assert.deepEqual(
    new Set(graph.importedWrites.map((w) => w.file)),
    new Set(["a.js", "x.js"]),
  );
});
for (const variant of ["lateAssign", "holder"])
  for (const layout of ["api-together", "barrel-separate"])
    test(`production origin fallback: ${variant}, ${layout}`, async () => {
      const root = mkdtempSync(join(tmpdir(), "pym-cjs-prod-origin-"));
      try {
        const pad = (n) => "\n// " + "x".repeat(n);
        const files = {
          "lib/clock.js": "function one(){return 1}exports.now=one" + pad(450),
          "lib/report.js":
            'const clock=require("./clock");exports.stamp=function stamp(){return clock.now()}' +
            pad(450),
          "plugins/dst.js":
            (variant === "lateAssign"
              ? 'let shared;shared=require("../shared");shared.now=function seven(){return 7}'
              : 'require("./holder").clock.now=function seven(){return 7}') +
            pad(layout === "barrel-separate" ? 1100 : 400),
          ...(variant === "holder"
            ? {
                "plugins/holder.js":
                  'exports.clock=require("../shared")' +
                  pad(layout === "barrel-separate" ? 1300 : 100),
              }
            : {}),
          "shared/index.js":
            'module.exports=require("../lib/clock")' +
            pad(layout === "barrel-separate" ? 1500 : 100),
        };
        for (const [path, text] of Object.entries(files)) {
          mkdirSync(dirname(join(root, path)), { recursive: true });
          writeFileSync(join(root, path), text);
        }
        writeFileSync(join(root, "package.json"), '{"type":"commonjs"}');
        assert.equal(
          execFileSync(
            process.execPath,
            [
              "-e",
              'require("./plugins/dst");process.stdout.write(String(require("./lib/report").stamp()))',
            ],
            { cwd: root, encoding: "utf8" },
          ),
          "7",
        );
        const inputs = source(Object.entries(files)),
          budget =
            Buffer.byteLength(files["lib/clock.js"]) +
            Buffer.byteLength(files["lib/report.js"]);
        const groups = partitionSources(inputs, budget).map((g) =>
          g.map((f) => f.path),
        );
        assert.deepEqual(groups[0], ["lib/clock.js", "lib/report.js"]);
        assert.ok(groups.every((g) => g.length <= 3));
        assert.ok(groups.length > 1);
        if (layout === "barrel-separate")
          assert.deepEqual(groups.at(-1), ["shared/index.js"]);
        const runner = join(root, "force.mjs"),
          production = new URL(
            "../dist/implementation/capture-child.js",
            import.meta.url,
          ).href;
        writeFileSync(
          runner,
          `import{readFileSync}from'node:fs';if(readFileSync(process.argv[2],'utf8').trim().split('\\n').length>4)process.abort();else await import(${JSON.stringify(production)});`,
        );
        const graph = await captureImplementation(
          root,
          Object.keys(files),
          "Origin production fallback",
          new AbortController().signal,
          {
            runnerURL: pathToFileURL(runner),
            partitionBytes: budget,
            heapMiB: 128,
          },
        );
        assert.equal(graph.reader.id, "typescript-ast-partitioned/v15");
        assert.ok(
          graph.limitations.some((s) => /SIGABRT|exit code 134/.test(s)),
        );
        const call = graph.edges.find(
          (e) => e.kind === "calls" && e.targetName === "clock.now",
        );
        assert.ok(call);
        assert.equal(call.to, null);
        assert.deepEqual(decodeObservation(observationDocuments(graph)), graph);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

test("escaped declaration-only constructor is not promoted by a smaller partition", () => {
  const files = [
    ["a.d.ts", "export default class One {value(): number}"],
    [
      "a.js",
      "class One{value(){return 1}}class Seven{value(){return 7}}exports.default=One;exports.default=Seven;",
    ],
    [
      "b.js",
      'const api=require("./a");exports.run=function(){return new api.default().value()}',
    ],
  ];
  assert.equal(runtime(files, []), "7");
  const opts = { sourcePaths: files.map((f) => f[0]) };
  const checkGraph = (graph) => {
    const ctor = graph.edges.find(
      (e) => e.kind === "calls" && e.targetName === "api.default",
    );
    assert.ok(ctor);
    assert.equal(ctor.to, null);
    assert.deepEqual(decodeObservation(observationDocuments(graph)), graph);
  };
  checkGraph(observeTypescript(source(files), version, opts));
  for (const groups of partitions(files))
    checkGraph(
      combinePartitions(
        groups.map((g) => observeTypescript(source(g), version, opts)),
      ),
    );
});

test("cyclic namespace aliases retain their literal require origin", () => {
  const files = [
    ["a.js", "function one(){return 1}exports.f=one"],
    [
      "c.js",
      'let m=require("./a"), n=m;m=n;n=m;n.f=function seven(){return 7}',
    ],
    ["b.js", 'const a=require("./a");exports.run=function(){return a.f()}'],
  ];
  assert.equal(runtime(files, ["c.js"]), "7");
  const opts = { sourcePaths: files.map((f) => f[0]) };
  for (const groups of partitions(files))
    check(
      combinePartitions(
        groups.map((g) => observeTypescript(source(g), version, opts)),
      ),
      "7",
      "cyclic namespaces",
    );
});
test("unrelated alias diamonds do not become require origins", () => {
  const text =
    'const unused=require("./unused");let a0={f(){return 1}};' +
    Array.from({ length: 50 }, (_, i) => `let a${i + 1}=a${i}||a${i};`).join(
      "",
    ) +
    "exports.run=function(){return a50.f()}";
  const graph = observeTypescript(source([["b.js", text]]), version, {
    sourcePaths: ["unused.js", "b.js"],
  });
  assert.ok(graph.nodes.some((n) => n.name === "run"));
  assert.equal(graph.importedWrites.length, 0);
  assert.ok(!graph.diagnostics.some((d) => /budget/.test(d.message)));
});

test("exhausted origin collection cannot regain call certainty during merge", () => {
  const files = [
    ["a.js", "function one(){return 1}exports.f=one"],
    ["b.js", 'const a=require("./a");exports.run=function(){return a.f()}'],
    [
      "c.js",
      Array.from({ length: 80 }, (_, i) => `let x${i}=${i};`).join("") +
        'let m;m=require("./a");m.f=()=>7',
    ],
  ];
  const opts = { sourcePaths: files.map((f) => f[0]) };
  const uncertain = observeTypescript(source([files[2]]), version, {
    ...opts,
    fileVisitBudget: 30,
  });
  assert.equal(uncertain.requireOriginsIncomplete, true);
  const graph = combinePartitions([
    observeTypescript(source(files.slice(0, 2)), version, opts),
    uncertain,
  ]);
  assert.equal(graph.completeness, "partial");
  assert.equal(
    graph.edges.find((e) => e.kind === "calls" && e.targetName === "a.f").to,
    null,
  );
  assert.deepEqual(decodeObservation(observationDocuments(graph)), graph);
});

test("forwarded mutable aliases qualify every possible shared module", () => {
  const files = [
    ["a.js", "function one(){return 1}exports.f=one"],
    ["x.js", "function two(){return 2}exports.f=two"],
    [
      "i.js",
      'let shared=require("./a");shared=require("./x");module.exports=shared;module.exports.f=function seven(){return 7}',
    ],
    ["b.js", 'const x=require("./x");exports.run=function(){return x.f()}'],
  ];
  assert.equal(runtime(files, ["i.js"]), "7");
  const opts = { sourcePaths: files.map((f) => f[0]) };
  check(
    observeTypescript(source(files), version, opts),
    "7",
    "forwarded origins",
  );
  for (const groups of partitions(files))
    check(
      combinePartitions(
        groups.map((g) => observeTypescript(source(g), version, opts)),
      ),
      "7",
      "forwarded origins split",
    );
});
