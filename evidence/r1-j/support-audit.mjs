// R1-J: checks the code-graph claims of docs/support.md by running the built
// CLI (`pymtheg graph … --json`) on small projects. One line per claim:
// {id, ok, observed}. Run from the repository root after `npm run build`:
//   node evidence/r1-j/support-audit.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const base = process.env.PYM_SCRATCH ?? tmpdir();
const cli = resolve("dist/cli/main.js");
let failures = 0;
function project(files) {
  const root = mkdtempSync(join(base, "audit-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const graph = (...args) => {
    const r = spawnSync(
      process.execPath,
      [cli, "graph", ...args, "--root", root, "--json"],
      { encoding: "utf8", maxBuffer: 1 << 28 },
    );
    try {
      return JSON.parse(r.stdout);
    } catch {
      throw Error(`graph ${args.join(" ")}: ${r.stderr || r.stdout}`);
    }
  };
  const links = (file) =>
    graph("file", file).data.links.map((l) => ({
      kind: l.kind,
      certainty: l.certainty,
      name: l.targetName,
      target: l.target?.identity ?? null,
      candidates: (l.candidates ?? []).map((c) => c.symbol?.identity ?? c.id),
      data: l.data,
      assumes: l.assumes,
    }));
  const symbols = (file) =>
    graph("file", file).data.symbols.map((s) => `${s.kind}:${s.identity}`);
  return { root, graph, links, symbols };
}
function claim(id, ok, observed) {
  if (!ok) failures++;
  console.log(JSON.stringify({ id, ok: !!ok, observed }));
}
const call = (links, name) =>
  links.filter((l) => l.kind === "calls" && l.name === name);
const one = (links, name) => call(links, name)[0] ?? null;
const brief = (l) =>
  l && {
    certainty: l.certainty,
    target: l.target,
    candidates: l.candidates,
    data: l.data,
  };

// ---------------------------------------------------------------- general
{
  const p = project({
    "go.mod": "module ex/m\n\ngo 1.22\n",
    "a.go": "package m\n\nfunc A() { B() }\n",
    "b.go": "package m\n\nfunc B() { \n",
    "x.ts": "export const x = 1;\n",
    "Cargo.toml": '[package]\nname = "r"\nversion = "0.1.0"\nedition = "2021"\n',
    "src/lib.rs": "pub fn r() {}\n",
    ".codegraph/c.go": "package bad {\n",
  });
  const first = p.graph("index");
  claim(
    "general/modules",
    first.modules.map((m) => m.id).join() === "go,rust,typescript" &&
      first.modules.every((m) => m.version && m.indexedVersions),
    first.modules,
  );
  claim(
    "general/.codegraph-not-read",
    !first.failedFiles.some((f) => f.path.startsWith(".codegraph")) &&
      first.sync.report.claimed === 4,
    { claimed: first.sync.report.claimed, failed: first.sync.report.failed },
  );
  claim(
    "general/failed-file-no-symbols",
    first.sync.report.failed.includes("b.go") &&
      p.graph("file", "b.go").data.symbols.length === 0,
    first.failedFiles,
  );
  const b = one(p.links("a.go"), "B");
  claim(
    "general/link-into-failed-package-not-definite",
    b && b.certainty !== "definite",
    brief(b),
  );
  const second = p.graph("index");
  claim(
    "caching/go-failure-reused",
    second.sync.report.indexed === 0 &&
      second.sync.report.failed.includes("b.go"),
    second.sync.report,
  );
  const status = p.graph("status");
  claim("commands/status-never-indexes", status.sync.mode !== "index", status.sync);
}
{
  const p = project({ "b.ts": "export function x( {\n", "ok.ts": "export const y = 1;\n" });
  const first = p.graph("index");
  const second = p.graph("index");
  claim(
    "caching/typescript-content-failure-cached",
    first.sync.report.failed.includes("b.ts") &&
      second.sync.report.indexed === 0 &&
      second.sync.report.unchanged === 2 &&
      second.sync.report.failed.includes("b.ts"),
    { first: first.sync.report, second: second.sync.report },
  );
}

// ---------------------------------------------------------------- Go
{
  const p = project({
    "go.mod": "module ex/m\n\ngo 1.22\n",
    "sub/sub.go":
      "package sub\n\nfunc F() {}\nfunc private() {}\n\ntype S struct{}\n\nfunc (S) M() {}\n",
    "main.go": [
      "package main",
      "",
      'import "ex/m/sub"',
      'import "fmt"',
      'import "C"',
      "",
      "type T struct{ sub.S }",
      "type I interface{ M() }",
      "type U struct{}",
      "type E struct{ fmt.Stringer }",
      "",
      "func rs() []interface{ M() } { return nil }",
      "",
      "func (U) M() {}",
      "func A() {}",
      "func B() {}",
      "",
      "func main() {",
      "\tsub.F()",
      "\tvar s sub.S",
      "\ts.M()",
      "\tvar t T",
      "\tt.M()",
      "\tvar i I = U{}",
      "\ti.M()",
      "\tf := A",
      "\tf = B",
      "\tf()",
      "\tx := []int{1}",
      "\t_ = len(x)",
      "\tfmt.Println()",
      "\tsub.private()",
      "\tV()",
      "\ty := fmt.Sprint()",
      "\ty.M()",
      "\tvar e E",
      "\te.M()",
      "\tfor _, r := range rs() {",
      "\t\tr.M()",
      "\t}",
      "}",
      "",
    ].join("\n"),
    "v_linux.go": "//go:build linux\n\npackage main\n\nfunc V() {}\n",
    "v_windows.go": "//go:build windows\n\npackage main\n\nfunc V() {}\n",
    "semi/semi.go": "package semi\n\nfunc G() {}\n\nfunc H() {; G() }\n",
    "gen.go": "package main\n\ntype Box struct{}\n\nfunc (Box) Map[C any](x C) C { return x }\n\nfunc gen() { var b Box; _ = b.Map[int](1); v := 1; _ = new(v) }\n",
  });
  p.graph("index");
  const l = p.links("main.go");
  const show = (n) => brief(one(l, n));
  claim("go/package-qualified-call", one(l, "sub.F")?.certainty === "definite", show("sub.F"));
  claim("go/concrete-receiver", one(l, "s.M")?.certainty === "definite", show("s.M"));
  claim("go/promotion", one(l, "t.M")?.certainty === "definite" && one(l, "t.M")?.target === "(S).M", show("t.M"));
  claim("go/import-in-module", l.some((x) => x.kind === "imports" && x.name === "ex/m/sub" && x.certainty === "definite"), l.filter((x) => x.kind === "imports").map(brief));
  claim(
    "go/interface-dispatch-open-candidates",
    one(l, "i.M")?.certainty === "candidate-set" && JSON.stringify(one(l, "i.M").data).includes("structural-match-unverified"),
    show("i.M"),
  );
  claim("go/reassigned-func-local-candidates", one(l, "f")?.certainty === "candidate-set", show("f"));
  claim("go/build-variants-candidates", one(l, "V")?.certainty === "candidate-set", show("V"));
  claim("go/builtin-unresolved", one(l, "len")?.certainty === "unresolved" && one(l, "len").data?.builtinName === true, show("len"));
  claim("go/stdlib-unresolved", one(l, "fmt.Println")?.certainty === "unresolved", show("fmt.Println"));
  claim("go/unexported-other-package-unresolved", one(l, "sub.private")?.certainty === "unresolved", show("sub.private"));
  claim(
    "go/cgo-import-unresolved",
    l.some((x) => x.kind === "imports" && x.name === "C" && x.certainty === "unresolved"),
    l.filter((x) => x.kind === "imports").map((x) => [x.name, x.certainty]),
  );
  const impl = p.graph("file", "main.go").data.links.filter((x) => x.kind === "implements");
  claim(
    "go/implements-never-definite",
    impl.length > 0 && impl.every((x) => x.certainty === "unresolved" && x.data?.interfaceId),
    impl.map((x) => [x.certainty, x.data]),
  );
  const syms = p.symbols("main.go");
  claim("go/locals-not-symbols", !syms.some((s) => /:(s|t|i|f|x)$/.test(s)), syms);
  claim(
    "go/package-symbol",
    p.graph("search", "main").data.matches.some((m) => m.kind === "package"),
    p.graph("search", "main").data.matches.map((m) => `${m.kind}:${m.identity}:${m.file}`),
  );
  claim("go/grammar-empty-statement-fails", p.graph("status").failedFiles.some((f) => f.path === "semi/semi.go"), p.graph("status").failedFiles);
  claim("go/external-receiver-unresolved", one(l, "y.M")?.certainty === "unresolved", show("y.M"));
  claim(
    "go/no-evident-receiver-name-only-open",
    [one(l, "e.M"), one(l, "r.M")].some((x) => x?.certainty === "candidate-set" && JSON.stringify(x.data).includes("receiver-type-unknown")),
    { "e.M (embeds an external type)": show("e.M"), "r.M": show("r.M") },
  );
  const g = p.links("gen.go");
  claim("go/generic-method-instantiation-unresolved", one(g, "b.Map")?.certainty === "unresolved" || call(g, "b.Map[int]").some((x) => x.certainty === "unresolved"), g.filter((x) => x.kind === "calls").map((x) => [x.name, x.certainty, x.data]));
}

// ---------------------------------------------------------------- Rust
const cargo = (name) => `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n`;
{
  const p = project({
    "Cargo.toml": cargo("r"),
    "src/lib.rs": [
      "pub mod util;",
      "pub use util::helper as reexported;",
      "pub struct A;",
      "impl A {",
      "    pub fn new() -> A { A }",
      "    pub fn own(self) {}",
      "    pub fn r(&self) {}",
      "}",
      "pub trait Tr { fn t(&self); }",
      "impl Tr for A { fn t(&self) {} }",
      "#[my_attr]",
      "pub fn attributed() {}",
      "macro_rules! m { () => {} }",
      "pub fn calls(a: A, b: &A) {",
      "    A::new();",
      "    util::helper();",
      "    reexported();",
      "    a.own();",
      "    b.r();",
      "    let c: A = A;",
      "    c.r();",
      "    let d = A::new();",
      "    d.r();",
      "    attributed();",
      "    std::mem::drop(1);",
      "}",
      "pub fn withheld() {",
      "    m!();",
      "    util::helper();",
      "    crate::util::helper();",
      "}",
      "pub fn nested() {",
      "    let _x = m!();",
      "    util::helper();",
      "}",
      "pub fn standard() {",
      '    println!("x");',
      "    util::helper();",
      "}",
      "",
    ].join("\n"),
    "src/util.rs": "pub fn helper() {}\n",
  });
  p.graph("index");
  const l = p.links("src/lib.rs");
  const fn = (name) => p.graph("callees", name).data.links.map((x) => ({ name: x.targetName, certainty: x.certainty, data: x.data }));
  claim("rust/associated-call", one(l, "A::new")?.certainty === "definite", brief(one(l, "A::new")));
  claim("rust/path-call", call(l, "util::helper").some((x) => x.certainty === "definite"), call(l, "util::helper").map(brief));
  claim("rust/reexport", one(l, "reexported")?.certainty === "definite" && one(l, "reexported").target === "helper", brief(one(l, "reexported")));
  claim("rust/mod-declaration", l.some((x) => x.name === "util" && x.certainty === "definite"), l.filter((x) => x.name === "util").map(brief));
  claim("rust/impl-trait-link", l.some((x) => x.kind === "implements" && x.certainty === "definite"), l.filter((x) => x.kind === "implements").map(brief));
  claim("rust/dot-owned-self-definite", one(l, "a.own")?.certainty === "definite", brief(one(l, "a.own")));
  claim("rust/dot-ref-self-definite", one(l, "b.r")?.certainty === "definite", brief(one(l, "b.r")));
  claim("rust/annotated-let-ref-self-unresolved", one(l, "c.r")?.certainty === "unresolved", brief(one(l, "c.r")));
  claim("rust/unannotated-let-unresolved", one(l, "d.r")?.certainty === "unresolved", brief(one(l, "d.r")));
  claim(
    "rust/opaque-attribute-target",
    one(l, "attributed")?.certainty !== "definite" && JSON.stringify(one(l, "attributed")?.data).includes("item-under-opaque-attribute"),
    brief(one(l, "attributed")),
  );
  claim("rust/std-unresolved", one(l, "std::mem::drop")?.certainty === "unresolved", brief(one(l, "std::mem::drop")));
  const w = fn("withheld");
  claim(
    "rust/macro-statement-withholds",
    w.some((x) => x.name === "util::helper" && x.certainty === "unresolved" && JSON.stringify(x.data).includes("opaque-item-may-shadow-name")) &&
      w.some((x) => x.name === "crate::util::helper" && x.certainty === "definite"),
    w,
  );
  claim("rust/macro-in-expression-withholds-nothing", fn("nested").some((x) => x.name === "util::helper" && x.certainty === "definite"), fn("nested"));
  claim("rust/standard-macro-withholds-nothing", fn("standard").some((x) => x.name === "util::helper" && x.certainty === "definite"), fn("standard"));
}
{
  // Cross-crate #[macro_export] macros, by route.
  const p = project({
    "Cargo.toml": '[workspace]\nmembers = ["dep", "app"]\n',
    "dep/Cargo.toml": cargo("dep"),
    "dep/src/lib.rs": "#[macro_export]\nmacro_rules! hello { () => {} }\n",
    "app/Cargo.toml": cargo("app") + '\n[dependencies]\ndep = { path = "../dep" }\n',
    "app/src/lib.rs": [
      "use dep::hello;",
      "pub fn path_call() { dep::hello!(); }",
      "pub fn used_call() { hello!(); }",
      "",
    ].join("\n"),
    "app/src/legacy.rs": "",
  });
  p.graph("index");
  const l = p.links("app/src/lib.rs");
  const macros = l.filter((x) => x.name?.includes("hello"));
  claim("rust/cross-crate-macro-path", macros.some((x) => x.name === "dep::hello" && x.certainty === "definite"), macros.map((x) => [x.kind, x.name, x.certainty, x.target, x.data]));
  claim("rust/cross-crate-macro-use-import", macros.some((x) => x.kind === "macros" && x.name === "hello" && x.certainty === "definite"), macros.map((x) => [x.kind, x.name, x.certainty, x.target, x.data]));
  const q = project({
    "Cargo.toml": '[workspace]\nmembers = ["dep", "app"]\n',
    "dep/Cargo.toml": cargo("dep"),
    "dep/src/lib.rs": "#[macro_export]\nmacro_rules! hello { () => {} }\n",
    "app/Cargo.toml": cargo("app") + '\n[dependencies]\ndep = { path = "../dep" }\n',
    "app/src/lib.rs": "#[macro_use]\nextern crate dep;\npub fn legacy_call() { hello!(); }\n",
  });
  q.graph("index");
  const m = q.links("app/src/lib.rs").filter((x) => x.name?.includes("hello"));
  const ext = project({
    "Cargo.toml": cargo("e") + '\n[dependencies]\nserde_json = "1"\n',
    "src/lib.rs": "pub fn j() { let _v = serde_json::json!({}); }\n",
  });
  ext.graph("index");
  const e = ext.links("src/lib.rs").filter((x) => x.kind === "macros");
  claim("rust/external-crate-macro-unresolved", e.length > 0 && e.every((x) => x.certainty === "unresolved"), e.map((x) => [x.name, x.certainty, x.data]));
  claim("rust/cross-crate-macro-use-extern-crate", m.some((x) => x.certainty === "definite"), m.map((x) => [x.kind, x.name, x.certainty, x.target, x.data]));
}
{
  // Grammar: each construct in its own file; failed or read.
  const cases = {
    "raw_var.rs": "pub fn f() { let raw = 1; let _r = &raw; }\n",
    "raw_borrow.rs": "pub fn f() { let x = 1; let _p = &raw const x; }\n",
    "unsafe_extern.rs": 'unsafe extern "C" { pub safe fn abs(x: i32) -> i32; }\n',
    "cfg_pattern.rs": "struct P { a: u8 }\npub fn f(p: P) { let P { #[cfg(all())] a } = p; let _ = a; }\n",
    "two_param_attrs.rs": "pub fn f(#[allow(unused)] #[allow(dead_code)] x: u8) {}\n",
    "closure_param_attr.rs": "pub fn f() { let _c = |#[allow(unused)] x: u8| x; }\n",
    "primitive_turbofish.rs": "fn char<A, B>(_x: u8) {}\npub fn f() { char::<u8, u8>(1); }\n",
    "impl_for_lifetime.rs": "pub trait A {}\npub trait B<'a> {}\npub fn f(_x: impl A + for<'a> B<'a>) {}\n",
    "one_param_attr.rs": "pub fn f(#[allow(unused)] x: u8) {}\n",
  };
  const p = project({
    "Cargo.toml": cargo("g"),
    "src/lib.rs": Object.keys(cases).map((f) => `mod ${f.slice(0, -3)};`).join("\n") + "\n",
    ...Object.fromEntries(Object.entries(cases).map(([f, t]) => [`src/${f}`, t])),
  });
  const failed = new Set(p.graph("index").failedFiles.map((f) => f.path.slice(4)));
  claim(
    "rust/grammar",
    true,
    Object.fromEntries(Object.keys(cases).map((f) => [f, failed.has(f) ? "fails the file" : "read"])),
  );
}

// ---------------------------------------------------------------- TypeScript
{
  const p = project({
    "a.ts": "export function af() {}\nexport default function def() {}\nexport class Base {}\n",
    "barrel.ts": 'export * from "./a";\nexport { af as renamed } from "./a";\n',
    "use.ts": [
      'import { af, renamed } from "./barrel";',
      'import def, { Base } from "./a";',
      'import _ from "lodash";',
      "class Sub extends Base {}",
      "export function u() { af(); renamed(); def(); new Sub(); Math.max(1, 2); }",
      "",
    ].join("\n"),
    "c.cjs": 'const a = require("./d.cjs");\nconst name = "x";\nconst b = require(name);\na.g();\n',
    "d.cjs": "exports.g = function g() {};\n",
    "comp.tsx": "function Box() { return null; }\nexport const v = <Box />;\n",
    "early.js": "let let = 1;\n",
    "x.mts": "export const m = 1;\n",
    "y.cts": "export const c = 1;\n",
    "z.mjs": "export const j = 1;\n",
    "w.jsx": "export const k = 1;\n",
  });
  const r = p.graph("index");
  claim("typescript/extensions", r.sync.report.claimed === 11 && r.failedFiles.length === 0, { claimed: r.sync.report.claimed, failed: r.failedFiles });
  const l = p.links("use.ts");
  claim("typescript/barrel-export-star", one(l, "af")?.certainty === "definite" && one(l, "af").target === "af", brief(one(l, "af")));
  claim("typescript/barrel-rename", one(l, "renamed")?.certainty === "definite" && one(l, "renamed").target === "af", brief(one(l, "renamed")));
  claim("typescript/default-export", one(l, "def")?.certainty === "definite", brief(one(l, "def")));
  claim("typescript/heritage", l.some((x) => x.name === "Base" && x.kind !== "imports" && x.certainty === "definite"), l.filter((x) => x.name === "Base").map(brief));
  claim("typescript/new", l.some((x) => x.name === "Sub" && x.certainty === "definite" && x.kind !== "contains"), l.filter((x) => x.name === "Sub").map((x) => [x.kind, x.certainty]));
  claim("typescript/stdlib-external", one(l, "Math.max")?.certainty === "unresolved" && JSON.stringify(one(l, "Math.max").data).includes("external"), brief(one(l, "Math.max")));
  const imp = l.filter((x) => x.kind === "imports" && x.name === "lodash");
  claim("typescript/node-modules-external-package", imp.some((x) => x.certainty === "unresolved" && JSON.stringify(x.data).includes("external-package")), imp.map(brief));
  const c = p.links("c.cjs").filter((x) => x.kind === "imports");
  claim("typescript/require-literal-definite-computed-unresolved", c.some((x) => x.certainty === "definite") && c.some((x) => x.certainty === "unresolved"), c.map((x) => [x.name, x.certainty, x.data]));
  const jsx = p.links("comp.tsx").filter((x) => x.name === "Box" && x.kind !== "contains");
  claim("typescript/jsx-component", jsx.some((x) => x.certainty === "definite"), jsx.map((x) => [x.kind, x.certainty]));
  claim("typescript/js-early-error-clean", !r.failedFiles.some((f) => f.path === "early.js"), r.failedFiles);
}
{
  const p = project({
    "dup1.js": "function same() {}\n",
    "dup2.js": "function same() {}\n",
    "call.js": "same();\n",
  });
  p.graph("index");
  claim("typescript/duplicate-js-candidates", one(p.links("call.js"), "same")?.certainty === "candidate-set", brief(one(p.links("call.js"), "same")));
}
{
  const p = project({
    "tsconfig.json": '{ "extends": "@tsconfig/node20/tsconfig.json" }\n',
    "a.ts": "export function a() {}\n",
    "b.ts": 'import { a } from "./a";\nexport function b() { a(); }\n',
  });
  const r = p.graph("index");
  claim("typescript/partial-incomplete-config", r.sync.report.partial.length > 0, { partial: r.sync.report.partial, link: brief(one(p.links("b.ts"), "a")) });
}
{
  const p = project({
    "a.ts": "export function a() {}\n",
    "b.ts": 'import { a } from "./a";\nexport function b() { a(); }\n',
    "broken.ts": "export function x( {\n",
  });
  p.graph("index");
  const a = one(p.links("b.ts"), "a");
  claim("typescript/failed-file-assumes", JSON.stringify(a?.assumes ?? a?.data).includes("no-unseen-declarations"), { assumes: a?.assumes, data: a?.data, certainty: a?.certainty });
}

// ---------------------------------------------------------------- toolchain
{
  const settings = JSON.stringify({ version: 1, scenarios: {}, graph: { toolchain: { go: true } } });
  const noMod = project({ ".pymtheg/settings.json": settings, "a.go": "package a\n" });
  const t = noMod.graph("index").toolchain;
  claim("toolchain/no-go-mod-unavailable", t?.go.state === "unavailable" && /go\.mod/.test(t.go.reason), t);
  const work = project({
    ".pymtheg/settings.json": settings,
    "go.mod": "module ex/w\n\ngo 1.22\n",
    "go.work": "go 1.22\n\nuse .\n",
    "a.go": "package w\n",
  });
  const w = work.graph("index").toolchain;
  claim("toolchain/go-work-unavailable", w?.go.state === "unavailable" && /go\.work/.test(w.go.reason), w);
  const missing = project({
    ".pymtheg/settings.json": JSON.stringify({ version: 1, scenarios: {}, graph: { toolchain: { go: "/nonexistent/go" } } }),
    "go.mod": "module ex/x\n\ngo 1.22\n",
    "a.go": "package x\n",
  });
  const m = missing.graph("index").toolchain;
  claim("toolchain/missing-go-unavailable", m?.go.state === "unavailable", m);
  const off = project({ "go.mod": "module ex/o\n\ngo 1.22\n", "a.go": "package o\n" });
  claim("toolchain/off-by-default", off.graph("index").toolchain === undefined, "no toolchain field");
}
console.log(JSON.stringify({ failures }));
