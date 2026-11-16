// SPDX-License-Identifier: MIT
// R1-K: project macros (statement neutrality, argument calls, body calls),
// derive opacity under `#[macro_use] mod`, and import shapes from the ripgrep
// trial. Each case has a negative twin that must stay unresolved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileFacts, contentHash, validateResult } from "../dist/graph/index.js";
const rust = (
  await import(
    process.env.RUST_TEST_MODULE ?? "../dist/graph/languages/rust/index.js"
  )
).default;
const app = '[package]\nname="app"\nedition="2021"\n';
async function graph(sources, manifests = { "Cargo.toml": app }) {
  const files = [];
  for (const [path, text] of Object.entries(sources)) {
    const result = await rust.parse({ path, text });
    validateResult(text, result);
    assert.equal(result.status, "clean", path);
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
    projectId: "r1k",
    files,
    contextFiles,
    changedFiles: files.map((f) => f.path),
    changedContextFiles: [],
  }))
    files.find((f) => f.path === a.path).result = a.result;
  const facts = files.map((f) => fileFacts("r1k", f));
  const symbols = facts.flatMap((f) => f.symbols);
  const links = facts.flatMap((f) => f.links);
  const output = await rust.resolve({
    projectId: "r1k",
    files,
    contextFiles,
    symbols,
    links,
  });
  const decisions = Array.isArray(output) ? output : output.resolutions;
  const derived = Array.isArray(output) ? [] : output.links;
  const byId = new Map(symbols.map((s) => [s.id, s]));
  const byLink = new Map(decisions.map((d) => [d.linkId, d]));
  const found = (name, kind) => {
    const ls = links.filter(
      (l) => l.targetName.replace(/\s+/g, "") === name && l.kind === kind,
    );
    assert.ok(ls.length, `${kind}: ${name} has a link`);
    return ls;
  };
  const targetsOf = (l) => {
    const d = byLink.get(l.id);
    return d?.targetId
      ? [byId.get(d.targetId)]
      : d?.candidateIds
        ? d.candidateIds.map((id) => byId.get(id))
        : [];
  };
  return {
    links,
    symbols,
    derived,
    one(name, identity, kind = "calls") {
      for (const l of found(name, kind)) {
        const ts = targetsOf(l);
        assert.equal(ts.length, 1, `${name} definite`);
        assert.equal(ts[0].identity, identity, name);
      }
    },
    unresolved(name, kind = "calls", reason) {
      for (const l of found(name, kind)) {
        assert.equal(targetsOf(l).length, 0, `${name} not definite`);
        if (reason)
          assert.match(String(l.data?.uncertainty ?? ""), reason, name);
      }
    },
    notDefinite(name, kind = "calls") {
      for (const l of found(name, kind))
        assert.notEqual(targetsOf(l).length, 1, `${name} not definite`);
    },
    targetFiles(name, kind = "calls") {
      return found(name, kind)
        .sort((a, b) => a.range.start - b.range.start)
        .map((l) => targetsOf(l).map((t) => `${t.identity}@${t.range.start}`));
    },
    none(name, kind = "calls") {
      assert.equal(
        links.filter(
          (l) => l.targetName.replace(/\s+/g, "") === name && l.kind === kind,
        ).length,
        0,
        `${name} has no ${kind} link`,
      );
    },
    derivedTo(name) {
      return derived
        .filter((l) => l.targetName === name)
        .map((l) => ({
          ...l,
          target: l.targetId ? byId.get(l.targetId) : null,
          source: symbols.find((s) => s.id === l.sourceId),
        }));
    },
  };
}

// --- Shape 2: a statement-level project macro and sibling names -----------

const neutral = `
macro_rules! log_it { ($($t:tt)*) => { eprintln!($($t)*); } }
fn helper() -> u8 { 1 }
fn run() { log_it!("x {}", 1); helper(); }
`;
test("neutral workspace macro leaves sibling names definite", async () => {
  const g = await graph({ "src/main.rs": neutral + "fn main(){run()}" });
  g.one("helper", "helper");
});

for (const [name, definition] of [
  ["item-defining", "macro_rules! m { () => { fn helper() -> u8 { 2 } } }"],
  [
    "tt forwarded to statement position",
    "macro_rules! m { ($($t:tt)*) => { $($t)* } }",
  ],
  ["let binding", "macro_rules! m { () => { let _unused = 1; } }"],
  [
    "unreadable nested macro",
    "macro_rules! m { () => { other_crate_macro!(); } }",
  ],
  [
    "metavariable used as a macro name",
    "macro_rules! m { ($n:ident) => { $n!(); } }",
  ],
])
  test(`${name} workspace macro still blocks sibling names`, async () => {
    const g = await graph({
      "src/main.rs": `${definition}\nfn helper() -> u8 { 1 }\nfn run() { m!(); helper(); }\nfn main(){run()}`,
    });
    g.unresolved("helper", "calls", /opaque-item-may-shadow-name/);
  });

test("if let in a macro body binds only inside its block", async () => {
  const g = await graph({
    "src/main.rs": `macro_rules! m { ($e:expr) => { if let Some(_v) = $e { eprintln!("x"); } } }
fn helper() -> u8 { 1 }
fn run() { m!(Some(1)); helper(); }
fn main(){ run() }`,
  });
  g.one("helper", "helper");
});

test("macro defined in another crate without macro_export blocks", async () => {
  const g = await graph(
    {
      "src/main.rs":
        "fn helper() -> u8 { 1 }\nfn run() { m!(); helper(); }\nfn main(){run()}",
      "other/src/lib.rs":
        "macro_rules! m { () => { eprintln!(); } }\npub fn f(){ m!(); }",
    },
    {
      "Cargo.toml":
        app +
        '[workspace]\nmembers=["other"]\n[dependencies]\nother={path="other"}\n',
      "other/Cargo.toml": '[package]\nname="other"\nedition="2021"\n',
    },
  );
  g.unresolved("helper", "calls", /opaque-item-may-shadow-name/);
});

