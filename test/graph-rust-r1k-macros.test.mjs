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
