// Regressions for the eleventh W2-B review: which packages a lossy file makes
// uncertain (a missing package clause; a lost import), and truthful reasons.
// Every case runs with recovery on and off.
import assert from "node:assert/strict";
import { test } from "node:test";
import go from "../dist/graph/languages/go/index.js";
import { recoveryOptions } from "../dist/graph/languages/go/recover.js";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
const EXTERNAL = "external-implementers-possible";
const UNSEEN = "declarations-may-be-unseen";

async function both(check) {
  for (const on of [true, false]) {
    recoveryOptions.enabled = on;
    try {
      await check(on);
    } finally {
      recoveryOptions.enabled = true;
    }
  }
}

const HEADS = [
  ["misspelled", "packge p"],
  ["misspelled", "pakage p"],
  ["empty", "package"],
  ["none", ""],
];

test("safety: 1 a file with a missing or broken package clause makes its directory's packages lossy", async () => {
  await both(async (on) => {
    for (const [label, head] of HEADS) {
      const message = `${label} ${JSON.stringify(head)}, recovery ${on}`;
      let { links } = await project({
        "go.mod": MOD,
        "p/clean.go": lines(
          "package p",
          "type i interface{ M(); h() }",
          "type a struct{}",
          "func (a) M() {}",
          "func (a) h() {}",
          "type b struct{ a }",
          "func Direct(v b) { v.M() }",
          "func Dispatch(v i) { v.M() }",
        ),
        "p/broken.go": lines(head, "func (b) M() {}"),
      });
      const lossy = (
        await go.parse({
          path: "p/broken.go",
          text: lines(head, "func (b) M() {}"),
        })
      ).data.go.lossy;
      assert.equal(lossy, true, message);
      // In source order: Direct's v.M, then Dispatch's v.M.
      const [direct, dispatch] = links.filter(
        (link) => link.file === "p/clean.go" && link.at === "v.M",
      );
      // An unseen depth-0 M on b could shadow the promoted (a).M.
      assert.equal(direct.target, null, message);
      assert.ok(dispatch.data.open, message);
      ({ links } = await project({
        "go.mod": MOD,
        "internal/p/clean.go": lines(
          "package p",
          "type i interface{ M(); h() }",
          "type a struct{}",
          "func (a) M() {}",
          "func (a) h() {}",
          "func Use(x i) { x.M() }",
          'func G() int { return len("x") }',
        ),
        "internal/p/broken.go": lines(
          head,
          "type b struct{}",
          "func (b) M() {}",
          "func (b) h() {}",
          "func len(s string) int { return 0 }",
        ),
      }));
      const use = call(links, "internal/p/clean.go", "x.M");
      assert.ok(use.data.open, message);
      assert.equal(
        call(links, "internal/p/clean.go", "len").data.builtin,
        undefined,
        message,
      );
    }
  });
  // Control: the same files with a proper clause.
  const { links } = await project({
    "go.mod": MOD,
    "internal/p/clean.go": lines(
      "package p",
      "type i interface{ M(); h() }",
      "type a struct{}",
      "func (a) M() {}",
      "func (a) h() {}",
      "func Use(x i) { x.M() }",
      'func G() int { return len("x") }',
    ),
  });
  assert.equal(call(links, "internal/p/clean.go", "x.M").data.open, undefined);
  assert.equal(call(links, "internal/p/clean.go", "len").data.builtin, true);
});

test("safety: 1 a _test.go file without a package clause makes the external test package lossy too", async () => {
  await both(async (on) => {
    const { links } = await project({
      "go.mod": MOD,
      "p/p.go": lines("package p", "func F() {}"),
      "p/x_test.go": lines(
        "package p_test",
        "type i interface{ M(); h() }",
        "type a struct{}",
        "func (a) M() {}",
        "func (a) h() {}",
        "func Use(x i) { x.M() }",
      ),
      "p/broken_test.go": lines("packge p_test", "type b struct{}"),
    });
    assert.ok(call(links, "p/x_test.go", "x.M").data.open, `${on}`);
  });
});