test("neutral chain through nested workspace macros (ripgrep messages)", async () => {
  const g = await graph({
    "src/main.rs": `#[macro_use]
mod messages;
fn eprint_nothing_searched() {}
fn search() -> u8 { err_message!("{}", 1); eprint_nothing_searched(); 0 }
fn main(){ search(); }`,
    "src/messages.rs": `
macro_rules! eprintln_locked {
    ($($tt:tt)*) => {{
        {
            use std::io::Write;
            let mut stderr = std::io::stderr().lock();
            if let Err(err) = writeln!(stderr, $($tt)*) {
                if err.kind() == std::io::ErrorKind::BrokenPipe { std::process::exit(0); }
            }
        }
    }}
}
macro_rules! message {
    ($($tt:tt)*) => { if crate::messages::messages() { eprintln_locked!($($tt)*); } }
}
macro_rules! err_message {
    ($($tt:tt)*) => { crate::messages::set_errored(); message!($($tt)*); }
}
pub(crate) fn messages() -> bool { true }
pub(crate) fn set_errored() {}
`,
  });
  g.one("eprint_nothing_searched", "eprint_nothing_searched");
  // Body calls are attributed to the invoking function.
  const set = g.derivedTo("crate::messages::set_errored");
  assert.equal(set.length, 1);
  assert.equal(set[0].target?.identity, "set_errored");
  assert.equal(set[0].source?.identity, "search");
  const messages = g.derivedTo("crate::messages::messages");
  assert.equal(
    messages[0]?.target?.identity,
    "messages",
    "transitive body call",
  );
});

test("an unproved module-level macro does not unsettle locals in functions", async () => {
  const g = await graph({
    "src/main.rs": `some_crate::register!(Thing);
struct R; impl R { fn name(&self) -> u8 { 1 } }
fn run(config: &R) { let _n = config.name(); assert!(true); }
fn main(){ run(&R) }`,
  });
  g.one("config.name", "impl R::name");
});

test("standard statement macros do not block sibling names", async () => {
  const g = await graph({
    "src/main.rs":
      'fn helper() -> u8 { 1 }\nfn run() { println!("a"); assert!(true); helper(); }\nfn main(){run()}',
  });
  g.one("helper", "helper");
});

test("a standard name rebound by a neutral workspace macro is judged as that macro", async () => {
  const g = await graph({
    "src/main.rs": `macro_rules! writeln { ($($tt:tt)*) => { std::writeln!($($tt)*).unwrap(); } }
fn helper() -> u8 { 1 }
fn run(s: &mut String) { use std::fmt::Write; writeln!(s, "{}", helper()); helper(); }
fn main(){ run(&mut String::new()) }`,
  });
  g.one("helper", "helper");
});

test("a standard name rebound by an item-defining macro blocks", async () => {
  const g = await graph({
    "src/main.rs": `macro_rules! println { ($($tt:tt)*) => { fn helper() -> u8 { 2 } } }
fn helper() -> u8 { 1 }
fn run() { println!("x"); helper(); }
fn main(){ run() }`,
  });
  g.unresolved("helper", "calls", /opaque-item-may-shadow-name/);
});

test("a same-named macro_rules out of textual scope does not affect std uses", async () => {
  const g = await graph({
    "src/main.rs": `mod doc { macro_rules! writeln { ($($tt:tt)*) => { fn helper() {} } } pub fn f(){} }
fn helper() -> u8 { 1 }
fn run(s: &mut String) { use std::fmt::Write; writeln!(s, "x").unwrap(); helper(); }
fn main(){ run(&mut String::new()); doc::f() }`,
  });
  g.one("helper", "helper");
});

// --- Shape 1: calls in macro arguments -------------------------------------

test("calls in standard format arguments resolve", async () => {
  const g = await graph({
    "src/main.rs": `struct S; impl S { fn name(&self) -> u8 { 1 } }
fn helper() -> u8 { 1 }
fn run(s: &S) {
    println!("{} {}", helper(), s.name());
    let _x = format!("{v}", v = crate::helper());
    assert_eq!(helper(), 1, "{}", helper());
    let _v = vec![helper(); 2];
}
fn main(){ run(&S) }`,
  });
  g.one("helper", "helper");
  g.one("crate::helper", "helper");
  g.one("s.name", "impl S::name");
});

test("calls forwarded through a workspace macro resolve", async () => {
  const g = await graph({
    "src/main.rs": `macro_rules! log_it { ($($t:tt)*) => { eprintln!($($t)*); } }
fn helper() -> u8 { 1 }
fn run() { log_it!("{}", helper()); }
fn main(){ run() }`,
  });
  g.one("helper", "helper");
});

test("calls in an unknown macro's arguments are unverified", async () => {
  const g = await graph({
    "src/main.rs": `fn helper() -> u8 { 1 }
fn run() { let _ = some_crate::json!(helper()); }
fn main(){ run() }`,
  });
  g.unresolved("helper", "calls", /macro-argument-unverified/);
});

test("tokens a workspace macro stringifies are unverified", async () => {
  const g = await graph({
    "src/main.rs": `macro_rules! s { ($($t:tt)*) => { stringify!($($t)*) } }
fn helper() -> u8 { 1 }
fn run() -> &'static str { s!(helper()) }
fn main(){ run(); }`,
  });
  g.unresolved("helper", "calls", /macro-argument-unverified/);
});

test("a forwarding macro that defines an item around its arguments is unverified", async () => {
  const g = await graph({
    "src/main.rs": `macro_rules! sh { ($($t:tt)*) => {{ fn helper() -> u8 { 2 } println!($($t)*) }} }
fn helper() -> u8 { 1 }
fn run() { sh!("{}", helper()); }
fn main(){ run() }`,
  });
  g.unresolved("helper", "calls", /macro-argument-unverified/);
});

