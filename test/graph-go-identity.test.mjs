// Go type identity in signatures (spec, "Type identity"): one canonical form,
// applied at every depth. `implements` is definite only when identity is proven;
// a mismatch is only claimed when proven; anything unprovable stays a candidate.
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");

/**
 * Interface `I` with `M(want)` in p/i.go, type `T` with `M(have)` in `file`;
 * returns whether `T implements I` is definite and whether (T).M is a candidate
 * of the dispatch `x.M()` on I.
 */
async function check({
  want,
  have,
  iface = [],
  impl = [],
  file = "p/t.go",
  extra = {},
}) {
  const tPackage = file.split("/")[0];
  const { links } = await project({
    "go.mod": MOD,
    "p/i.go": lines(
      "package p",
      ...iface,
      `type I interface{ M(${want}) }`,
      "func Use(x I) { x.M() }",
    ),
    [file]: lines(
      `package ${tPackage}`,
      ...impl,
      "type T struct{}",
      `func (T) M(${have}) {}`,
    ),
    ...extra,
  });
  const definite = links.some(
    (link) =>
      link.kind === "implements" &&
      link.file === file &&
      link.targetName === "I",
  );
  const dispatch = links.find(
    (link) => link.file === "p/i.go" && link.at === "x.M",
  );
  return {
    definite,
    candidate: !!dispatch?.candidates.includes(`${file}:method:(T).M`),
  };
}
const yes = async (spec, message) => {
  const result = await check(spec);
  assert.equal(result.definite, true, message);
};
const no = async (spec, message) => {
  const result = await check(spec);
  assert.equal(result.definite, false, message);
  assert.equal(
    result.candidate,
    false,
    `${message}: refuted, so not a candidate`,
  );
};
const unknown = async (spec, message) => {
  const result = await check(spec);
  assert.equal(result.definite, false, message);
  assert.equal(
    result.candidate,
    true,
    `${message}: unprovable, so still a candidate`,
  );
};

test("S1 nested grouped parameters keep their arity", async () => {
  await no(
    { want: "func(int)", have: "func(a, b int)" },
    "func(int) vs func(a, b int)",
  );
  await yes({ want: "func(int, int)", have: "func(a, b int)" }, "equal arity");
  await yes(
    {
      want: "func(func(x, y int) (a, b string))",
      have: "func(func(int, int) (string, string))",
    },
    "two levels",
  );
  await no(
    { want: "func() (int, int)", have: "func() (a int)" },
    "results arity",
  );
});

test("S2 unexported struct fields belong to their package", async () => {
  await no(
    { want: "struct{ x int }", have: "struct{ x int }", file: "q/t.go" },
    "unexported field across packages",
  );
  await yes(
    { want: "struct{ x int }", have: "struct{ x int }" },
    "same package",
  );
  await yes(
    { want: "struct{ X int }", have: "struct{ X int }", file: "q/t.go" },
    "exported field across packages",
  );
  await no(
    { want: "interface{ m() }", have: "interface{ m() }", file: "q/t.go" },
    "unexported interface method across packages",
  );
});

test("variadic is not a slice; names are ignored; channel direction counts", async () => {
  await no({ want: "...int", have: "[]int" }, "variadic vs slice");
  await yes({ want: "...int", have: "xs ...int" }, "variadic, named");
  await yes(
    { want: "int) (err error", have: "n int) (error" },
    "parameter and result names",
  );
  await no({ want: "<-chan int", have: "chan int" }, "receive-only vs both");
  await no({ want: "chan<- int", have: "<-chan int" }, "send vs receive");
  await yes({ want: "chan<- int", have: "chan<- int" }, "same direction");
});

test("array lengths: literals by value; other constants unknown", async () => {
  await yes({ want: "[4]int", have: "[0x4]int" }, "4 and 0x4");
  await no({ want: "[4]int", have: "[5]int" }, "4 and 5");
  await unknown(
    { want: "[N]int", have: "[N]int", iface: ["const N = 4"] },
    "same constant name: not evaluated",
  );
});

