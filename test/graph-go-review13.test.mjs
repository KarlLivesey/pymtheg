// Regressions for the thirteenth W2-B review: channel types read by the spec's
// rule (not tree-sitter's nesting); the spelling forms the type term trusts the
// tree for; a predeclared name shadowed by a same-package `_test.go` file;
// replace selection fallbacks.
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
/** Dispatch the old rules closed: open now only because membership is unverified. */
const SEALED = { reason: "structural-match-unverified" };

/**
 * Are `M(want)` and `M(have)` identical by type identity? Read from the
 * annotation on the (never definite) `implements` link: true identical, false
 * different, undefined unknown.
 */
async function implementsWith(want, have, extra = []) {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      ...extra,
      `type I interface{ M(${want}) }`,
      "type T struct{}",
      `func (T) M(${have}) {}`,
    ),
  });
  const link = links.find((item) => item.kind === "implements");
  assert.ok(link, "the type is never excluded by identity");
  assert.equal(link.target, null, "implements is never definite");
  return link.data.identity === "identical"
    ? true
    : link.data.identity === "different"
      ? false
      : undefined;
}

// The spec (Channel types): `ChannelType = ( "chan" | "chan" "<-" | "<-" "chan" )
// ElementType`, and "The <- operator associates with the leftmost chan possible":
//   chan<- chan int    is  chan<- (chan int)
//   chan<- <-chan int  is  chan<- (<-chan int)
//   <-chan <-chan int  is  <-chan (<-chan int)
//   chan (<-chan int)  needs the parentheses to be a channel of receive-only.
// So `D1 D2 int` written without parentheses is `D1 (D2 int)`, except that
// `chan <-chan int` reads its `<-` with the first `chan`: `chan<- (chan int)`.
const DIRECTIONS = ["chan", "chan<-", "<-chan"];
const spelledAs = (d1, d2) =>
  d1 === "chan" && d2 === "<-chan" ? "chan<- (chan int)" : `${d1} (${d2} int)`;

test("B1 channel-of-channel types follow the spec's leftmost-chan rule, for all nine pairs", async () => {
  for (const d1 of DIRECTIONS)
    for (const d2 of DIRECTIONS) {
      const plain = `${d1} ${d2} int`;
      // The unparenthesised spelling is exactly `spelledAs`.
      assert.equal(
        await implementsWith(spelledAs(d1, d2), plain),
        true,
        `${plain} is ${spelledAs(d1, d2)}`,
      );
      // And differs from the parenthesised reading whenever the rule regroups it.
      const parenthesised = `${d1} (${d2} int)`;
      assert.equal(
        await implementsWith(parenthesised, plain),
        spelledAs(d1, d2) === parenthesised,
        `${plain} vs ${parenthesised}`,
      );
    }
});

test("B1 the reviewer's cases, odd spacing, three deep, and in function types", async () => {
  // (a) chan<- chan int is chan<- (chan int), not chan (<-chan int).
  assert.equal(
    await implementsWith("chan<- chan int", "chan (<-chan int)"),
    false,
  );
  // (b) chan<- chan int is chan<- (chan int).
  assert.equal(
    await implementsWith("chan<- chan int", "chan<- (chan int)"),
    true,
  );
  // Spacing does not matter: `chan<-chan int`, `chan <- chan int`.
  assert.equal(
    await implementsWith("chan<-chan int", "chan<- (chan int)"),
    true,
  );
  assert.equal(
    await implementsWith("chan <- chan int", "chan<- (chan int)"),
    true,
  );
  assert.equal(
    await implementsWith("chan<- <-chan int", "chan<- (<-chan int)"),
    true,
  );
  assert.equal(
    await implementsWith("<-chan <-chan int", "<-chan (<-chan int)"),
    true,
  );
  // Three deep: <-chan chan<- chan int is <-chan (chan<- (chan int)).
  assert.equal(
    await implementsWith(
      "<-chan chan<- chan int",
      "<-chan (chan<- (chan int))",
    ),
    true,
  );
  assert.equal(
    await implementsWith(
      "<-chan chan<- chan int",
      "<-chan (chan (<-chan int))",
    ),
    false,
  );
  // As results and parameters of function types.
  assert.equal(
    await implementsWith("func() <-chan int", "func() (<-chan int)"),
    true,
  );
  assert.equal(
    await implementsWith(
      "func(<-chan int) chan<- int",
      "func(x <-chan int) (y chan<- int)",
    ),
    true,
  );
  assert.equal(
    await implementsWith(
      "func(<-chan int) chan<- int",
      "func(chan int) chan<- int",
    ),
    false,
  );
});