test("argument pieces with closures or bindings are not read", async () => {
  const g = await graph({
    "src/main.rs": `fn helper(x: u8) -> u8 { x }
fn run() { println!("{}", (|x| helper(x))(1)); println!("{}", match 1 { y => helper(y) }); }
fn main(){ run() }`,
  });
  g.none("helper");
});

test("matches! reads only its expression, not the pattern", async () => {
  const g = await graph({
    "src/main.rs": `fn helper() -> Option<u8> { None }
fn run() -> bool { matches!(helper(), Some(_)) }
fn main(){ run(); }`,
  });
  g.one("helper", "helper");
  g.none("Some");
});

test("a local closure named like a function stays unresolved inside arguments", async () => {
  const g = await graph({
    "src/main.rs": `fn helper() -> u8 { 1 }
fn run() { let helper = || 2u8; println!("{}", helper()); }
fn main(){ run() }`,
  });
  g.unresolved("helper");
});

// --- Shape 1: calls written in a macro body --------------------------------

test("a multi-arm macro's body calls are possible, not definite", async () => {
  const g = await graph({
    "src/main.rs": `macro_rules! m { () => { crate::a(); }; ($e:expr) => { crate::b(); } }
fn a() {} fn b() {}
fn run() { m!(); }
fn main(){ run() }`,
  });
  const a = g.derivedTo("crate::a");
  assert.equal(a.length, 1);
  assert.equal(a[0].targetId, undefined);
  assert.match(a[0].data.uncertainty, /macro-arm-unverified/);
  assert.deepEqual(a[0].data.targets.length, 1);
});

test("a bare body call in an arm that binds locals is unverified", async () => {
  const g = await graph({
    "src/main.rs": `macro_rules! m { () => { let f = || (); f(); helper(); } }
fn helper() {} fn f() {}
fn run() { m!(); }
fn main(){ run() }`,
  });
  for (const name of ["f", "helper"]) {
    const ls = g.derivedTo(name);
    assert.equal(ls.length, 1, name);
    assert.match(ls[0].data.uncertainty, /macro-body-name-unverified/);
  }
});

test("$crate body calls resolve in the defining crate", async () => {
  const g = await graph(
    {
      "src/main.rs": "fn run() { other::m!(); }\nfn main(){ run() }",
      "other/src/lib.rs":
        "#[macro_export]\nmacro_rules! m { () => { $crate::inner::touch(); } }\npub mod inner { pub fn touch() {} }",
    },
    {
      "Cargo.toml":
        app +
        '[workspace]\nmembers=["other"]\n[dependencies]\nother={path="other"}\n',
      "other/Cargo.toml": '[package]\nname="other"\nedition="2021"\n',
    },
  );
  const ls = g.derivedTo("crate::inner::touch");
  assert.equal(ls.length, 1);
  assert.equal(ls[0].target?.file, "other/src/lib.rs");
  assert.equal(ls[0].source?.identity, "run");
});

// --- Shape 3: derive opacity, imports, facades -----------------------------

const matcher = {
  "matcher/src/lib.rs":
    "pub struct Match { s: usize }\nimpl Match { pub fn new(s: usize) -> Match { Match { s } } pub fn start(&self) -> usize { self.s } }",
  "matcher/Cargo.toml": '[package]\nname="grep-matcher"\nedition="2021"\n',
};
const withMatcher = (extra = "") => ({
  "Cargo.toml":
    app +
    '[workspace]\nmembers=["matcher"]\n[dependencies]\ngrep-matcher={path="matcher"}\n' +
    extra,
  "matcher/Cargo.toml": matcher["matcher/Cargo.toml"],
});

test("macro_use on a module does not make standard derives opaque", async () => {
  const g = await graph(
    {
      "src/main.rs":
        "#[macro_use]\nmod macros;\nmod lines;\nfn main(){ lines::run(); }",
      "src/macros.rs": "macro_rules! noop { () => {} }",
      "src/lines.rs":
        "use grep_matcher::Match;\n#[derive(Debug)]\npub struct Step;\npub fn run() -> Match { Match::new(0) }",
      "matcher/src/lib.rs": matcher["matcher/src/lib.rs"],
    },
    withMatcher(),
  );
  g.one("grep_matcher::Match", "Match", "imports");
  g.one("Match::new", "impl Match::new");
});

test("bare macro_use extern crate keeps derives opaque", async () => {
  const g = await graph(
    {
      "src/main.rs":
        "#[macro_use]\nextern crate serde_derive;\nmod lines;\nfn main(){ lines::run(); }",
      "src/lines.rs":
        "use grep_matcher::Match;\n#[derive(Debug)]\npub struct Step;\npub fn run() -> Match { Match::new(0) }",
      "matcher/src/lib.rs": matcher["matcher/src/lib.rs"],
    },
    withMatcher('serde_derive="1"\n'),
  );
  g.unresolved("Match::new");
});

test("Match::new with two glob-imported Match types does not resolve", async () => {
  const g = await graph({
    "src/main.rs": `mod a { pub struct Match; impl Match { pub fn new() -> Match { Match } } }
mod b { pub struct Match; impl Match { pub fn new() -> Match { Match } } }
mod c { use crate::a::*; use crate::b::*; pub fn run() { let _ = Match::new(); } }
fn main(){ }`,
  });
  g.notDefinite("Match::new");
});

test("an inner import shadows an outer one", async () => {
  const g = await graph({
    "src/main.rs": `mod a { pub struct Match; impl Match { pub fn new() -> Match { Match } } }
mod b { pub struct Match; impl Match { pub fn new() -> Match { Match } } }
use a::Match;
fn run() { use crate::b::Match; let _ = Match::new(); }
fn main(){ run(); let _ = Match::new(); }`,
  });
  const [inner, outer] = g.targetFiles("Match::new");
  // run() sees b's Match::new (declared second), main() sees a's.
  assert.equal(inner.length, 1);
  assert.equal(outer.length, 1);
  assert.match(inner[0], /^b::impl Match::new@/);
  assert.match(outer[0], /^a::impl Match::new@/);
});

