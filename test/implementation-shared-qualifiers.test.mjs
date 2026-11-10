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
import { rows } from "./fixtures/commonjs-review32-cases.mjs";
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

for (const [name, files, load, expect] of rows) {
  if (!/^R/.test(name) || expect === "boundary") continue;
  test("shared full/partition qualifier: " + name, () => {
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
test("incomplete origin part preserves unrelated lexical calls through the shared qualifier", () => {
  const files = [
    ["a.js", "function one(){return 1}exports.f=one"],
    ["b.js", 'const a=require("./a");exports.run=function(){return a.f()}'],
    [
      "d.js",
      "function h(){return 1}class K{}exports.g=function(){new K();return h()}",
    ],
    [
      "c.js",
      Array.from({ length: 80 }, (_, i) => `let x${i}=${i};`).join("") +
        'let m;m=require("./a");m.f=()=>7',
    ],
  ];
  const opts = { sourcePaths: files.map((f) => f[0]) },
    bad = observeTypescript(source([files[3]]), version, {
      ...opts,
      fileVisitBudget: 30,
    });
  assert.equal(bad.requireOriginsIncomplete, true);
  const good = observeTypescript(source(files.slice(0, 3)), version, opts),
    merged = combinePartitions([good, bad]);
  for (const name of ["h", "K"])
    assert.equal(
      merged.edges.find(
        (e) =>
          e.kind === "calls" && e.span.file === "d.js" && e.targetName === name,
      ).to,
      good.edges.find(
        (e) =>
          e.kind === "calls" && e.span.file === "d.js" && e.targetName === name,
      ).to,
    );
  assert.ok(
    merged.edges
      .filter((e) => e.kind === "calls" && e.span.file === "d.js")
      .every((e) => e.to),
  );
  assert.equal(
    merged.edges.find((e) => e.kind === "calls" && e.targetName === "a.f").to,
    null,
  );
  assert.ok(
    merged.limitations.some((t) => /uncertainty applies across/.test(t)),
  );
});
test("mutable export slots do not replace method-local functions or same-file constructor bindings", () => {
  const files = [
    [
      "k.cjs",
      'Object.defineProperty(exports,"__esModule",{value:true});exports.K=void 0;class K{m(){function explore(n){return n?explore(n-1):0}const flush=()=>2;return explore(3)+flush()}static make(){return new K()}}exports.K=K;',
    ],
    [
      "u.cjs",
      'const {K}=require("./k.cjs");exports.u=function(){return new K().m()}',
    ],
  ];
  const opts = { sourcePaths: files.map((f) => f[0]) };
  for (const groups of partitions(files)) {
    const graph = combinePartitions(
      groups.map((g) => observeTypescript(source(g), version, opts)),
    );
    for (const name of ["explore", "flush", "K"]) {
      const edges = graph.edges.filter(
        (e) =>
          e.kind === "calls" &&
          e.span.file === "k.cjs" &&
          e.targetName === name,
      );
      assert.ok(edges.length);
      assert.ok(
        edges.every((e) => e.to),
        name,
      );
    }
  }
});
for (const variant of [
  "holderLate",
  "holderShorthand",
  "holderHelper",
  "holderAssign",
  "holderReflect",
])
  for (const layout of ["api-together", "barrel-separate"])
    for (const mode of ["full", "fallback"])
      test(`production shared qualifier: ${variant}, ${layout}, ${mode}`, async () => {
        const root = mkdtempSync(join(tmpdir(), "pym-cjs-prod-origin-"));
        try {
          const pad = (n) => "\n// " + "x".repeat(n);
          const files = {
            "lib/clock.js":
              "function one(){return 1}exports.now=one" + pad(450),
            "lib/report.js":
              'const clock=require("./clock");exports.stamp=function stamp(){return clock.now()}' +
              pad(450),
            "plugins/dst.js":
              {
                holderLate:
                  'require("./holder").clock.now=function seven(){return 7}',
                holderShorthand:
                  'require("./holder").clock.now=function seven(){return 7}',
                holderHelper:
                  'function put(m){m.now=function seven(){return 7}}put(require("./holder").clock)',
                holderAssign:
                  'Object.assign(require("./holder").clock,{now:function seven(){return 7}})',
                holderReflect:
                  'Reflect.set(require("./holder").clock,"now",function seven(){return 7})',
              }[variant] + pad(layout === "barrel-separate" ? 1100 : 400),
            "plugins/holder.js":
              {
                holderLate: 'let c;c=require("../shared");exports.clock=c',
                holderShorthand:
                  'const clock=require("../shared");module.exports={clock}',
                holderHelper: 'exports.clock=require("../shared")',
                holderAssign: 'exports.clock=require("../shared")',
                holderReflect: 'exports.clock=require("../shared")',
              }[variant] + pad(layout === "barrel-separate" ? 1300 : 100),
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
              ...(mode === "fallback"
                ? {
                    runnerURL: pathToFileURL(runner),
                    partitionBytes: budget,
                    heapMiB: 128,
                  }
                : {}),
            },
          );
          assert.equal(
            graph.reader.id,
            mode === "fallback"
              ? "typescript-ast-partitioned/v15"
              : "typescript-ast/v21",
          );
          if (mode === "fallback")
            assert.ok(
              graph.limitations.some((s) => /SIGABRT|exit code 134/.test(s)),
            );
          const call = graph.edges.find(
            (e) => e.kind === "calls" && e.targetName === "clock.now",
          );
          assert.ok(call);
          assert.equal(call.to, null);
          assert.deepEqual(
            decodeObservation(observationDocuments(graph)),
            graph,
          );
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      });