test("B1 the closed-set consequences of the reviewer's cases", async () => {
  const base = (have) => ({
    "go.mod": MOD,
    "internal/p/p.go": lines(
      "package p",
      "type i interface{ M(chan<- chan int); h() }",
      "type A struct{}",
      "func (A) M(chan<- chan int) {}",
      "func (A) h() {}",
      "func Use(x i) { x.M(nil) }",
      "type T struct{}",
      `func (T) M(${have}) {}`,
      "func (T) h() {}",
    ),
  });
  // (a) T's M is not i's M: annotated different, but identity never removes a
  // member (no-toolchain fallback), and the set is open.
  let { links } = await project(base("chan (<-chan int)"));
  let link = call(links, "internal/p/p.go", "x.M");
  assert.ok(link.candidates.includes("internal/p/p.go:method:(T).M"));
  assert.ok(link.data.open);
  // (b) T's M is i's M (and `var _ i = T{}` compiles): a member of the closed set.
  ({ links } = await project(base("chan<- (chan int)")));
  link = call(links, "internal/p/p.go", "x.M");
  assert.ok(link.candidates.includes("internal/p/p.go:method:(T).M"));
  assert.deepEqual(link.data.open, SEALED);
});

// The other places the type term follows the tree's shape. For each, the spec's
// precedence and the tree agree; these show it (equivalent spellings identical,
// different ones different).
test("type-term forms that follow the tree agree with the spec", async () => {
  const same = async (a, b, extra) =>
    assert.equal(await implementsWith(a, b, extra), true, `${a} = ${b}`);
  const different = async (a, b, extra) =>
    assert.equal(await implementsWith(a, b, extra), false, `${a} != ${b}`);
  // Prefix operators bind to what follows: *[]T is pointer to slice.
  await same("*[]int", "*([]int)");
  await different("*[]int", "[]*int");
  await same("*func()", "*(func())");
  // func() func() int: the result is func() int.
  await same("func() func() int", "func() (func() int)");
  await different("func() func() int", "func() (func(), int)");
  await same("func() (func())", "func() func()");
  // map[K]func() V: the value is func() V.
  await same("map[string]func() int", "map[string](func() int)");
  // A variadic of a complex element.
  await same("...func() int", "...(func() int)");
  await different("...func() int", "[]func() int");
  // [N]T (array) and T[N] (instantiation) are different types.
  await different("[2]int", "G[int]", ["type G[X any] struct{}"]);
  await same("[2]G[int]", "[2](G[int])", ["type G[X any] struct{}"]);
  // Embedded generic field: its name is the type's name.
  await different("struct{ G[int] }", "struct{ G G[int] }", [
    "type G[X any] struct{}",
  ]);
  await same("struct{ G[int] }", "struct{ G[int] }", [
    "type G[X any] struct{}",
  ]);
  // Labelled results.
  await same("func() (n int, err error)", "func() (int, error)");
  // An embedded pointer field is named by its base type.
  await different("struct{ *U }", "struct{ U *U }", ["type U struct{}"]);
});

test("interface elements with ~ or | are unknown, never identical or refuted", async () => {
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M(interface{ ~int | string }) }",
      "func Use(x I) { x.M(nil) }",
      "type T struct{}",
      "func (T) M(interface{ ~int | string }) {}",
    ),
  });
  assert.equal(
    links.find((link) => link.kind === "implements")?.data.identity,
    "unknown",
  );
  assert.ok(
    call(links, "p/p.go", "x.M").candidates.includes("p/p.go:method:(T).M"),
  );
});

const shadowed = (name, declaration, method, testPackage = "p") => ({
  "go.mod": MOD,
  "internal/p/i.go": lines(
    "package p",
    `type i interface{ M(${method}); h() }`,
    "type Z struct{}",
    `func (Z) M(${method}) {}`,
    "func (Z) h() {}",
    "func Use(x i) { x.M(nil) }",
    'func G() int { return len("x") + cap([]int{}) }',
  ),
  [`internal/p/${name}_test.go`]: lines(`package ${testPackage}`, declaration),
  "internal/p/t_test.go": lines(
    "package p",
    "type T struct{}",
    `func (T) M(${method}) {}`,
    "func (T) h() {}",
  ),
});