test("a path through a facade's pub extern crate alias resolves", async () => {
  const g = await graph(
    {
      "src/main.rs": "fn main(){ let _ = grep::matcher::Match::new(0); }",
      "grep/src/lib.rs": "pub extern crate grep_matcher as matcher;",
      "matcher/src/lib.rs": matcher["matcher/src/lib.rs"],
    },
    {
      "Cargo.toml":
        app +
        '[workspace]\nmembers=["matcher","grep"]\n[dependencies]\ngrep={path="grep"}\n',
      "grep/Cargo.toml":
        '[package]\nname="grep"\nedition="2021"\n[dependencies]\ngrep-matcher={path="../matcher"}\n',
      "matcher/Cargo.toml": matcher["matcher/Cargo.toml"],
    },
  );
  g.one("grep::matcher::Match::new", "impl Match::new");
});

// --- Round 2: expansions that change bindings or remove calls --------------
// Every program below is in evidence/r1-k/controls2/ with the rustc output it
// was checked against (rustc 1.98.1): `prints 2` means the macro-introduced
// helper() was the one called, so a definite link to the outer one is wrong.

const main = (source) => graph({ "src/main.rs": source });
const derivedState = (g, name) =>
  g.derivedTo(name).map((l) => (l.targetId ? l.target.identity : null));

test("a nested item-defining macro rebinds forwarded and body names (prints 2 2)", async () => {
  const g = await main(`fn helper()->u8 { 1 }
macro_rules! bind {()=>{fn helper()->u8 { 2 }}}
macro_rules! m {($($t:tt)*)=>{{
    bind!(); println!($($t)*); println!("{}",helper());
}}}
fn main(){m!("{}",helper());}`);
  g.unresolved("helper", "calls", /macro-argument-unverified/);
  const body = g.derivedTo("helper");
  assert.equal(body.length, 1);
  assert.equal(body[0].targetId, undefined);
  assert.match(body[0].data.uncertainty, /macro-expansion-unverified/);
});

test("twin: a harmless nested macro keeps both definite (prints 1 1)", async () => {
  const g = await main(`fn helper()->u8 { 1 }
macro_rules! note {()=>{ eprintln!("note"); }}
macro_rules! m {($($t:tt)*)=>{{
    note!(); println!($($t)*); println!("{}",helper());
}}}
fn main(){m!("{}",helper());}`);
  g.one("helper", "helper");
  assert.deepEqual(derivedState(g, "helper"), ["helper"]);
});

test("an unreadable nested macro in the body fails closed", async () => {
  const g = await main(`fn helper()->u8 { 1 }
macro_rules! m {($($t:tt)*)=>{{
    some_crate::anything!(); println!($($t)*); println!("{}",helper());
}}}
fn main(){m!("{}",helper());}`);
  g.unresolved("helper", "calls", /macro-argument-unverified/);
  assert.deepEqual(derivedState(g, "helper"), [null]);
});

test("a local at a function-local macro's definition captures body names (prints 2)", async () => {
  const g = await main(`fn helper()->u8 { 1 }
fn main() {
    let helper=||2;
    macro_rules! m {()=>{println!("{}",helper());}}
    m!();
}`);
  const body = g.derivedTo("helper");
  assert.equal(body.length, 1);
  assert.equal(body[0].targetId, undefined);
  assert.match(body[0].data.uncertainty, /macro-body-name-unverified/);
});

test("twin: a call-site local does not capture a module-level macro's body name (prints 1)", async () => {
  const g = await main(`fn helper()->u8 { 1 }
macro_rules! m {()=>{println!("{}",helper());}}
fn main() { let helper=||2; let _ = helper(); m!(); }`);
  assert.deepEqual(derivedState(g, "helper"), ["helper"]);
});

test("a cfg-removed body call is not definite (prints end)", async () => {
  const g = await main(`fn helper() { println!("called"); }
macro_rules! m {()=>{{#[cfg(any())] helper();}}}
fn main(){m!(); println!("end");}`);
  assert.deepEqual(derivedState(g, "helper"), [null]);
});

test("a cfg-guarded forwarding is not definite (prints end)", async () => {
  const g = await main(`fn helper()->u8 { println!("called"); 1 }
macro_rules! m {($($t:tt)*)=>{{ #[cfg(any())] println!($($t)*); }}}
fn main(){m!("{}",helper()); println!("end");}`);
  g.unresolved("helper", "calls", /macro-argument-unverified/);
});

test("twin: the same body call without cfg is definite (prints called)", async () => {
  const g = await main(`fn helper() { println!("called"); }
macro_rules! m {()=>{{ helper(); }}}
fn main(){m!();}`);
  assert.deepEqual(derivedState(g, "helper"), ["helper"]);
});

test("a macro factory's generated definition is not a call site (prints before verbosity)", async () => {
  const g = await main(`fn verbosity()->u8 { println!("verbosity"); 1 }
macro_rules! define { ($n:ident) => { macro_rules! $n { () => { verbosity() } } } }
define!(v);
fn main(){ println!("before"); let _ = v!(); }`);
  assert.equal(g.derivedTo("verbosity").length, 0);
});

test("a let in the body does not capture forwarded tokens (prints 1)", async () => {
  const g = await main(`fn helper()->u8 { 1 }
macro_rules! m {($($t:tt)*)=>{{ let helper = || 2u8; let _ = helper(); println!($($t)*); }}}
fn main(){ m!("{}", helper()); }`);
  g.one("helper", "helper");
});

test("a let in the body captures the body's own name (prints 2)", async () => {
  const g = await main(`fn helper()->u8 { 1 }
macro_rules! m {()=>{{ let helper = || 2u8; println!("{}", helper()); }}}
fn main(){ m!(); }`);
  assert.deepEqual(derivedState(g, "helper"), [null]);
});

