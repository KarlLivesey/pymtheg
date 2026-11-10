import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
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
import { rows } from "./fixtures/commonjs-partition-cases.mjs";
const version = {
  label: "CommonJS partition writes",
  gitCommit: null,
  dirty: true,
};
const source = (files) =>
  files.map(([path, text]) => ({ path, text, hash: hash(text) }));
function partitions(files) {
  if (!files.length) return [[]];
  const [head, ...tail] = files;
  return partitions(tail).flatMap((p) => [
    [[head], ...p],
    ...p.map((_, i) =>
      p.map((group, j) => (i === j ? [head, ...group] : group)),
    ),
  ]);
}
function runtime(files, load) {
  const data = new Map(files),
    cache = new Map();
  const require = (request, from = "main.js") => {
    const base = posix.normalize(posix.join(posix.dirname(from), request));
    const name = [base, base + ".js", base + "/index.js"].find((p) =>
      data.has(p),
    );
    assert.ok(name, "Synthetic module missing: " + base);
    if (cache.has(name)) return cache.get(name).exports;
    const module = { exports: {} };
    cache.set(name, module);
    new Function("module", "exports", "require", data.get(name)).call(
      module.exports,
      module,
      module.exports,
      (r) => require(r, name),
    );
    return module.exports;
  };
  for (const name of load) require("./" + name);
  return require("./b.js").run();
}
function checkTargets(graph, actual, name) {
  const edges = graph.edges.filter(
    (e) =>
      e.kind === "calls" &&
      e.from.startsWith("b.js#function:run") &&
      e.targetName !== "require",
  );
  assert.ok(edges.length, name);
  const values = { one: 1, two: 2, seven: 7, eight: 8 };
  for (const edge of edges) {
    if (edge.to === null) continue;
    const target = graph.nodes.find((n) => n.id === edge.to);
    assert.ok(target.name in values, "Unexpected confident target: " + edge.to);
    assert.equal(values[target.name], actual, name + " resolved " + edge.to);
  }
  return edges;
}
for (const [name, files, load] of rows)
  test("all set partitions: " + name, () => {
    const actual = runtime(files, load),
      options = { sourcePaths: files.map((f) => f[0]) };
    const full = observeTypescript(source(files), version, options);
    checkTargets(full, actual, name);
    for (const groups of partitions(files)) {
      const graph = combinePartitions(
        groups.map((group) =>
          observeTypescript(source(group), version, options),
        ),
      );
      checkTargets(
        graph,
        actual,
        name + " " + JSON.stringify(groups.map((g) => g.map((f) => f[0]))),
      );
    }
    if (/^C[125] /.test(name))
      assert.ok(
        checkTargets(full, actual, name).every((e) => e.to !== null),
        "existing full-parse control lost",
      );
  });

for (const [name, writer] of [
  ["direct", 'require("./a").f=seven'],
  ["alias", 'const m=require("./a");m.f=seven'],
  ["member alias", 'const m=require("./a").sub;m.f=seven'],
  ["Object.assign", 'Object.assign(require("./a"),{f:seven})'],
  ["Reflect.set", 'Reflect.set(require("./a"),"f",seven)'],
  ["helper", 'function put(m){m.f=seven}put(require("./a"))'],
])
  test("out-of-part require mutation: " + name, () => {
    const member = name === "member alias";
    const files = [
      [
        "a.js",
        member
          ? "function one(){return 1}exports.sub={f:one}"
          : "function one(){return 1}exports.f=one",
      ],
      [
        "b.js",
        `const a=require("./a");exports.run=function(){return a${member ? ".sub" : ""}.f()}`,
      ],
      ["c.js", "function seven(){return 7};" + writer],
    ];
    assert.equal(runtime(files, ["c.js"]), 7);
    const options = { sourcePaths: files.map((f) => f[0]) };
    const writerGraph = observeTypescript(source([files[2]]), version, options);
    assert.ok(
      [...writerGraph.importedWrites, ...writerGraph.escapedImports].some(
        (e) =>
          e.file === "a.js" &&
          (e.name === (member ? "sub" : "f") || e.moduleObject),
      ),
    );
    for (const group of partitions(files)) {
      const graph = combinePartitions(
        group.map((g) => observeTypescript(source(g), version, options)),
      );
      assert.ok(checkTargets(graph, 7, name).every((e) => e.to === null));
    }
    assert.deepEqual(
      decodeObservation(observationDocuments(writerGraph)),
      writerGraph,
    );
  });

for (const variant of ["assign", "objectAssign", "helper"])
  for (const layout of ["api-together", "barrel-separate"])
    test(`production fallback: ${variant}, ${layout}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "pym-cjs-fallback-"));
      try {
        const writers = {
          assign:
            'const shared=require("../shared");shared.now=function seven(){return 7}',
          objectAssign:
            'Object.assign(require("../shared"),{now:function seven(){return 7}})',
          helper:
            'function put(m){m.now=function seven(){return 7}}put(require("../shared"))',
        };
        const files = {
          "lib/clock.js": "function one(){return 1}exports.now=one",
          "lib/report.js":
            'const clock=require("./clock");exports.stamp=function stamp(){return clock.now()}',
          "plugins/dst.js": writers[variant],
          "shared/index.js":
            'module.exports=require("../lib/clock")' +
            (layout === "barrel-separate" ? "\n// " + "x".repeat(600) : ""),
        };
        for (const [path, text] of Object.entries(files)) {
          await mkdir(join(root, posix.dirname(path)), { recursive: true });
          await writeFile(join(root, path), text);
        }
        const inputs = source(Object.entries(files)),
          sizes = inputs.map((f) => Buffer.byteLength(f.text));
        const budget =
          layout === "barrel-separate"
            ? sizes[3]
            : Math.max(sizes[0] + sizes[1], sizes[2] + sizes[3]);
        const expected =
          layout === "barrel-separate"
            ? [
                ["lib/clock.js", "lib/report.js", "plugins/dst.js"],
                ["shared/index.js"],
              ]
            : [
                ["lib/clock.js", "lib/report.js"],
                ["plugins/dst.js", "shared/index.js"],
              ];
        assert.deepEqual(
          partitionSources(inputs, budget).map((g) => g.map((f) => f.path)),
          expected,
        );
        const runner = join(root, "force-partition.mjs"),
          production = new URL(
            "../dist/implementation/capture-child.js",
            import.meta.url,
          ).href;
        await writeFile(
          runner,
          `import{readFileSync}from'node:fs';const lines=readFileSync(process.argv[2],'utf8').trim().split('\\n');if(lines.length>4)process.abort();else await import(${JSON.stringify(production)});`,
        );
        const graph = await captureImplementation(
          root,
          Object.keys(files),
          "Production CommonJS partitions",
          new AbortController().signal,
          {
            runnerURL: pathToFileURL(runner),
            partitionBytes: budget,
            heapMiB: 128,
          },
        );
        assert.equal(graph.reader.id, "typescript-ast-partitioned/v15");
        assert.ok(
          graph.limitations.some((t) => /SIGABRT|exit code 134/.test(t)),
        );
        const calls = graph.edges.filter(
          (e) =>
            e.kind === "calls" &&
            e.from === "lib/report.js#function:stamp" &&
            e.targetName === "clock.now",
        );
        assert.equal(calls.length, 1);
        assert.equal(calls[0].to, null);
        assert.deepEqual(decodeObservation(observationDocuments(graph)), graph);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
