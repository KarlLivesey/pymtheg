// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileFacts, contentHash, validateResult } from "../dist/graph/index.js";
const rust = (
  await import(
    process.env.RUST_TEST_MODULE ?? "../dist/graph/languages/rust/index.js"
  )
).default;
async function graph(
  sources,
  manifests = { "Cargo.toml": '[package]\nname="app"\nedition="2024"\n' },
) {
  const files = [];
  for (const [path, text] of Object.entries(sources)) {
    const result = await rust.parse({ path, text });
    validateResult(text, result);
    files.push({
      path,
      text,
      result,
      hash: contentHash(text),
      module: "rust",
      version: rust.version,
    });
  }
  const contextFiles = Object.entries(manifests).map(([path, text]) => ({
    path,
    text,
    hash: contentHash(text),
    status: "clean",
    diagnostics: [],
  }));
  for (const a of await rust.analyze({
    projectId: "review",
    files,
    contextFiles,
    changedFiles: files.map((f) => f.path),
    changedContextFiles: [],
  }))
    files.find((f) => f.path === a.path).result = a.result;
  const facts = files.map((f) => fileFacts("review", f));
  const symbols = facts.flatMap((f) => f.symbols);
  const links = facts.flatMap((f) => f.links);
  const resolved = await rust.resolve({
    projectId: "review",
    files,
    contextFiles,
    symbols,
    links,
  });
  const decisions = Array.isArray(resolved) ? resolved : resolved.resolutions;
  const byId = new Map(symbols.map((s) => [s.id, s]));
  const byLink = new Map(decisions.map((d) => [d.linkId, d]));
  function targets(name, kind = "calls") {
    const ls = links.filter((l) => l.targetName === name && l.kind === kind);
    assert.ok(ls.length, `${kind}: ${name}`);
    return ls.map((l) => {
      const d = byLink.get(l.id);
      return d?.targetId
        ? [byId.get(d.targetId)]
        : d?.candidateIds
          ? d.candidateIds.map((id) => byId.get(id))
          : [];
    });
  }
  function one(name, identity, kind = "calls") {
    const ts = targets(name, kind);
    for (const t of ts) {
      assert.equal(t.length, 1, name);
      assert.equal(t[0].identity, identity, name);
    }
  }
  function unknown(name, kind = "calls") {
    for (const t of targets(name, kind)) assert.equal(t.length, 0, name);
  }
  function would(name, kind = "calls") {
    return links
      .filter((l) => l.targetName === name && l.kind === kind)
      .map((l) => (l.data?.targets ?? []).map((id) => byId.get(id)));
  }
  function unverified(name, identity, kind = "calls") {
    unknown(name, kind);
    for (const ts of would(name, kind))
      assert.ok(
        ts.some((s) => s.identity === identity),
        `${name} retains ${identity}`,
      );
  }
  return {
    targets,
    would,
    unverified,
    one,
    unknown,
    files,
    contextFiles,
    symbols,
    links,
    decisions,
  };
}
const lib = (text) => ({ "src/lib.rs": text });
test("round 4 R1: every structural binding masks a free call", async () => {
  for (const [pattern, expr] of [
    ["S{f}", "s"],
    ["S{ref f}", "s"],
    ["S{mut f}", "s"],
    ["S{ref mut f}", "s"],
    ["S{f:f}", "s"],
    ["S{f:ref mut f}", "s"],
    ["f @ _", "s"],
    ["(f,_)", "s"],
    ["[f,..]", "s"],
    ["Some(f)", "s"],
    ["Some(f)|None", "s"],
  ]) {
    const g = await graph(
      lib(`fn f(){}struct S{f:fn()}fn run(${pattern}:S){f();}`),
    );
    g.one("f", "run");
    const l = await graph(
      lib(`fn f(){}struct S{f:fn()}fn run(s:S){let ${pattern}=${expr};f();}`),
    );
    l.one("f", "run");
  }
  for (const body of [
    "let c=|S{f}|f();",
    "if let S{f}=s{f();}",
    "while let S{f}=s{f();}",
    "let S{f}=s else{return;};f();",
    "match s{S{f}=>f()}",
    "for S{f} in xs{f();}",
  ])
    (await graph(lib(`fn f(){}struct S{f:fn()}fn run(s:S){${body}}`))).one(
      "f",
      "run",
    );
  const clean = await graph(
    lib(`fn f(){}struct S{f:fn()}fn run(s:S){if let S{f}=s{}else{f();}f();}`),
  );
  clean.one("f", "f");
});
test("round 4 R2: alias blankets and chains cannot disappear", async () => {
  for (const alias of [
    "type Id<T>=T;",
    "type Id<T>=(T);",
    "type Id<T>=Next<T>;type Next<X>=X;",
    "type Id<T>=&'static T;",
    "type Id<T>=Box<T>;",
    "type Id<T>=std::boxed::Box<T>;",
    "type Id<T>=(T,);",
  ]) {
    for (const inherent of [true, false]) {
      const g = await graph(
        lib(
          `${alias}struct A;trait Blanket{fn f(self){}}impl<T>Blanket for Id<T>{}${inherent ? "impl A{fn f(&self){}}" : "trait U{fn f(&self){}}trait V{fn f(&self){}}impl U for A{}impl V for A{}"}fn run(a:A){a.f();}`,
        ),
      );
      g.unknown("a.f");
      assert.ok(g.would("a.f")[0].length);
    }
  }
  const aliases = await graph(
    lib(`struct A;impl A{fn f(&self){}}type B=A;type C=B;fn run(x:C){x.f();}`),
  );
  aliases.one("x.f", "impl A::f");
  const ref = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}type Ref<'a>=&'a A;fn run(x:Ref<'_>){x.f();}`,
    ),
  );
  ref.one("x.f", "impl A::f");
  for (const alias of ["type X=external::Type;", "type X=Y;type Y=X;"])
    (
      await graph(
        lib(
          `${alias}struct A;trait T{fn f(self){}}impl T for X{}impl A{fn f(&self){}}fn run(a:A){a.f();}`,
        ),
      )
    ).unknown("a.f");
});
test("round 4 R3: standard blanket choices are unresolved with known targets", async () => {
  for (const name of [
    "from",
    "into",
    "try_from",
    "try_into",
    "borrow",
    "borrow_mut",
    "to_owned",
    "to_string",
    "type_id",
    "as_ref",
    "as_mut",
    "clone",
    "clone_from",
    "into_iter",
    "default",
  ]) {
    const g = await graph(
      lib(
        `use std::borrow::{Borrow,BorrowMut};use std::any::Any;struct A;impl A{fn ${name}(&self){}}fn run(a:A){a.${name}();A::${name}(&a);}`,
      ),
    );
    g.one(`A::${name}`, `impl A::${name}`);
    // C-10: `Into::into` and `TryInto::try_into` take `self` by value and
    // precede the autoref'd inherent method; the others are associated
    // functions, `&self` methods found after the inherent one, or traits A
    // does not implement.
    if (["into", "try_into"].includes(name)) {
      g.unknown(`a.${name}`);
      const l = g.links.find((l) => l.targetName === `a.${name}`);
      assert.equal(l.data.targets.length, 1);
      assert.ok(l.data.uncertainty);
    } else g.one(`a.${name}`, `impl A::${name}`);
  }
  for (const name of ["from", "try_from"]) {
    const g = await graph(
      lib(
        `struct A;trait From<T>{fn ${name}(t:T)->Self;}impl From<u8> for A{fn ${name}(x:u8)->Self{A}}impl From<u16> for A{fn ${name}(x:u16)->Self{A}}fn run(){A::${name}(A);}`,
      ),
    );
    g.unknown(`A::${name}`);
    assert.equal(
      g.links.find((l) => l.targetName === `A::${name}`).data.targets.length,
      2,
    );
  }
  const ordinary = await graph(
    lib(`struct A;impl A{fn ordinary(&self){}}fn r(a:A){a.ordinary();}`),
  );
  ordinary.one("a.ordinary", "impl A::ordinary");
});
test("round 4 R4: opaque statement macros invalidate binding evidence in order", async () => {
  const g = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}fn run(a:A){a.f();m!(a);a.f();let a:A=A;a.f();}`,
    ),
  );
  const t = g.targets("a.f");
  assert.equal(t[0].length, 0);
  assert.equal(g.would("a.f")[0].length, 1);
  assert.equal(t[1].length, 0);
  assert.equal(t[2].length, 0);
  assert.equal(g.would("a.f")[2].length, 1);
  const other = await graph(
    lib(`struct A;impl A{fn f(&self){}}fn run(a:A){m!(other);a.f();}`),
  );
  other.unverified("a.f", "impl A::f");
  const self = await graph(
    lib(`struct A;impl A{fn f(&self){}fn run(&self){m!(self);self.f();}}`),
  );
  self.one("self.f", "impl A::f"); // self has an immutable signature type; first probe wins.
});
test("round 4 R4: item macro type tokens prevent complete dispatch", async () => {
  for (const invocation of ["imp!(A);", "external::imp!(A);"]) {
    const g = await graph(
      lib(
        `struct A;impl A{fn f(&self){}}${invocation}fn run(a:A){a.f();A::f(&a);}`,
      ),
    );
    g.unknown("a.f");
    g.one("A::f", "impl A::f");
  }
  const nested = await graph(
    lib(`struct A;impl A{fn f(&self){}}fn run(a:A){imp!(A);a.f();}`),
  );
  nested.unknown("a.f");
  const qualified = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}mod m{pub fn run(x:crate::A){struct A;imp!(crate::A);x.f();}}`,
    ),
  );
  qualified.unknown("x.f");
  const other = await graph(
    lib(`struct A;struct B;impl A{fn f(&self){}}imp!(B);fn run(a:A){a.f();}`),
  );
  other.unverified("a.f", "impl A::f");
});
test("round 4 R5: fully generic inherent impls apply to all instantiations", async () => {
  for (const impl of [
    "impl<T>W<T>",
    "impl<T:Copy>W<T>",
    "impl<T>W<T>where T:Copy",
  ]) {
    const g = await graph(
      lib(
        `struct W<T>(T);${impl}{fn new(t:T)->Self{W(t)}fn get(&self)->&T{&self.0}}fn run(x:W<u8>){W::new(1);x.get();}`,
      ),
    );
    g.one(
      "W::new",
      `${impl.includes("Copy>") ? "impl<T:Copy>" : "impl<T>"} W<T>::new`,
    );
    if (impl === "impl<T>W<T>") g.one("x.get", "impl<T> W<T>::get");
    else g.unknown("x.get");
  }
  for (const specialised of ["impl<T>W<Vec<T>>", "impl W<u8>"]) {
    const g = await graph(
      lib(
        `struct W<T>(T);${specialised}{fn get(&self){}}fn run(x:W<String>){x.get();}`,
      ),
    );
    g.unknown("x.get");
  }
  const repeat = await graph(
    lib(
      `struct W<A,B>(A,B);impl<T>W<T,T>{fn get(&self){}}fn run(x:W<u8,String>){x.get();}`,
    ),
  );
  repeat.unknown("x.get");
});
test("round 4 R7: unit values are links in expression positions", async () => {
  const g = await graph(
    lib(
      `struct Unit;enum E{Single,Other}impl E{fn f()->Self{Self::Single}}fn run()->E{let a=Unit;let b=E::Other;E::Single}`,
    ),
  );
  g.one("Unit", "Unit", "values");
  g.one("Self::Single", "E::Single", "values");
  g.one("E::Other", "E::Other", "values");
  g.one("E::Single", "E::Single", "values");
  const shadow = await graph(lib(`struct Unit;fn run(Unit:u8){let x=Unit;}`));
  shadow.unknown("Unit", "values");
  const named = await graph(lib(`enum E{Named{x:u8}}fn r(){let _x=E::Named;}`));
  named.unknown("E::Named", "values");
});
test("round 4 alias expansion cannot turn a specialised impl into universal", async () => {
  const g = await graph(
    lib(
      `struct W<T>(T);type Special<T>=W<Vec<T>>;impl<T> Special<T>{fn new(){}fn f(&self){}}fn run(x:W<u8>){x.f();W::new();}`,
    ),
  );
  g.unknown("x.f");
  g.one("W::new", "impl<T> Special<T>::new"); // Single inherent path name lookup.
});
test("round 4 structural bindings start at their actual scope", async () => {
  const g = await graph(
    lib(
      `fn f()->u8{0}fn run(f:[u8;f() as usize]){}fn r(){for f in f(){f();}f();}`,
    ),
  );
  const ts = g.targets("f");
  assert.equal(ts[0].length, 0); // rustc: parameter is visible in its signature value expression.
  assert.equal(ts[1].length, 1);
  assert.equal(ts[2][0].identity, "r"); // the for binding, not the function
  assert.equal(ts[3].length, 1);
});
test("round 4 value self is a binding, not a module path", async () => {
  const g = await graph(lib(`struct A;impl A{fn f(self)->Self{self}}`));
  g.one("self", "impl A::f", "values");
});
test("round 4 generic inherent shared receiver precedes nominal trait adjustments", async () => {
  const g = await graph(
    lib(
      `struct W<T>(T);impl<T>external::Tr for W<T>{}impl<T>W<T>{fn f(&self){}fn run(&self){self.f();}}fn run(x:W<u8>,y:&W<u8>){x.f();y.f();}`,
    ),
  );
  g.one("self.f", "impl<T> W<T>::f");
  g.unknown("x.f");
  g.one("y.f", "impl<T> W<T>::f");
});
test("round 4 external shape dispatch retains captured project impl evidence", async () => {
  const g = await graph(
    lib(
      `type Id<T>=Box<T>;trait Tr{fn f(self){}}impl<T>Tr for Id<T>{fn f(self){}}fn run(x:Id<u8>){x.f();}`,
    ),
  );
  g.unknown("x.f");
  const l = g.links.find((l) => l.targetName === "x.f");
  assert.ok(
    l.data.targets.some(
      (id) =>
        g.symbols.find((s) => s.id === id)?.identity ===
        "impl<T> Tr for Id<T>::f",
    ),
  );
  assert.match(l.data.uncertainty, /receiver/);
});
test("round 4 custom receiver uncertainty retains known project members", async () => {
  const g = await graph(
    lib(
      `struct A;impl A{fn f(self:Box<Self>){}fn run(self:Box<Self>){self.f();}}`,
    ),
  );
  g.unknown("self.f");
  const l = g.links.find((l) => l.targetName === "self.f");
  assert.equal(l.data.targets.length, 1);
  assert.match(l.data.uncertainty, /later-probe|receiver/);
});
test("round 4 named-field variants remain imports and patterns, not bare values", async () => {
  const g = await graph(
    lib(
      `enum E{Named{x:u8}}use E::Named;fn run(value:E){let _v=E::Named;Named();match value{Named{x}=>{}}}`,
    ),
  );
  g.one("E::Named", "E::Named", "imports");
  g.one("Named", "E::Named", "patterns");
  g.unknown("E::Named", "values");
  g.unknown("Named");
});
test("round 4 alias applicability cannot poison a shared namespace cache", async () => {
  const g = await graph(
    lib(
      `struct A;impl A{fn f(&self){}}mod m{pub type Id<T>=T;}fn unknown(x:m::Id<crate::A>){x.f();}fn known(a:A){a.f();}`,
    ),
  );
  g.unknown("x.f");
  g.one("a.f", "impl A::f");
  const reverse = await rust.resolve({
    projectId: "review",
    files: g.files,
    contextFiles: g.contextFiles,
    symbols: g.symbols,
    links: [...g.links].reverse(),
  });
  const normalize = (xs) =>
    xs
      .map((x) => ({
        ...x,
        ...(x.candidateIds ? { candidateIds: [...x.candidateIds].sort() } : {}),
      }))
      .sort((a, b) => a.linkId.localeCompare(b.linkId));
  assert.deepEqual(normalize(g.decisions), normalize(reverse));
});
test("round 4 generic alias and reference Self do not capture same-named project types", async () => {
  const g = await graph(
    lib(
      `struct T;impl T{fn f(&self){}fn g(&self){}}type Id<X>=X;fn run<T>(x:Id<T>){x.f();}fn known(x:Id<crate::T>){x.g();}trait Tr{fn f(&self);}impl<T>Tr for &T{fn f(&self){self.g();}}`,
    ),
  );
  const ts = g.targets("x.f");
  assert.equal(ts[0].length, 0);
  g.one("x.g", "impl T::g");
  g.unknown("self.g");
});