test("a fn in the body rebinds forwarded tokens (prints 2)", async () => {
  const g = await main(`fn helper()->u8 { 1 }
macro_rules! m {($($t:tt)*)=>{{ fn helper()->u8 { 2 } println!($($t)*); }}}
fn main(){ m!("{}", helper()); }`);
  g.unresolved("helper", "calls", /macro-argument-unverified/);
});

test("forwarded tokens inside a closure or a loop with its own binding stay call-site (prints 1 1)", async () => {
  const g = await main(`fn helper()->u8 { 1 }
macro_rules! c {($($t:tt)*)=>{{ let f = || println!($($t)*); f(); }}}
macro_rules! l {($($t:tt)*)=>{{ for helper in 0..1u8 { let _ = helper; println!($($t)*); } }}}
fn main(){ c!("{}", helper()); l!("{}", helper()); }`);
  g.one("helper", "helper");
});

test("an expr argument placed after a const fn of the same name gets no definite link (prints 3)", async () => {
  const g = await main(`fn helper()->u8 { 1 }
macro_rules! k {($e:expr)=>{{ const fn helper()->u8 { 3 } const X: u8 = $e; X }}}
fn main(){ println!("{}", k!(helper())); }`);
  // Inside a non-standard macro nested in println!'s arguments: no link.
  g.none("helper");
});

test("duplicated forwarding is still the same call (prints called 1 called 1)", async () => {
  const g = await main(`fn helper()->u8 { println!("called"); 1 }
macro_rules! d {($($t:tt)*)=>{{ println!($($t)*); println!($($t)*); }}}
fn main(){ d!("{}", helper()); }`);
  g.one("helper", "helper");
});

test("tokens consumed by stringify!/concat! are not calls (prints helper() x)", async () => {
  const direct = await main(`fn helper()->u8 { 1 }
macro_rules! s {($($t:tt)*)=>{ stringify!($($t)*) }}
fn main(){ let _ = s!(helper()); }`);
  direct.unresolved("helper", "calls", /macro-argument-unverified/);
  const g = await main(`fn helper()->u8 { println!("called"); 1 }
macro_rules! s {($($t:tt)*)=>{ stringify!($($t)*) }}
macro_rules! c {($($t:tt)*)=>{ concat!("x") }}
fn main(){ println!("{} {}", s!(helper()), c!(helper())); }`);
  g.none("helper");
});

test("an arm chosen by pattern leaves forwarding and body calls unproved (prints 2 1)", async () => {
  const g = await main(`fn helper()->u8 { 1 }
fn other()->u8 { 2 }
macro_rules! m { (x) => { println!("{}", other()) }; ($($t:tt)*) => { println!($($t)*) } }
fn main(){ m!(x); m!("{}", helper()); }`);
  g.unresolved("helper", "calls", /macro-argument-unverified/);
  for (const state of derivedState(g, "other")) assert.equal(state, null);
});

test("a recursive tt-muncher's arguments are not definite (prints no call)", async () => {
  const g = await main(`fn helper()->u8 { 1 }
macro_rules! r { () => {}; ($h:tt $($t:tt)*) => { r!($($t)*) } }
fn main(){ r!(helper()); println!("no call"); }`);
  g.unresolved("helper", "calls", /macro-argument-unverified/);
});

test("a cfg on the invoking statement removes its argument calls (prints end)", async () => {
  const g = await main(`fn helper()->u8 { println!("called"); 1 }
fn main(){ #[cfg(any())] println!("{}", helper()); println!("end"); }`);
  g.notDefinite("helper");
});

test("a glob or named use in the body rebinds forwarded tokens (prints 2)", async () => {
  for (const use of ["use crate::other::*;", "use crate::other::helper;"]) {
    const g = await main(`mod other { pub fn helper()->u8 { 2 } }
fn helper()->u8 { 1 }
macro_rules! m {($($t:tt)*)=>{{ ${use} println!($($t)*); }}}
fn main(){ m!("{}", helper()); }`);
    g.unresolved("helper", "calls", /macro-argument-unverified/);
  }
});

test("a body call in a repetition may not happen at all", async () => {
  const g = await main(`fn helper(_: u8) {}
macro_rules! each { ($($x:expr),*) => { $( helper($x); )* } }
fn main(){ each!(); }`);
  assert.deepEqual(derivedState(g, "helper"), [null]);
});

test("crate:: in an exported macro body resolves at the call site, $crate:: at the definition (prints crate:app dollar:a)", async () => {
  const g = await graph(
    {
      "src/main.rs":
        'fn f() -> &\'static str { "app" }\nfn main(){ other::m!(); }',
      "other/src/lib.rs":
        'pub fn f() -> &\'static str { "a" }\n#[macro_export] macro_rules! m { () => { println!("crate:{} dollar:{}", crate::f(), $crate::f()); } }',
    },
    {
      "Cargo.toml":
        app +
        '[workspace]\nmembers=["other"]\n[dependencies]\nother={path="other"}\n',
      "other/Cargo.toml": '[package]\nname="other"\nedition="2021"\n',
    },
  );
  const files = g
    .derivedTo("crate::f")
    .map((l) => l.target?.file)
    .sort();
  assert.deepEqual(files, ["other/src/lib.rs", "src/main.rs"]);
});

test("self::/super:: inside a module the macro generates are not resolved one module out (prints 43)", async () => {
  const g = await main(`mod outer {
    pub fn helper() -> i32 { 1 }
    fn local() -> i32 { 2 }
    macro_rules! gen { () => { mod g { pub fn run() -> i32 { super::helper() * 10 + self::local() } fn local() -> i32 { 3 } } } }
    pub mod site {
        pub fn helper() -> i32 { 4 }
        fn local() -> i32 { 5 }
        gen!();
        pub fn go() -> i32 { let _ = local(); g::run() }
    }
    pub fn x() -> i32 { local() + helper() }
}
fn main() { println!("{}", outer::site::go()); }`);
  for (const name of ["super::helper", "self::local"])
    for (const l of g.derivedTo(name)) {
      assert.equal(l.targetId, undefined, name);
      assert.match(l.data.uncertainty, /macro-expansion-unverified/);
    }
});