test("structs: field names, order, embedding and tags", async () => {
  await no(
    { want: "struct{ a int; b string }", have: "struct{ b string; a int }" },
    "order",
  );
  await no({ want: "struct{ a int }", have: "struct{ b int }" }, "names");
  await yes(
    { want: "struct{ a, b int }", have: "struct{ a int; b int }" },
    "grouped fields",
  );
  await no(
    { want: "struct{ U }", have: "struct{ U U }", iface: ["type U struct{}"] },
    "embedded vs named",
  );
  await no(
    { want: 'struct{ a int `json:"a"` }', have: 'struct{ a int `json:"b"` }' },
    "tags",
  );
  await yes(
    {
      want: 'struct{ a int `json:"a"` }',
      have: 'struct{ a int "json:\\"a\\"" }',
    },
    "same tag, two spellings",
  );
});

test("interfaces: method order and embedding do not matter", async () => {
  await yes(
    { want: "interface{ A(); B() }", have: "interface{ B(); A() }" },
    "order",
  );
  await yes(
    {
      want: "interface{ A(); B() }",
      have: "interface{ X; B() }",
      iface: ["type X interface{ A() }"],
    },
    "embedded",
  );
  await no(
    { want: "interface{ A() }", have: "interface{ A(int) }" },
    "different method",
  );
});

test("aliases are their targets; any, byte and rune", async () => {
  await yes({ want: "...any", have: "...interface{}" }, "any");
  await yes({ want: "byte", have: "uint8" }, "byte");
  await yes({ want: "[]rune", have: "[]int32" }, "rune");
  await yes(
    { want: "A", have: "B", iface: ["type B struct{}", "type A = B"] },
    "type A = B",
  );
  await no({ want: "int", have: "int64" }, "different basic types");
});

test("named types by declaring package, never by spelling", async () => {
  const pkg = (name) =>
    lines(`package ${name}`, "type T struct{}", "type R struct{}");
  const extra = { "a/a.go": pkg("a"), "b/b.go": pkg("b") };
  // The same local name for two different packages.
  await no(
    {
      want: "x.T",
      have: "x.T",
      iface: ['import x "example.com/m/a"'],
      impl: ['import x "example.com/m/b"'],
      file: "q/t.go",
      extra,
    },
    "same spelling, different packages",
  );
  // One package under two names.
  await yes(
    {
      want: "x.T",
      have: "y.T",
      iface: ['import x "example.com/m/a"'],
      impl: ['import y "example.com/m/a"'],
      file: "q/t.go",
      extra,
    },
    "two names, one package",
  );
  // A dot import, and an alias of a dot-imported name.
  await yes(
    {
      want: "a.R",
      have: "R",
      iface: ['import "example.com/m/a"'],
      impl: ['import . "example.com/m/a"'],
      file: "q/t.go",
      extra,
    },
    "dot import",
  );
  await yes(
    {
      want: "a.R",
      have: "R2",
      iface: ['import "example.com/m/a"'],
      impl: ['import . "example.com/m/a"', "type R2 = R"],
      file: "q/t.go",
      extra,
    },
    "alias of a dot-imported name",
  );
  // A package-level `int` shadows the predeclared one.
  await no(
    { want: "int", have: "int", impl: ["type int struct{}"], file: "q/t.go" },
    "a shadowing int",
  );
});

test("generic instantiations compare their arguments; type parameters are not compared", async () => {
  const iface = ["type G[X any] struct{}"];
  await yes({ want: "G[int]", have: "G[int]", iface }, "same arguments");
  await no({ want: "G[int]", have: "G[string]", iface }, "different arguments");
  // A method of a generic type naming its type parameter: unknown, never refuted.
  const { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M(int) }",
      "func Use(x I) { x.M() }",
      "type S[P any] struct{}",
      "func (S[P]) M(P) {}",
    ),
  });
  assert.ok(!links.some((link) => link.kind === "implements"));
  assert.ok(
    call(links, "p/p.go", "x.M").candidates.includes("p/p.go:method:(S).M"),
  );
});

test("an external named type is never proven different from another external name", async () => {
  // os.FileMode is an alias of fs.FileMode: different spellings, maybe one type.
  await unknown(
    {
      want: "os.FileMode",
      have: "fs.FileMode",
      iface: ['import "os"'],
      impl: ['import "io/fs"'],
    },
    "external aliases",
  );
  await yes(
    {
      want: "os.FileMode",
      have: "os.FileMode",
      iface: ['import "os"'],
      impl: ['import "os"'],
    },
    "same external name",
  );
});
