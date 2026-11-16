// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { combinePartitions } from "../dist/implementation/partitions.js";
import { dependencyHashes } from "../dist/implementation/dependencies.js";
import { hash } from "../dist/shared/identity.js";
const version = { label: "Instance identity", gitCommit: null, dirty: true };
const file = (path, text) => ({ path, text, hash: hash(text) });
const fixtures = [
  [
    "scalar initialization",
    "class A { x=0; constructor(x:number){this.x=x} go(){return this.x} }",
    "const a=new A(7);return a.go()",
    7,
    true,
  ],
  [
    "compound scalar update",
    "class A { x=6; go(){this.x++;return this.x} }",
    "const a=new A();return a.go()",
    7,
    true,
  ],
  [
    "literal keyed field",
    "class A { x=0; constructor(){this['x']=7} go(){return this.x} }",
    "const a=new A();return a.go()",
    7,
    true,
  ],
  [
    "arrow field value",
    "class A { x=0; constructor(){this.x=7} go=()=>7; }",
    "const a=new A();return a.go()",
    7,
    true,
  ],
  [
    "method replacement",
    "class A { x=0; constructor(){this.x=7} go(){return 1} reset(){this.go=()=>7} }",
    "const a=new A();a.reset();return a.go()",
    7,
    false,
  ],
  [
    "computed method replacement",
    "class A { x=0; constructor(){this.x=7} go(){return 1} reset(k){this[k]=()=>7} }",
    "const a=new A();a.reset('go');return a.go()",
    7,
    false,
  ],
  [
    "reflective method replacement",
    "class A { x=0; constructor(){this.x=7} go(){return 1} reset(){Reflect.set(this,'go',()=>7)} }",
    "const a=new A();a.reset();return a.go()",
    7,
    false,
  ],
  [
    "helper instance escape",
    "function patch(t){t.go=()=>7} class A { x=0; constructor(){this.x=7} go(){return 1} reset(){patch(this)} }",
    "const a=new A();a.reset();return a.go()",
    7,
    false,
  ],
  [
    "alias method replacement",
    "class A { x=0; constructor(){this.x=7} go(){return 1} reset(){const self=this;self.go=()=>7} }",
    "const a=new A();a.reset();return a.go()",
    7,
    false,
  ],
];
for (const ext of ["ts", "js"])
  for (const [name, cls, body, value, keep] of fixtures) {
    test(`${ext}: constructor identity survives ${name}; dispatch stays honest`, () => {
      const original = cls + ` function run(){${body}}`;
      const js = ts.transpileModule(original, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
      assert.equal(Function(js + ";return run()")(), value);
      const text = ext === "ts" ? original : js;
      const graph = observeTypescript([file("a." + ext, text)], version);
      const calls = graph.edges.filter((e) => e.kind === "calls");
      assert.equal(
        calls.find((e) => e.targetName === "A")?.to,
        `a.${ext}#class:A`,
      );
      const dispatch = calls.find((e) => e.targetName === "a.go");
      assert.ok(dispatch);
      if (keep) assert.equal(dispatch.to, `a.${ext}#method:A.go`);
      else assert.equal(dispatch.to, null);
    });
  }
for (const ext of ["ts", "js"])
  test(`${ext}: inherited constructors keep super while changed prototypes stay uncertain`, () => {
    const source =
      "class A { x=0; constructor(x){this.x=x} } class B extends A { constructor(){super(7)} } function run(){return new B().x}";
    const g = observeTypescript([file("a." + ext, source)], version);
    assert.equal(
      g.edges.find((e) => e.targetName === "super")?.to,
      `a.${ext}#class:A`,
    );
    assert.equal(
      g.edges.find((e) => e.targetName === "B" && e.kind === "calls")?.to,
      `a.${ext}#class:B`,
    );
    const changed = observeTypescript(
      [file("a." + ext, source + "Object.setPrototypeOf(B, class C{});")],
      version,
    );
    assert.equal(
      changed.edges.find((e) => e.targetName === "super" && e.kind === "calls")
        ?.to,
      null,
    );
    assert.equal(
      changed.edges.find((e) => e.targetName === "B" && e.kind === "calls")?.to,
      null,
    );
  });
test("stateful Booking preserves refund dependency in full and split graphs", () => {
  const sources = (fee) => [
    file(
      "booking.ts",
      "import {refund} from './refund';class Booking{paid:number;constructor(paid:number){this.paid=paid}cancelValue(){return refund(this.paid)}} export function cancel(paid:number){const b=new Booking(paid);return b.cancelValue()}",
    ),
    file(
      "refund.ts",
      `export function refund(paid:number){return paid-${fee}}`,
    ),
  ];
  const read = (fs, split) =>
    split
      ? combinePartitions(
          fs.map((f) =>
            observeTypescript([f], version, {
              sourcePaths: fs.map((s) => s.path),
            }),
          ),
        )
      : observeTypescript(fs, version);
  for (const split of [false, true]) {
    const before = read(sources(5), split),
      after = read(sources(6), split);
    assert.equal(
      before.edges.find((e) => e.targetName === "Booking" && e.kind === "calls")
        ?.to,
      "booking.ts#class:Booking",
    );
    assert.equal(
      before.edges.find((e) => e.targetName === "b.cancelValue")?.to,
      "booking.ts#method:Booking.cancelValue",
    );
    assert.notEqual(
      dependencyHashes(before).get("booking.ts#function:cancel"),
      dependencyHashes(after).get("booking.ts#function:cancel"),
    );
  }
});

for (const ext of ["ts", "js"])
  test(`${ext}: anonymous default constructor returning another object never lends its original method target`, () => {
    const text =
      "export default class {x=0;constructor(){this.x=1;return {x:7,go(){return 7}}}go(){return 1}}";
    const code = ts.transpileModule(text, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const exports = {};
    Function("exports", code)(exports);
    assert.equal(new exports.default().go(), 7);
    const files = [
      file(
        "a." + ext,
        ext === "ts"
          ? text
          : ts.transpileModule(text, {
              compilerOptions: { target: ts.ScriptTarget.ES2022 },
            }).outputText,
      ),
      file(
        "b." + ext,
        `import A from './a.${ext}';export function run(){const a=new A();return a.go()}`,
      ),
    ];
    const graph = observeTypescript(files, version);
    assert.equal(
      graph.edges.find((e) => e.targetName === "A" && e.kind === "calls")?.to,
      null,
    );
    assert.equal(graph.edges.find((e) => e.targetName === "a.go")?.to, null);
  });