test("a cfg on a call in a macro body leaves the derived call unproved (prints end)", async () => {
  const g = await graph(
    {
      "src/main.rs": `pub fn emit(s: &str) { println!("emit {s}"); }
macro_rules! trace { () => { #[cfg(feature = "trace")] $crate::emit("x"); } }
fn main() { trace!(); println!("end"); }`,
    },
    { "Cargo.toml": app + "[features]\ntrace=[]\n" },
  );
  const ls = g.derivedTo("crate::emit");
  assert.equal(ls.length, 1);
  assert.equal(ls[0].targetId, undefined);
  assert.match(ls[0].data.uncertainty, /macro-expansion-unverified/);
});

// --- Round 3: path properties through nested macros ------------------------
// Programs and rustc output: evidence/r1-k/controls3/.

const notDefiniteDerived = (g, name) => {
  const ls = g.derivedTo(name);
  assert.ok(ls.length, `${name}: derived link exists`);
  for (const l of ls) assert.equal(l.targetId, undefined, name);
};

test("a use in the expansion rebinding a nested macro name: argument (prints 2)", async () => {
  const g = await main(`fn helper()->u8 {1}
#[macro_export] macro_rules! other {
    ($($t:tt)*)=>{{fn helper()->u8 {2} std::println!($($t)*);}}
}
macro_rules! m {
    ($($t:tt)*)=>{{use crate::other as println; println!($($t)*);}}
}
fn main(){m!("{}",helper());}`);
  g.notDefinite("helper");
});

test("a use in the expansion rebinding a nested macro name: body call (prints 2)", async () => {
  const g = await main(`fn helper()->u8 {1}
#[macro_export] macro_rules! other {
    ($($t:tt)*)=>{{fn helper()->u8 {2} std::println!($($t)*);}}
}
macro_rules! m { ()=>{{use crate::other as println; println!("{}",helper());}} }
fn main(){m!();}`);
  notDefiniteDerived(g, "helper");
});

test("twin: a use that binds no macro name the expansion invokes (prints 1)", async () => {
  const g = await main(`fn helper()->u8 {1}
macro_rules! m { ($($t:tt)*)=>{{use std::fmt::Write as _W; println!($($t)*);}} }
fn main(){m!("{}",helper());}`);
  g.one("helper", "helper");
});

test("a project println! is not the standard one: body call (prints end)", async () => {
  const g = await main(`fn helper()->u8 {println!("CALLED");1}
macro_rules! println {($($t:tt)*)=>{}}
macro_rules! m {()=>{{println!("{}",helper());}}}
fn main(){m!();std::println!("end");}`);
  notDefiniteDerived(g, "helper");
});

test("a project println! is not the standard one: forwarding (prints end)", async () => {
  const g = await main(`fn helper()->u8 {std::println!("CALLED");1}
macro_rules! println {($($t:tt)*)=>{}}
macro_rules! m {($($t:tt)*)=>{{println!($($t)*);}}}
fn main(){m!("{}",helper());std::println!("end");}`);
  g.notDefinite("helper");
});

test("twin: the standard println! in a body is read (prints CALLED 1 end)", async () => {
  const g = await main(`fn helper()->u8 {println!("CALLED");1}
macro_rules! m {()=>{{println!("{}",helper());}}}
fn main(){m!();println!("end");}`);
  assert.deepEqual(derivedState(g, "helper"), ["helper"]);
});

test("repetition propagates through a nested macro (prints end)", async () => {
  const g = await main(`fn helper(x:u8){println!("{x}")}
macro_rules! n {($x:expr)=>{helper($x);}}
macro_rules! m {($($x:expr),*)=>{$(n!($x);)*}}
fn main(){m!();println!("end");}`);
  notDefiniteDerived(g, "helper");
});

test("twin: the same nesting without a repetition is definite (prints 1 end)", async () => {
  const g = await main(`fn helper(x:u8){println!("{x}")}
macro_rules! n {($x:expr)=>{helper($x);}}
macro_rules! m {($x:expr)=>{n!($x);}}
fn main(){m!(1);println!("end");}`);
  assert.deepEqual(derivedState(g, "helper"), ["helper"]);
});

test("an attribute propagates through a nested macro (prints end)", async () => {
  const g = await main(`fn helper(){println!("called")}
macro_rules! n {()=>{helper();}}
macro_rules! m {()=>{{ #[cfg(any())] n!(); }}}
fn main(){m!();println!("end");}`);
  notDefiniteDerived(g, "helper");
});

test("twin: the same nesting without the attribute is definite (prints called end)", async () => {
  const g = await main(`fn helper(){println!("called")}
macro_rules! n {()=>{helper();}}
macro_rules! m {()=>{{ n!(); }}}
fn main(){m!();println!("end");}`);
  assert.deepEqual(derivedState(g, "helper"), ["helper"]);
});

test("a nested macro invoked inside a generated definition is not followed (prints end)", async () => {
  const g = await main(`fn helper(){println!("called")}
macro_rules! n {()=>{helper();}}
macro_rules! m {()=>{ macro_rules! g { () => { n!(); } } }}
m!();
fn main(){println!("end");}`);
  assert.equal(g.derivedTo("helper").length, 0);
});

test("a function-local nested macro's body name is not definite (prints 2)", async () => {
  const g = await main(`fn helper()->u8 {1}
macro_rules! m {()=>{ println!("{}", n!()) }}
fn main(){
    let helper = || 2u8;
    macro_rules! n {()=>{ helper() }}
    m!();
}`);
  notDefiniteDerived(g, "helper");
});

test("a function-local outer macro is carried down the path (conservative; rustc prints 1)", async () => {
  const g = await main(`fn helper()->u8 {1}
macro_rules! n {()=>{ helper() }}
fn main(){
    let helper = || 2u8; let _ = helper();
    macro_rules! m {()=>{ println!("{}", n!()) }}
    m!();
}`);
  notDefiniteDerived(g, "helper");
});