test("B2 a same-package _test.go declaration shadows the universe for the whole package", async () => {
  for (const [name, declaration, method] of [
    ["e", "type error interface{ Foo() }", "error"],
    ["n", "type int string", "int"],
  ]) {
    const { links } = await project(shadowed(name, declaration, method));
    const link = call(links, "internal/p/i.go", "x.M");
    // T is a real implementer in the test build; i.go's `error` there is p.error.
    assert.ok(
      link.candidates.includes("internal/p/t_test.go:method:(T).M"),
      `${declaration}: ${link.candidates.join()}`,
    );
    assert.ok(link.data.open, declaration);
  }
  // A builtin function and a constant declared in a _test.go file: the non-test
  // file's `len`/`cap` is the builtin in one build and the declaration in the
  // other, so no builtin flag.
  for (const declaration of [
    "func len(s string) int { return 0 }",
    "const cap = 3",
    "var (\n\tother = 1\n\tcap = 2\n)",
  ]) {
    const { links } = await project(shadowed("b", declaration, "error"));
    const target = declaration.includes("len") ? "len" : "cap";
    assert.equal(
      call(links, "internal/p/i.go", target).data.builtin,
      undefined,
      declaration,
    );
  }
});

test("B2 control: the external _test package shares no scope", async () => {
  const { links } = await project(
    shadowed(
      "e",
      "type error interface{ Foo() }\nconst len = 1",
      "error",
      "p_test",
    ),
  );
  const link = call(links, "internal/p/i.go", "x.M");
  assert.ok(link.candidates.includes("internal/p/t_test.go:method:(T).M"));
  assert.deepEqual(link.data.open, SEALED);
  assert.equal(call(links, "internal/p/i.go", "len").data.builtin, true);
});

const LIB = lines("package lib", "func F() {}");
const libProject = (files) => ({
  "fallback/go.mod": "module example.com/lib\n",
  "fallback/lib.go": LIB,
  "specific/go.mod": "module example.com/lib\n",
  "specific/lib.go": LIB,
  "p/p.go": lines(
    "package p",
    'import "example.com/lib"',
    "func Use() { lib.F() }",
  ),
  ...files,
});

test("a go.work whose replaces of a path do not apply falls back to the module's replace", async () => {
  const { links } = await project(
    libProject({
      "go.mod": lines(
        "module example.com/m",
        "go 1.22",
        "require example.com/lib v1.2.0",
        "replace example.com/lib => ./fallback",
      ),
      "go.work": lines(
        "go 1.22",
        "use .",
        "replace example.com/lib v1.9.0 => ./specific",
      ),
    }),
  );
  assert.equal(
    call(links, "p/p.go", "lib.F").target,
    "fallback/lib.go:function:F",
  );
});

test("before go 1.17 (or with no go directive) the selected version is not proven", async () => {
  for (const go of ["go 1.16", null]) {
    const { links } = await project(
      libProject({
        "go.mod": lines(
          "module example.com/m",
          ...(go ? [go] : []),
          "require example.com/lib v1.2.0",
          "replace example.com/lib v1.2.0 => ./specific",
          "replace example.com/lib => ./fallback",
        ),
      }),
    );
    const link = call(links, "p/p.go", "lib.F");
    assert.equal(link.target, null, String(go));
    assert.deepEqual(link.candidates, [
      "fallback/lib.go:function:F",
      "specific/lib.go:function:F",
    ]);
  }
});

test("B2 a defined type over a shadowed predeclared name is not basic", async () => {
  // In the test build `string` is a struct embedding R, so `X` (over string) has
  // the promoted Read and implements i. It cannot be ruled out.
  const { links } = await project({
    "go.mod": MOD,
    "internal/p/i.go": lines(
      "package p",
      "type i interface{ Read(); h() }",
      "type Z struct{}",
      "func (Z) Read() {}",
      "func (Z) h() {}",
      "func Use(x i) { x.Read() }",
      "type X string",
      "func (X) h() {}",
    ),
    "internal/p/s_test.go": lines(
      "package p",
      "type string struct{ R }",
      "type R struct{}",
      "func (R) Read() {}",
    ),
  });
  const link = call(links, "internal/p/i.go", "x.Read");
  assert.ok(link.data.open, link.candidates.join());
  assert.ok(link.candidates.includes("internal/p/s_test.go:method:(R).Read"));
});

// ---- Sol round 13 ----------------------------------------------------------

