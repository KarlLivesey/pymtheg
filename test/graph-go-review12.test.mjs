// SPDX-License-Identifier: MIT
// Regressions for the twelfth W2-B review: a directory whose package membership
// cannot be proven makes its packages lossy (like a failed file); replace
// precedence. (Two clauses in one file now fail the file: see failed-files.)
import assert from "node:assert/strict";
import { test } from "node:test";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const MOD = "module example.com/m\n\ngo 1.22\n";
const lines = (...items) => [...items, ""].join("\n");
/** Dispatch the old rules closed: open now only because membership is unverified. */
const SEALED = { reason: "structural-match-unverified" };

/** Each check once (the recovery switch no longer exists). */
const both = (check) => check("-");

const CLEAN = lines(
  "package p",
  "type i interface{ M(); h() }",
  "type a struct{}",
  "func (a) M() {}",
  "func (a) h() {}",
  "type b struct{ a }",
  "func Direct(v b) { v.M() }",
  "func Dispatch(v i) { v.M() }",
);
/** Direct's and Dispatch's `v.M`, in source order. */
const calls = (links) =>
  links.filter((link) => link.file === "p/clean.go" && link.at === "v.M");

test("safety: a readable but conflicting package clause proves no membership", async () => {
  await both(async (on) => {
    for (const [label, files] of [
      ["package pp", { "p/broken.go": lines("package pp", "func (b) M() {}") }],
      [
        "untagged package main",
        { "p/broken.go": lines("package main", "func (b) M() {}") },
      ],
      [
        "p_test in a non-test file",
        { "p/broken.go": lines("package p_test", "func (b) M() {}") },
      ],
      [
        "two clauses, same name",
        { "p/broken.go": lines("package p", "package p", "func (b) M() {}") },
      ],
      [
        "two clauses",
        { "p/broken.go": lines("package p", "package q", "func (b) M() {}") },
      ],
      [
        "same constraint, different names",
        {
          "p/x_linux.go": lines("package p", "func X() {}"),
          "p/y_linux.go": lines("package q", "func (b) M() {}"),
        },
      ],
    ]) {
      const message = `${label}, recovery ${on}`;
      const { links } = await project({
        "go.mod": MOD,
        "p/clean.go": CLEAN,
        ...files,
      });
      const [direct, dispatch] = calls(links);
      // An unseen depth-0 M on b could shadow the promoted (a).M.
      assert.equal(direct.target, null, message);
      // Never a closed set missing (b).M: open, or no set at all.
      assert.equal(dispatch.target, null, message);
      if (dispatch.candidates.length) assert.ok(dispatch.data.open, message);
    }
  });
});

test("safety: a //go:build ignore generator beside a library changes nothing", async () => {
  await both(async (on) => {
    const { links } = await project({
      "go.mod": MOD,
      "p/clean.go": CLEAN,
      "p/gen.go": lines(
        "//go:build ignore",
        "",
        "package main",
        "func main() {}",
      ),
    });
    const [direct, dispatch] = calls(links);
    assert.equal(direct.target, "p/clean.go:method:(a).M", `${on}`);
    assert.deepEqual(dispatch.candidates, [
      "p/clean.go:method:(a).M",
      "p/clean.go:method:i.M",
    ]);
    assert.deepEqual(dispatch.data.open, SEALED);
  });
});

const LIB = lines("package lib", "func F() {}");
const libProject = (gomod, extra = {}) => ({
  "go.mod": gomod,
  "fallback/go.mod": "module example.com/lib\n",
  "fallback/lib.go": LIB,
  "specific/go.mod": "module example.com/lib\n",
  "specific/lib.go": LIB,
  "p/p.go": lines(
    "package p",
    'import "example.com/lib"',
    "func Use() { lib.F() }",
  ),
  ...extra,
});

test("S3: a version-specific replace of the selected version wins over an unversioned one, in either order", async () => {
  for (const replaces of [
    [
      "replace example.com/lib => ./fallback",
      "replace example.com/lib v1.2.0 => ./specific",
    ],
    [
      "replace example.com/lib v1.2.0 => ./specific",
      "replace example.com/lib => ./fallback",
    ],
  ]) {
    const { links } = await project(
      libProject(
        lines(
          "module example.com/m",
          "go 1.22",
          "require example.com/lib v1.2.0",
          ...replaces,
        ),
      ),
    );
    assert.equal(
      call(links, "p/p.go", "lib.F").target,
      "specific/lib.go:function:F",
      replaces.join("; "),
    );
  }
});

test("S3: a replace for another version does not apply; the unversioned one does", async () => {
  const { links } = await project(
    libProject(
      lines(
        "module example.com/m",
        "go 1.22",
        "require example.com/lib v1.2.0",
        "replace example.com/lib v1.3.0 => ./specific",
        "replace example.com/lib => ./fallback",
      ),
    ),
  );
  assert.equal(
    call(links, "p/p.go", "lib.F").target,
    "fallback/lib.go:function:F",
  );
});

test("S3: an unprovable selected version keeps both directories as candidates", async () => {
  const both = ["fallback/lib.go:function:F", "specific/lib.go:function:F"];
  // No requirement at all: Go uses neither replacement ("replaced but not
  // required"; evidence/c-8/go-import-rules.sh).
  let { links } = await project(
    libProject(
      lines(
        "module example.com/m",
        "go 1.22",
        "replace example.com/lib v1.2.0 => ./specific",
        "replace example.com/lib => ./fallback",
      ),
    ),
  );
  let link = call(links, "p/p.go", "lib.F");
  assert.equal(link.target, null);
  assert.deepEqual(link.candidates, []);
  // Another captured module requires a higher version: the main requirement may
  // be stale, so selection is not proven.
  ({ links } = await project(
    libProject(
      lines(
        "module example.com/m",
        "go 1.22",
        "require example.com/lib v1.2.0",
        "require example.com/other v0.0.0",
        "replace example.com/lib v1.2.0 => ./specific",
        "replace example.com/lib => ./fallback",
        "replace example.com/other => ./other",
      ),
      {
        "other/go.mod": lines(
          "module example.com/other",
          "require example.com/lib v1.3.0",
        ),
      },
    ),
  ));
  link = call(links, "p/p.go", "lib.F");
  assert.equal(link.target, null);
  assert.deepEqual(link.candidates, both);
});

test("S3: a go.work replace overrides the module's replaces", async () => {
  const { links } = await project({
    ...libProject(
      lines(
        "module example.com/m",
        "go 1.22",
        "require example.com/lib v1.2.0",
        "replace example.com/lib v1.2.0 => ./specific",
      ),
    ),
    "go.work": lines(
      "go 1.22",
      "use .",
      "replace example.com/lib => ./fallback",
    ),
  });
  assert.equal(
    call(links, "p/p.go", "lib.F").target,
    "fallback/lib.go:function:F",
  );
});