test("an unproven arm propagates through a nested macro (prints end)", async () => {
  const g = await main(`fn helper(){println!("called")}
macro_rules! n {()=>{helper();}}
macro_rules! m {()=>{ n!(); }; (x)=>{}}
fn main(){m!(x);println!("end");}`);
  for (const l of g.derivedTo("helper")) assert.equal(l.targetId, undefined);
});

test("a use propagates into a nested macro's forwarding (prints 2)", async () => {
  const g = await main(`fn helper()->u8 {1}
mod alt { #[macro_export] macro_rules! alt_print { ($($t:tt)*) => {{ fn helper()->u8 {2} std::println!($($t)*); }} } }
macro_rules! n {($($t:tt)*)=>{ println!($($t)*); }}
macro_rules! m {($($t:tt)*)=>{{ use crate::alt_print as println; n!($($t)*); }}}
fn main(){m!("{}",helper());}`);
  g.notDefinite("helper");
});

test("a block in format arguments that invokes an item-defining macro is not read (prints 2, ok, 2)", async () => {
  for (const body of [
    'println!("{}", { def!(); helper() });',
    'assert!({ def!(); helper() } == 2); println!("ok");',
    'println!("{}", if true { def!(); helper() } else { 0 });',
  ]) {
    const g = await main(`fn helper()->i32{1}
macro_rules! def{()=>{fn helper()->i32{2}}}
fn main(){ ${body} }`);
    g.none("helper");
  }
});

test("twin: a block in format arguments without a macro is read (prints 1 1)", async () => {
  const g = await main(`fn helper()->i32{1}
fn main(){ println!("{}", { helper() }); println!("{}", if true { helper() } else { 0 }); }`);
  g.one("helper", "helper");
});

// --- Round 4: the per-site name rule ---------------------------------------
// Programs and rustc output: evidence/r1-k/controls4/.

test("a project write! in textual scope at the site is not the standard one (prints end [])", async () => {
  const g = await main(`use std::fmt::Write as _;
fn helper() -> u8 { println!("CALLED"); 1 }
macro_rules! write { ($($t:tt)*) => { Ok::<(), std::fmt::Error>(()) } }
fn main() { let mut s = String::new(); let _ = write!(s, "{}", helper()); println!("end [{}]", s); }`);
  g.notDefinite("helper");
});

test("a project write! in a sibling module, not in scope at the site, leaves std's (prints [1])", async () => {
  const g = await main(`use std::fmt::Write as _;
fn helper() -> u8 { 1 }
mod doc { macro_rules! write { ($($t:tt)*) => { Ok::<(), std::fmt::Error>(()) } } pub fn f() { let _ = write!(String::new(), "x"); } }
fn main() { let mut s = String::new(); let _ = write!(s, "{}", helper()); doc::f(); println!("[{}]", s); }`);
  g.one("helper", "helper");
});

for (const [name, source] of [
  [
    "use … as println (prints end)",
    `fn helper() -> u8 { println!("CALLED"); 1 }
mod m { #[macro_export] macro_rules! quiet { ($($t:tt)*) => {} } }
use crate::quiet as println;
fn main() { println!("{}", helper()); std::println!("end"); }`,
  ],
  [
    "use of an exported println (prints end)",
    `fn helper() -> u8 { std::println!("CALLED"); 1 }
mod m { #[macro_export] macro_rules! println { ($($t:tt)*) => {} } }
mod site { use crate::println; pub fn go() { println!("{}", super::helper()); } }
fn main() { site::go(); std::println!("end"); }`,
  ],
  [
    "#[macro_use] on a parent module (prints end)",
    `fn helper() -> u8 { std::println!("CALLED"); 1 }
#[macro_use] mod macros { macro_rules! println { ($($t:tt)*) => {} } }
mod site { pub fn go() { println!("{}", super::helper()); } }
fn main() { site::go(); std::println!("end"); }`,
  ],
  [
    "a println defined earlier in the same function (prints end)",
    `fn helper() -> u8 { std::println!("CALLED"); 1 }
fn main() { macro_rules! println { ($($t:tt)*) => {} } println!("{}", helper()); std::println!("end"); }`,
  ],
  [
    "#[macro_use] extern crate outside the workspace (fails closed; not compiled)",
    `#[macro_use] extern crate some_external_crate;
fn helper() -> u8 { 1 }
fn main() { println!("{}", helper()); }`,
  ],
])
  test(`name rule: ${name} is not definite`, async () => {
    const g = await main(source);
    g.notDefinite(
      source.includes("super::helper()") ? "super::helper" : "helper",
    );
  });

test("name rule: #[macro_use] extern crate of a workspace crate exporting println (prints end)", async () => {
  const g = await graph(
    {
      "src/main.rs": `#[macro_use] extern crate m;
fn helper() -> u8 { std::println!("CALLED"); 1 }
fn main() { println!("{}", helper()); std::println!("end"); }`,
      "m/src/lib.rs":
        "#[macro_export] macro_rules! println { ($($t:tt)*) => {} }",
    },
    {
      "Cargo.toml":
        app + '[workspace]\nmembers=["m"]\n[dependencies]\nm={path="m"}\n',
      "m/Cargo.toml": '[package]\nname="m"\nedition="2021"\n',
    },
  );
  g.notDefinite("helper");
});

for (const [name, source] of [
  [
    "a println defined later in the file (prints 1)",
    `fn helper() -> u8 { 1 }
fn main() { println!("{}", helper()); }
macro_rules! println { ($($t:tt)*) => {} }`,
  ],
  [
    "a println defined inside another function (prints 1)",
    `fn helper() -> u8 { 1 }
fn other() { macro_rules! println { ($($t:tt)*) => {} } println!("x"); }
fn main() { other(); println!("{}", helper()); }`,
  ],
])
  test(`name rule: ${name} leaves std's, definite`, async () => {
    const g = await main(source);
    g.one("helper", "helper");
  });