test("S1 an alias is its full target: pointers and instantiation arguments count", async () => {
  // The reviewer's cases: A = *T is not T; Box[int] is not Box[string].
  assert.equal(
    await implementsWith("A", "U", ["type U struct{}", "type A = *U"]),
    false,
  );
  assert.equal(
    await implementsWith("A", "B", [
      "type Box[K any] struct{}",
      "type A = Box[int]",
      "type B = Box[string]",
    ]),
    false,
  );
  // Positive controls: the alias really is its target.
  assert.equal(
    await implementsWith("A", "*U", ["type U struct{}", "type A = *U"]),
    true,
  );
  assert.equal(
    await implementsWith("A", "Box[int]", [
      "type Box[K any] struct{}",
      "type A = Box[int]",
    ]),
    true,
  );
  // Aliases of slices, maps, funcs, channels, structs, pointers to pointers,
  // and chains of aliases.
  const cases = [
    ["type A = []int", "[]int", "[]string"],
    ["type A = map[string]int", "map[string]int", "map[int]int"],
    ["type A = func(int) error", "func(x int) error", "func(int)"],
    ["type A = <-chan int", "<-chan int", "chan int"],
    ["type A = struct{ x int }", "struct{ x int }", "struct{ y int }"],
    ["type U struct{}\ntype A = **U", "**U", "*U"],
    ["type A = B\ntype B = []int", "[]int", "[]int8"],
  ];
  for (const [declaration, same, other] of cases) {
    assert.equal(
      await implementsWith("A", same, [declaration]),
      true,
      `${declaration}: ${same}`,
    );
    assert.equal(
      await implementsWith("A", other, [declaration]),
      false,
      `${declaration}: ${other}`,
    );
  }
});

test("S1 a method declared on an alias receiver belongs to the alias's target", async () => {
  // type A = T; func (A) M() declares T's M, so T implements i.
  const { links } = await project({
    "go.mod": MOD,
    "internal/p/p.go": lines(
      "package p",
      "type i interface{ M(); h() }",
      "type Z struct{}",
      "func (Z) M() {}",
      "func (Z) h() {}",
      "func Use(x i) { x.M() }",
      "type T struct{}",
      "type A = T",
      "func (A) M() {}",
      "func (T) h() {}",
    ),
  });
  assert.ok(
    links.some(
      (link) => link.kind === "implements" && link.at.startsWith("T "),
    ),
  );
  assert.ok(
    call(links, "internal/p/p.go", "x.M").candidates.includes(
      "internal/p/p.go:method:(A).M",
    ),
  );
});

test("S1 an embedded alias of a pointer is not reduced to its base type", async () => {
  // W embeds A = *T, so W's method set has (*T).M; with its own h, W implements i.
  const { links } = await project({
    "go.mod": MOD,
    "internal/p/p.go": lines(
      "package p",
      "type i interface{ M(); h() }",
      "type Z struct{}",
      "func (Z) M() {}",
      "func (Z) h() {}",
      "func Use(x i) { x.M() }",
      "type T struct{}",
      "func (*T) M() {}",
      "type A = *T",
      "type W struct{ A }",
      "func (W) h() {}",
    ),
  });
  const link = call(links, "internal/p/p.go", "x.M");
  assert.ok(
    link.candidates.includes("internal/p/p.go:method:(*T).M"),
    link.candidates.join(),
  );
});

const replaceProject = (gomod, extra = {}) => ({
  "go.mod": gomod,
  "fallback/go.mod": "module example.com/lib\n",
  "fallback/lib.go": lines("package lib", "func F() {}"),
  "p/p.go": lines(
    "package p",
    'import "example.com/lib"',
    "func Use() { lib.F() }",
  ),
  ...extra,
});
const importLink = (links) =>
  links.find((link) => link.kind === "imports" && link.file === "p/p.go");

