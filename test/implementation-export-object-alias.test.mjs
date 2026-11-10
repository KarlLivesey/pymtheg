import test from "node:test";
import assert from "node:assert/strict";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { combinePartitions } from "../dist/implementation/partitions.js";
import {
  observationDocuments,
  decodeObservation,
} from "../dist/implementation/storage.js";
import {
  dependencyHashes,
  dependencyChanges,
} from "../dist/implementation/dependencies.js";
import { hash } from "../dist/shared/identity.js";
const version = {
  label: "Shared exports objects",
  gitCommit: null,
  dirty: true,
};
function observe(files, groups = null) {
  const source = Object.entries(files).map(([path, text]) => ({
    path,
    text,
    hash: hash(text),
  }));
  return groups
    ? combinePartitions(
        groups.map((paths) =>
          observeTypescript(
            source.filter((s) => paths.includes(s.path)),
            version,
            { sourcePaths: Object.keys(files) },
          ),
        ),
      )
    : observeTypescript(source, version);
}
const grouped = [
  null,
  [["api.js"], ["barrel.js"], ["use.js"]],
  [["api.js", "use.js"], ["barrel.js"]],
  [["api.js"], ["barrel.js", "use.js"]],
];
const consumers = [
  'const {f}=require("./barrel");exports.run=()=>f()',
  'const f=require("./barrel").f;exports.run=()=>f()',
  'const a=require("./barrel");exports.run=()=>a.f()',
  'const {f}=require("./api");exports.run=()=>f()',
];
function run(files) {
  const cached = new Map();
  const load = (path) => {
    path = path.replace(/^\.\//, "") + ".js";
    if (cached.has(path)) return cached.get(path).exports;
    const module = { exports: {} };
    cached.set(path, module);
    new Function("module", "exports", "require", files[path])(
      module,
      module.exports,
      load,
    );
    return module.exports;
  };
  load("./barrel");
  return load("./use").run();
}
for (const [name, writer] of [
  ["anonymous function", "module.exports.f=function(){return 7}"],
  ["arrow", "module.exports.f=()=>7"],
  ["reattached exports", "exports=module.exports;exports.f=()=>7"],
  ["Object.assign", "Object.assign(module.exports,{f:()=>7})"],
  ["Reflect.set", 'Reflect.set(module.exports,"f",()=>7)'],
  ["helper escape", "function patch(t){t.f=()=>7};patch(module.exports)"],
  ["named function", "function seven(){return 7};module.exports.f=seven"],
  ["element access", 'module["exports"]["f"]=()=>7'],
  ["delete then replace", "delete module.exports.f;module.exports.f=()=>7"],
])
  test(`a forwarded exports-object ${name} write qualifies source and barrel consumers in every grouping`, () => {
    for (const use of consumers) {
      const files = {
        "api.js": "function one(){return 1};exports.f=one",
        "barrel.js": 'module.exports=require("./api");' + writer,
        "use.js": use,
      };
      assert.equal(run(files), 7);
      for (const groups of grouped) {
        const graph = observe(files, groups);
        const calls = graph.edges.filter(
          (e) => e.kind === "calls" && e.from === "use.js#function:run",
        );
        assert.ok(calls.length);
        assert.ok(calls.every((e) => e.to === null));
        assert.ok(
          graph.escapedImports.some(
            (e) => e.file === "api.js" && e.moduleObject,
          ),
        );
        assert.deepEqual(decodeObservation(observationDocuments(graph)), graph);
      }
    }
  });

test("plain module forwarding and the detached exports alias preserve the original callable", () => {
  for (const definition of ["exports.f=one", "module.exports.f=one"])
    for (const forward of [
      'module.exports=require("./api")',
      'const api=require("./api");module.exports=api',
    ])
      for (const after of ["", ";exports.f=()=>7"]) {
        const files = {
          "api.js": "function one(){return 1};" + definition,
          "barrel.js": forward + after,
          "use.js": consumers[0],
        };
        assert.equal(run(files), 1);
        const graph = observe(files);
        // This extra combination was already unresolved before this repair;
        // it must never become a confident target on the detached object.
        if (after && forward.startsWith("const")) {
          assert.ok(
            graph.edges
              .filter(
                (e) => e.kind === "calls" && e.from === "use.js#function:run",
              )
              .every((e) => e.to === null || e.to === "api.js#function:one"),
          );
          continue;
        }
        assert.ok(
          graph.edges.some(
            (e) =>
              e.kind === "calls" &&
              e.from === "use.js#function:run" &&
              e.to === "api.js#function:one",
          ),
        );
      }
});

test("a forwarded module alias chain shares uncertainty with its original source", () => {
  const files = {
    "api.js": "function one(){return 1};exports.f=one",
    "mid.js": 'module.exports=require("./api")',
    "barrel.js":
      'const m=require("./mid");module.exports=m;module.exports.f=()=>7',
    "use.js": consumers[3],
  };
  assert.equal(run(files), 7);
  for (const groups of [
    null,
    [["api.js", "use.js"], ["mid.js"], ["barrel.js"]],
  ]) {
    const g = observe(files, groups);
    assert.ok(
      g.edges
        .filter((e) => e.kind === "calls" && e.from === "use.js#function:run")
        .every((e) => e.to === null),
    );
  }
});

test("chained exports reassignment cannot retain the old callable through either module", () => {
  for (const use of consumers) {
    const files = {
      "api.js": "function one(){return 1};exports.f=one",
      "barrel.js": 'exports=module.exports=require("./api");exports.f=()=>7',
      "use.js": use,
    };
    assert.equal(run(files), 7);
    for (const groups of grouped) {
      const graph = observe(files, groups);
      const edges = graph.edges.filter(
        (e) => e.kind === "calls" && e.from === "use.js#function:run",
      );
      assert.ok(edges.length);
      assert.ok(edges.every((e) => e.to === null));
    }
  }
});

for (const modifier of ["", "static "])
  test(`${modifier || "instance "}member decorator body changes retain sibling dependencies without resolving dispatch`, () => {
    for (const split of [false, true]) {
      const make = (n) =>
        observe(
          {
            "deco.ts": `export function quiet(orig:any,_c:any){return function(this:any){return ${n}}}`,
            "api.ts": `import {quiet} from './deco';export class Notices{@quiet ${modifier}notify(){return 1}${modifier}remind(){return ${modifier ? "Notices" : "this"}.notify()}}`,
            "safe.ts": "export class Safe{run(){return 1}}",
          },
          split ? [["api.ts"], ["deco.ts"], ["safe.ts"]] : null,
        );
      const a = make(8),
        b = make(9),
        id = "api.ts#method:Notices.remind";
      assert.ok(
        a.edges
          .filter((e) => e.kind === "calls" && e.from === id)
          .every((e) => e.to === null),
      );
      assert.notEqual(dependencyHashes(a).get(id), dependencyHashes(b).get(id));
      assert.equal(
        dependencyHashes(a).get("safe.ts#method:Safe.run"),
        dependencyHashes(b).get("safe.ts#method:Safe.run"),
      );
      const change = dependencyChanges(a, b, id);
      assert.ok(
        change.items.some(
          (i) =>
            i.name === "quiet" &&
            i.before.includes("return 8") &&
            i.after.includes("return 9"),
        ),
      );
    }
  });