test("name rule: imports of a fn, a module and std modules named like std macros bind no macro (prints [1] [1] 1)", async () => {
  const g = await main(`mod util { pub fn write() -> u8 { 9 } }
mod formatting { pub fn f() {} }
mod site {
    use crate::util::write;
    use crate::formatting as format;
    use std::vec;
    use std::panic;
    fn helper() -> u8 { 1 }
    pub fn go() {
        use std::fmt::Write as _;
        let mut s = String::new(); let _ = write!(s, "{}", helper());
        let v = vec![helper()]; let f = format!("{}", helper());
        if v.is_empty() { panic!("{}", helper()); }
        format::f(); let _ = write(); let _ = panic::catch_unwind(|| ());
        println!("[{}] {:?} {}", s, v, f);
    }
}
fn main() { site::go(); }`);
  g.one("helper", "site::helper");
});

test("name rule: globs are not consulted (a glob bringing a std-named macro is E0659 in rustc)", async () => {
  // Compiling code cannot have such a glob (controls4/glob, g1-g10); a glob
  // of a module or crate whose contents are unknown leaves the std macro.
  const g = await graph(
    {
      "src/main.rs": `mod helpers { pub fn helper() -> u8 { 1 } }
use helpers::*;
use some_external_crate::prelude::*;
fn main() { println!("{}", crate::helpers::helper()); }`,
    },
    { "Cargo.toml": app + '[dependencies]\nsome_external_crate="1"\n' },
  );
  g.one("crate::helpers::helper", "helpers::helper");
});

test("name rule: an import of an external path named like a std macro fails closed", async () => {
  const g = await graph(
    {
      "src/main.rs": `fn helper() -> u8 { 1 }
use some_external_crate::write;
fn main() { use std::fmt::Write as _; let mut s = String::new(); let _ = write!(s, "{}", helper()); }`,
    },
    { "Cargo.toml": app + '[dependencies]\nsome_external_crate="1"\n' },
  );
  g.notDefinite("helper");
});

test("transcriber names are looked up at the call site: def-site project writeln! is not used (prints [x])", async () => {
  const g = await main(`use std::fmt::Write;
fn helper() -> u8 { 1 }
mod a {
    macro_rules! writeln { ($($t:tt)*) => { Ok::<(), std::fmt::Error>(()) } }
    #[macro_export] macro_rules! outer { () => { { let mut s = String::new(); let _ = writeln!(s, "{}", crate::helper()); s } } }
}
fn main() { let s = crate::outer!(); println!("[{}]", s.trim()); }`);
  assert.deepEqual(derivedState(g, "crate::helper"), ["helper"]);
});

test("transcriber names are looked up at the call site: call-site project writeln! is used (prints [])", async () => {
  const g = await main(`use std::fmt::Write;
fn helper() -> u8 { 1 }
macro_rules! outer { () => { { let mut s = String::new(); let _ = writeln!(s, "{}", crate::helper()); s } } }
mod b {
    macro_rules! writeln { ($($t:tt)*) => { Ok::<(), std::fmt::Error>(()) } }
    pub fn go() -> String { outer!() }
}
fn main() { println!("[{}]", b::go().trim()); }`);
  assert.deepEqual(derivedState(g, "crate::helper"), [null]);
});

// --- Round 5: #[macro_export(local_inner_macros)] --------------------------
// Programs and rustc output: evidence/r1-k/controls5/.

const withM = (lib, app) =>
  graph(
    { "src/main.rs": app, "m/src/lib.rs": lib },
    {
      "Cargo.toml":
        '[package]\nname="app"\nedition="2021"\n[workspace]\nmembers=["m"]\n[dependencies]\nm={path="m"}\n',
      "m/Cargo.toml": '[package]\nname="m"\nedition="2021"\n',
    },
  );

test("local_inner_macros: a body call through the exporting crate's inner! is not definite (prints END)", async () => {
  const g = await withM(
    `#[macro_export] macro_rules! inner { () => {{}} }
#[macro_export(local_inner_macros)]
macro_rules! outer { () => { inner!(); } }`,
    `macro_rules! inner { () => { helper(); } }
fn helper() { std::println!("HELPER"); }
fn main() { m::outer!(); std::println!("END"); }`,
  );
  for (const l of g.derivedTo("helper")) assert.equal(l.targetId, undefined);
});

test("local_inner_macros: forwarded arguments are not definite (prints END)", async () => {
  const g = await withM(
    `#[macro_export] macro_rules! quiet { ($($t:tt)*) => {} }
#[macro_export(local_inner_macros)]
macro_rules! outer { ($($t:tt)*) => { quiet!($($t)*); } }`,
    `macro_rules! quiet { ($($t:tt)*) => { std::println!($($t)*); } }
fn helper() -> u8 { std::println!("HELPER"); 1 }
fn main() { m::outer!("{}", helper()); std::println!("END"); }`,
  );
  g.notDefinite("helper");
});

test("local_inner_macros: a bare println! there is $crate::println!, not std's (prints END)", async () => {
  const g = await withM(
    `#[macro_export] macro_rules! println { ($($t:tt)*) => {} }
#[macro_export(local_inner_macros)]
macro_rules! outer { ($($t:tt)*) => { println!($($t)*); } }`,
    `fn helper() -> u8 { std::println!("HELPER"); 1 }
fn main() { m::outer!("{}", helper()); std::println!("END"); }`,
  );
  g.notDefinite("helper");
});

test("twin: without local_inner_macros the bare inner! is the call site's (prints HELPER END)", async () => {
  const g = await withM(
    `#[macro_export] macro_rules! inner { () => {{}} }
#[macro_export]
macro_rules! outer { () => { inner!(); } }`,
    `macro_rules! inner { () => { helper(); } }
fn helper() { std::println!("HELPER"); }
fn main() { m::outer!(); std::println!("END"); }`,
  );
  assert.deepEqual(derivedState(g, "helper"), ["helper"]);
});