test("S3 every replace takes part in precedence; an outside winner leaves the import unresolved", async () => {
  // Go: a version-specific replace of the selected version (v1.2.0) wins over an
  // unversioned one. Its destination is a module path: outside the project.
  let { links } = await project(
    replaceProject(
      lines(
        "module example.com/m",
        "go 1.22",
        "require example.com/lib v1.2.0",
        "replace example.com/lib => ./fallback",
        "replace example.com/lib v1.2.0 => example.net/real v1.2.0",
      ),
    ),
  );
  assert.equal(importLink(links).target, null);
  assert.equal(call(links, "p/p.go", "lib.F").target, null);
  // An unversioned module-path replace with a versioned directory replace of
  // the selected version: the directory wins.
  ({ links } = await project(
    replaceProject(
      lines(
        "module example.com/m",
        "go 1.22",
        "require example.com/lib v1.2.0",
        "replace example.com/lib => example.net/real v1.0.0",
        "replace example.com/lib v1.2.0 => ./fallback",
      ),
    ),
  ));
  assert.equal(
    call(links, "p/p.go", "lib.F").target,
    "fallback/lib.go:function:F",
  );
  // ...and with the versioned replace for another version, the unversioned
  // module-path replace applies: outside.
  ({ links } = await project(
    replaceProject(
      lines(
        "module example.com/m",
        "go 1.22",
        "require example.com/lib v1.2.0",
        "replace example.com/lib => example.net/real v1.0.0",
        "replace example.com/lib v1.3.0 => ./fallback",
      ),
    ),
  ));
  assert.equal(call(links, "p/p.go", "lib.F").target, null);
});

test("S4 an uncertain destination with one captured candidate is never definite", async () => {
  for (const second of [
    "replace example.com/lib v1.2.0 => ./missing",
    "replace example.com/lib v1.2.0 => example.net/real v1.2.0",
  ]) {
    // No requirement: the selected version is not proven, so either replace
    // may be the one Go uses; only one destination is captured.
    const { links } = await project(
      replaceProject(
        lines(
          "module example.com/m",
          "go 1.22",
          "replace example.com/lib => ./fallback",
          second,
        ),
      ),
    );
    assert.equal(importLink(links).target, null, second);
    assert.equal(call(links, "p/p.go", "lib.F").target, null, second);
  }
});

test("S5 cyclic and very deep types never fail the project", async () => {
  const cases = [
    "type int = int\ntype I interface{ M(int) }\ntype T struct{}\nfunc (T) M(int) {}",
    "type A = B\ntype B = A\ntype I interface{ M(A) }\ntype T struct{}\nfunc (T) M(B) {}",
    "type T struct{ T }",
    "type T struct{ *T }\nfunc (T) M() {}",
    "type I interface{ I }",
    "type I interface{ J }\ntype J interface{ I }",
    "type L []L\ntype F func() F\ntype I interface{ M(L, F) }\ntype T struct{}\nfunc (T) M(L, F) {}",
    "type A = []A\ntype I interface{ M(A) }\ntype T struct{}\nfunc (T) M(A) {}",
    "type T[K any] struct{ T[T[K]] }",
    `type I interface{ M(${"[]".repeat(5000)}int) }\nvar x ${"[]".repeat(5000)}int\nfunc F() { _ = ${"(".repeat(5000)}1${")".repeat(5000)} }`,
    `${Array.from({ length: 5000 }, (_, index) => `type A${index} = A${index + 1}`).join("\n")}\ntype A5000 = int\ntype I interface{ M(A0) }\ntype T struct{}\nfunc (T) M(int) {}`,
  ];
  for (const body of cases) {
    const label = body.slice(0, 50);
    // `project` fails on any analysis or resolution error.
    const { symbols, links } = await project({
      "go.mod": MOD,
      "p/bad.go": lines("package p", body),
      "p/good.go": lines("package p", "func Good() {}"),
    });
    assert.ok(
      symbols.some((symbol) => symbol.name === "Good"),
      label,
    );
    // Nothing definite on an alias cycle (and never a definite implements).
    assert.ok(
      links
        .filter((link) => link.kind === "implements")
        .every((link) => link.target === null),
      label,
    );
    if (body.includes("type A = B") || body.includes("type int = int"))
      assert.ok(
        links
          .filter((link) => link.kind === "implements")
          .every((link) => link.data.identity !== "identical"),
        label,
      );
  }
  // Mutual recursion across packages that import each other.
  const { symbols } = await project({
    "go.mod": MOD,
    "a/a.go": lines(
      "package a",
      'import "example.com/m/b"',
      "type A struct{ b.B }",
      "type X = b.Y",
    ),
    "b/b.go": lines(
      "package b",
      'import "example.com/m/a"',
      "type B struct{ *a.A }",
      "type Y = a.X",
    ),
    "c/c.go": lines("package c", "func Good() {}"),
  });
  assert.ok(symbols.some((symbol) => symbol.name === "Good"));
});