test("safety: 2 an import lost in a lossy file is seen without the scanner", async () => {
  await both(async (on) => {
    const { links } = await project({
      "go.mod": MOD,
      "internal/x/x.go": lines(
        "package x",
        "type I interface{ M(); h() }",
        "type Carrier struct{}",
        "func (Carrier) M() {}",
        "func (Carrier) h() {}",
        "func Use(v I) { v.M() }",
      ),
      "internal/y/y.go": lines(
        "package y",
        'import "example.com/m/internal/x"',
        "type Mid struct{ x.Carrier }",
      ),
      "internal/w/w.go": lines(
        "package w",
        "var z = 1",
        "var a = [",
        'import "example.com/m/internal/y"',
        "type W struct{ y.Mid }",
        "func (W) M() {}",
      ),
    });
    const link = call(links, "internal/x/x.go", "v.M");
    // Recovery never changes closedness: open in both modes.
    assert.ok(link.data.open, `recovery ${on}`);
    assert.ok(
      link.data.open.reasons?.includes(UNSEEN) ||
        link.data.open.reason === UNSEEN,
    );
    if (on) assert.ok(link.candidates.includes("internal/w/w.go:method:(W).M"));
  });
});

test("safety: 2 a lossy package reaches only what Go lets it import", async () => {
  await both(async (on) => {
    const { links } = await project({
      "go.mod": MOD,
      "a/internal/x/x.go": lines(
        "package x",
        "type i interface{ M(); h() }",
        "type c struct{}",
        "func (c) M() {}",
        "func (c) h() {}",
        "func Use(v i) { v.M() }",
      ),
      "b/w.go": lines("package w", "func B() {", "if true {"),
    });
    // b/ may not import a/internal/x: the set stays closed.
    assert.equal(
      call(links, "a/internal/x/x.go", "v.M").data.open,
      undefined,
      `${on}`,
    );
  });
});

test("3 a set open only because of a lossy package says so; both reasons when both apply", async () => {
  // Sealed interface, closed without the lossy file: only declarations-may-be-unseen.
  let { links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type i interface{ M(); h() }",
      "type a struct{}",
      "func (a) M() {}",
      "func (a) h() {}",
      "func Use(x i) { x.M() }",
    ),
    "p/broken.go": lines("package p", "func B() {", "if true {"),
  });
  assert.deepEqual(call(links, "p/p.go", "x.M").data.open, { reason: UNSEEN });
  // Exported interface with a member in the lossy package: both.
  ({ links } = await project({
    "go.mod": MOD,
    "p/p.go": lines(
      "package p",
      "type I interface{ M() }",
      "type a struct{}",
      "func (a) M() {}",
      "type b struct{}",
      "func (b) M() {}",
      "func Use(x I) { x.M() }",
    ),
    "p/broken.go": lines("package p", "func B() {", "if true {"),
  }));
  assert.deepEqual(call(links, "p/p.go", "x.M").data.open, {
    reason: EXTERNAL,
    reasons: [EXTERNAL, UNSEEN],
  });
  // An exported interface in a clean package with no lossy member: external only.
  ({ links } = await project({
    "go.mod": MOD,
    "q/q.go": lines(
      "package q",
      "type I interface{ M() }",
      "type a struct{}",
      "func (a) M() {}",
      "type b struct{}",
      "func (b) M() {}",
      "func Use(x I) { x.M() }",
    ),
    "p/broken.go": lines("package p", "func B() {", "if true {"),
  }));
  assert.deepEqual(call(links, "q/q.go", "x.M").data.open, {
    reason: EXTERNAL,
  });
});

test("safety: 4 an unknown structure reaches a hidden method only through a chain of imports", async () => {
  const files = (w) => ({
    "go.mod": MOD,
    "internal/x/x.go": lines(
      "package x",
      "type I interface{ M(); h() }",
      "type Carrier struct{}",
      "func (Carrier) M() {}",
      "func (Carrier) h() {}",
      "func Use(v I) { v.M() }",
    ),
    "internal/y/y.go": lines(
      "package y",
      'import "example.com/m/internal/x"',
      "type Mid struct{ x.Carrier }",
    ),
    "w/w.go": w,
  });
  // No lossy file. W's structure is unknown to the model (a defined pointer type);
  // w imports only y, which imports x: such a structure could carry x's hidden h
  // only through that chain.
  let { links } = await project(
    files(
      lines(
        "package w",
        'import "example.com/m/internal/y"',
        "var _ y.Mid",
        "type W *int",
      ),
    ),
  );
  assert.ok(call(links, "internal/x/x.go", "v.M").data.open);
  // Control: without the import, w cannot reach x: closed.
  ({ links } = await project(files(lines("package w", "type W *int"))));
  assert.equal(call(links, "internal/x/x.go", "v.M").data.open, undefined);
});
