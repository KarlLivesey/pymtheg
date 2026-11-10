import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { combinePartitions } from "../dist/implementation/partitions.js";
import { hash } from "../dist/shared/identity.js";
const fixtures = [
  [
    "c34",
    "a.ts",
    "export function refund(p: number) { return p - 600 } export function other(p: number) { return p }\nclass B { constructor() { (this as any).constructor.prototype.run = () => other(1) } run() { return refund(1) } }\nexport const r = new B().run()\n",
  ],
  [
    "d07",
    "a.ts",
    "export function refund(p: number) { return p - 600 } export function other(p: number) { return p }\nclass B { constructor() { this!.run = () => other(1) } run() { return refund(1) } }\nexport const r = new B().run()\n",
  ],
  [
    "d08",
    "a.ts",
    "export function refund(p: number) { return p - 600 } export function other(p: number) { return p }\nclass B { constructor() { (this satisfies B).run = () => other(1) } run() { return refund(1) } }\nexport const r = new B().run()\n",
  ],
  [
    "d09",
    "a.ts",
    "export function refund(p: number) { return p - 600 } export function other(p: number) { return p }\nclass B { constructor() { const p: any = this.constructor; p.prototype.run = () => other(1) } run() { return refund(1) } }\nexport const r = new B().run()\n",
  ],
  [
    "f02",
    "a.ts",
    "export function refund(p: number) { return p - 600 } export function other(p: number) { return p }\nclass B { constructor() { const s = this!; s.run = () => other(1) } run() { return refund(1) } }\nexport const r = new B().run()\n",
  ],
  [
    "f03",
    "a.ts",
    "export function refund(p: number) { return p - 600 } export function other(p: number) { return p }\nclass B { constructor() { const s = (this satisfies B); s.run = () => other(1) } run() { return refund(1) } }\nexport const r = new B().run()\n",
  ],
  [
    "f04",
    "a.js",
    "function refund(p){ return p - 600 } function other(p){ return p }\nclass B { constructor() { const C = this.constructor; C.prototype.run = () => other(1) } run() { return refund(1) } }\nmodule.exports = new B().run()\n",
  ],
  [
    "f08",
    "a.ts",
    "export function refund(p: number) { return p - 600 } export function other(p: number) { return p }\nclass B { constructor() { const ctor: any = (this as any).constructor; ctor.prototype.run = () => other(1) } run() { return refund(1) } }\nexport const r = new B().run()\n",
  ],
  [
    "f09",
    "a.ts",
    'export function refund(p: number) { return p - 600 } export function other(p: number) { return p }\nclass B { constructor() { this!["run"] = () => other(1) } run() { return refund(1) } }\nexport const r = new B().run()\n',
  ],
  [
    "h01",
    "a.ts",
    "export function refund(p: number) { return p - 600 } export function other(p: number) { return p }\nclass B { constructor() { const that = this as unknown as { run: () => number }; that.run = () => other(1) } run() { return refund(1) } }\nexport const r = new B().run()\n",
  ],
  [
    "h03",
    "a.ts",
    "export function refund(p: number) { return p - 600 } export function other(p: number) { return p }\nclass B { constructor() { (this.constructor as any).prototype.run = () => other(1) } run() { return refund(1) } }\nexport const r = new B().run()\n",
  ],
  [
    "h04",
    "a.ts",
    'export function refund(p: number) { return p - 600 } export function other(p: number) { return p }\nclass B { constructor() { (this.constructor as any)["prototype"]["run"] = () => other(1) } run() { return refund(1) } }\nexport const r = new B().run()\n',
  ],
  [
    "h06",
    "a.ts",
    "export function refund(p: number) { return p - 600 } export function other(p: number) { return p }\nclass B { constructor() { const self = this; const C: any = self.constructor; C.prototype.run = () => other(1) } run() { return refund(1) } }\nexport const r = new B().run()\n",
  ],
  [
    "f10",
    "a.ts",
    "export function refund(p: number) { return p - 600 } export function other(p: number) { return p }\nclass B { constructor() { const { constructor: c } = this as any; c.prototype.run = () => other(1) } run() { return refund(1) } }\nexport const r = new B().run()\n",
  ],
];
for (const [name, path, text] of fixtures)
  test(`instance write provenance ${name} does not lend the replaced method target`, () => {
    const output = ts.transpileModule(text, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText;
    const module = { exports: {} };
    Function("module", "exports", output)(module, module.exports);
    assert.equal(
      typeof module.exports === "number" ? module.exports : module.exports.r,
      1,
    );
    const files = [
      { path, text, hash: hash(text) },
      {
        path: "control.ts",
        text: "export function stable(){return 7}",
        hash: hash("export function stable(){return 7}"),
      },
    ];
    const version = {
      label: "Runtime provenance",
      gitCommit: null,
      dirty: true,
    };
    for (const split of [false, true]) {
      const graph = split
        ? combinePartitions(
            files.map((f) =>
              observeTypescript([f], version, {
                sourcePaths: files.map((f) => f.path),
              }),
            ),
          )
        : observeTypescript(files, version);
      const dispatch = graph.edges.filter(
        (e) =>
          e.kind === "calls" &&
          text.slice(e.span.start, e.span.end) === "new B().run()" &&
          e.span.file === path,
      );
      assert.equal(dispatch.length, 1);
      assert.equal(
        dispatch[0].to,
        null,
        `${name}: ${split ? "split" : "full"} falsely resolves ${dispatch[0].to}`,
      );
    }
  });

for (const [name, writer] of [
  ["late constructor alias", "let C;C=this.constructor;C.prototype.run=()=>1"],
  ["array receiver", "[this][0].run=()=>1"],
  ["conditional receiver", "(true?this:this).run=()=>1"],
  ["comma receiver", "(0,this).run=()=>1"],
  [
    "constructor destructuring",
    "const {constructor:C}=this;C.prototype.run=()=>1",
  ],
  ["destructured array receiver", "const [s]=[this];s.run=()=>1"],
  [
    "cast alias assignment",
    "let s;s=this as unknown as {run:()=>number};s.run=()=>1",
  ],
])
  test(`unclassified receiver origin ${name} stays conservative`, () => {
    const text = `class B {constructor(){${writer}}run(){return -599}}export const r=new B().run()`;
    const output = ts.transpileModule(text, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText;
    const module = { exports: {} };
    Function("module", "exports", output)(module, module.exports);
    assert.equal(module.exports.r, 1);
    const g = observeTypescript([{ path: "a.ts", text, hash: hash(text) }], {
      label: name,
      gitCommit: null,
      dirty: true,
    });
    assert.equal(
      g.edges.find((e) => e.kind === "calls" && e.targetName === "new B().run")
        ?.to,
      null,
    );
  });

test("writing a computed receiver does not rebind the function that computes it", () => {
  const text =
    "function make(){return {value:0}}make().value=7;export function run(){return make().value}";
  const output = ts.transpileModule(text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const module = { exports: {} };
  Function("module", "exports", output)(module, module.exports);
  assert.equal(module.exports.run(), 0);
  const g = observeTypescript([{ path: "a.ts", text, hash: hash(text) }], {
    label: "Stable computing function",
    gitCommit: null,
    dirty: true,
  });
  const calls = g.edges.filter(
    (e) => e.kind === "calls" && e.targetName === "make",
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every((e) => e.to === "a.ts#function:make"));
  const nested = "make(".repeat(200) + "undefined" + ")".repeat(200);
  const repeated =
    `function make(value?:unknown){return {value:0}}const receiver=${nested};` +
    "receiver.value=7;".repeat(300) +
    "export function run(){return make().value}";
  const bounded = observeTypescript(
    [{ path: "repeated.ts", text: repeated, hash: hash(repeated) }],
    { label: "Cached receiver origins", gitCommit: null, dirty: true },
    { fileVisitBudget: 50000 },
  );
  assert.equal(
    bounded.coverage.declarations,
    "complete",
    JSON.stringify(bounded.limitations),
  );
  assert.ok(bounded.nodes.some((n) => n.name === "run"));
  assert.ok(
    bounded.edges
      .filter((e) => e.kind === "calls" && e.targetName === "make")
      .every((e) => e.to === "repeated.ts#function:make"),
  );
});