test("safety: D16 - no identity repro yields a definite link or a closed set; refuted repros keep (T).M", async () => {
  const repros = {
    "S1 grouped params": {
      "p/p.go": lines(
        "package p",
        "type I interface{ M(func(int)) }",
        "func Use(x I) { x.M(nil) }",
        "type T struct{}",
        "func (T) M(func(a, b int)) {}",
      ),
    },
    "S2 struct fields": {
      "p/p.go": lines(
        "package p",
        "type I interface{ M(struct{ x int }) }",
        "func Use(x I) { x.M(struct{ x int }{}) }",
      ),
      "q/q.go": lines(
        "package q",
        "type T struct{}",
        "func (T) M(struct{ x int }) {}",
      ),
    },
    "channels (a)": {
      "internal/p/p.go": lines(
        "package p",
        "type i interface{ M(chan<- chan int); h() }",
        "func Use(x i) { x.M(nil) }",
        "type T struct{}",
        "func (T) M(chan (<-chan int)) {}",
        "func (T) h() {}",
      ),
    },
    "channels (b)": {
      "internal/p/p.go": lines(
        "package p",
        "type i interface{ M(chan<- chan int); h() }",
        "type A struct{}",
        "func (A) M(chan<- chan int) {}",
        "func (A) h() {}",
        "func Use(x i) { x.M(nil) }",
        "type T struct{}",
        "func (T) M(chan<- (chan int)) {}",
        "func (T) h() {}",
        "var _ i = T{}",
      ),
    },
    "alias *T": {
      "p/p.go": lines(
        "package p",
        "type T struct{}",
        "type A = *T",
        "type I interface{ M(A) }",
        "type S struct{}",
        "func (S) M(T) {}",
        "func Use(x I) { x.M(nil) }",
      ),
    },
    "alias Box": {
      "p/p.go": lines(
        "package p",
        "type Box[K any] struct{}",
        "type A = Box[int]",
        "type B = Box[string]",
        "type I interface{ M(A) }",
        "type S struct{}",
        "func (S) M(B) {}",
        "func Use(x I) { x.M(A{}) }",
      ),
    },
    "error in _test.go": {
      "internal/p/i.go": lines(
        "package p",
        "type i interface{ M(error); h() }",
        "type Z struct{}",
        "func (Z) M(error) {}",
        "func (Z) h() {}",
        "func Use(x i) { x.M(nil) }",
      ),
      "internal/p/e_test.go": lines(
        "package p",
        "type error interface{ Foo() }",
      ),
      "internal/p/t_test.go": lines(
        "package p",
        "type T struct{}",
        "func (T) M(error) {}",
        "func (T) h() {}",
      ),
    },
  };
  for (const [label, files] of Object.entries(repros)) {
    const { links } = await project({ "go.mod": MOD, ...files });
    assert.ok(
      links
        .filter((link) => link.kind === "implements")
        .every((link) => link.target === null),
      `${label}: no definite implements`,
    );
    const sets = links.filter((link) => link.candidates.length);
    assert.ok(sets.length, label);
    assert.ok(
      sets.every((link) => link.data.open),
      `${label}: no closed set`,
    );
  }
  // The two repros where a real implementer used to be refuted: it is a member.
  let { links } = await project({ "go.mod": MOD, ...repros["channels (b)"] });
  assert.ok(
    call(links, "internal/p/p.go", "x.M").candidates.includes(
      "internal/p/p.go:method:(T).M",
    ),
  );
  ({ links } = await project({
    "go.mod": MOD,
    ...repros["error in _test.go"],
  }));
  assert.ok(
    call(links, "internal/p/i.go", "x.M").candidates.includes(
      "internal/p/t_test.go:method:(T).M",
    ),
  );
});

test("S1 an embedded alias of a pointer is not reduced: no claim that only *W implements", async () => {
  // W embeds A = *T, so W's value method set has (*T).M: a pointerReceiver: true
  // annotation on W -> i would be wrong.
  const { links } = await project({
    "go.mod": MOD,
    "internal/p/p.go": lines(
      "package p",
      "type i interface{ M(); h() }",
      "type T struct{}",
      "func (*T) M() {}",
      "type A = *T",
      "type W struct{ A }",
      "func (W) h() {}",
    ),
  });
  assert.ok(
    !links.some(
      (link) =>
        link.kind === "implements" &&
        link.at.startsWith("W ") &&
        link.data.pointerReceiver,
    ),
  );
});
