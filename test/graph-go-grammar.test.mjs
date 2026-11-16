// SPDX-License-Identifier: MIT
// W2-S: Go shapes the vendored grammar (tree-sitter-go v0.25.0 + PRs #202,
// #198) reads, and the ones that still cannot be read. Every fixture is a real
// Go module checked by `go vet` (test below, when the toolchain is installed;
// output also in evidence/w2-s/fixtures-go-vet.txt).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { call, project } from "./fixtures/graph-go/harness.mjs";

const fixture = new URL("./fixtures/graph-go/grammar/", import.meta.url)
  .pathname;
const read = (subdirectory) => {
  const files = { "go.mod": readFileSync(join(fixture, "go.mod"), "utf8") };
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".go"))
        files[relative(fixture, path)] = readFileSync(path, "utf8");
    }
  };
  walk(join(fixture, subdirectory));
  return files;
};
const symbolsOf = (symbols, file) =>
  symbols
    .filter(
      (symbol) =>
        symbol.file === file && !["file", "package"].includes(symbol.kind),
    )
    .map((symbol) => `${symbol.kind}:${symbol.identity}`)
    .sort();
const go = spawnSync("go", ["version"], { encoding: "utf8" });

test(
  "the grammar fixtures are valid Go (go vet)",
  { skip: go.status !== 0 && "go toolchain not installed" },
  () => {
    const vet = spawnSync("go", ["vet", "./..."], {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...process.env,
        GOTOOLCHAIN: "local",
        GOFLAGS: "-mod=mod",
        GOWORK: "off",
      },
    });
    assert.equal(vet.status, 0, vet.stderr);
  },
);

test("Go 1.26 builtin new(expr): the file is read and the result points at the value's type", async () => {
  const { report, symbols, links } = await project(read("fixed/newexpr"));
  assert.deepEqual(report.failed, []);
  const file = "fixed/newexpr/newexpr.go";
  assert.deepEqual(
    symbolsOf(symbols, file),
    [
      "function:Conv",
      "function:Greet",
      "function:Typed",
      "function:Use",
      "method:(S).M",
      "type:S",
      "var:P",
    ].sort(),
  );
  // new(S(v)) and new(S) both give a pointer to S.
  assert.equal(call(links, file, "p.M").target, `${file}:method:(S).M`);
  assert.equal(call(links, file, "q.M").target, `${file}:method:(S).M`);
  // The builtin itself: flagged, no target.
  const builtins = links.filter(
    (link) => link.kind === "calls" && link.at === "new",
  );
  assert.equal(builtins.length, 6);
  for (const link of builtins) {
    assert.equal(link.target, null);
    assert.equal(link.data.builtin, true);
  }
});

test("user-declared new and make called with values resolve to the declarations", async () => {
  const { report, links } = await project({
    ...read("fixed/usernew"),
    ...read("fixed/usermake"),
  });
  assert.deepEqual(report.failed, []);
  const userNew = links.filter(
    (link) => link.kind === "calls" && link.at === "new",
  );
  assert.equal(userNew.length, 2);
  for (const link of userNew) {
    assert.equal(link.target, "fixed/usernew/usernew.go:function:new");
    assert.equal(link.data.builtin, undefined);
  }
  assert.equal(
    call(links, "fixed/usernew/usernew.go", "t.Close").target,
    "fixed/usernew/usernew.go:method:(*T).Close",
  );
  const makes = links.filter(
    (link) => link.kind === "calls" && link.at === "make",
  );
  assert.equal(makes.length, 2);
  // In source order: package-level make(1, 2) is the package's func; inside
  // Build, make is the parameter (a value, no target, not the builtin).
  assert.deepEqual(
    makes.map((link) => link.target),
    ["fixed/usermake/usermake.go:function:make", null],
  );
  const parameterCall = makes.find((link) => link.target === null);
  assert.equal(parameterCall.data.builtin, undefined);
});

test("restic's termstatus shape: status_test.go is read and its new(...) is restic's own", async () => {
  const { report, links } = await project(read("fixed/restic"));
  assert.deepEqual(report.failed, []);
  const file = "fixed/restic/status_test.go";
  assert.equal(
    call(links, file, "new").target,
    "fixed/restic/status.go:function:new",
  );
  assert.equal(
    call(links, file, "term.ReadPassword").target,
    "fixed/restic/status.go:method:(*terminal).ReadPassword",
  );
});

test("Go 1.27 generic methods: declared, called, and their type parameters scoped", async () => {
  const { report, symbols, links } = await project(read("fixed/genericmethod"));
  assert.deepEqual(report.failed, []);
  const file = "fixed/genericmethod/genericmethod.go";
  const map = symbols.find((symbol) => symbol.identity === "(T).Map");
  const get = symbols.find((symbol) => symbol.identity === "(*T).Get");
  assert.equal(map.data.generic, true);
  assert.equal(get.data.generic, true);
  // Inferred type arguments: a plain method call.
  assert.equal(call(links, file, "p.Get").target, `${file}:method:(*T).Get`);
  const maps = links.filter(
    (link) => link.kind === "calls" && link.at === "t.Map",
  );
  assert.equal(maps.length, 2);
  // `t.Map(C{})` resolves; `t.Map[C](C{})` is read by the grammar as a
  // conversion to a package-qualified generic type, so it stays unresolved
  // (a known limit, never a wrong target).
  assert.deepEqual(
    maps.map((link) => link.target),
    [`${file}:method:(T).Map`, null],
  );
  // The method's own `U` is its type parameter, not the package type U: no
  // reference to U and no definite call into (U).Close.
  const references = links.filter(
    (link) => link.kind === "references" && link.target === `${file}:struct:U`,
  );
  assert.deepEqual(references, []);
  assert.equal(call(links, file, "u.Close").target, null);
});

test(
  "Go's own check: a generic method does not satisfy an interface method",
  { skip: go.status !== 0 && "go toolchain not installed" },
  () => {
    const scratch = mkdtempSync(join(tmpdir(), "pymtheg-generic-iface-"));
    try {
      writeFileSync(
        join(scratch, "go.mod"),
        "module example.com/neg\n\ngo 1.27\n",
      );
      const source = readFileSync(
        join(fixture, "fixed/genericiface/genericiface.go"),
        "utf8",
      );
      writeFileSync(join(scratch, "a.go"), source);
      writeFileSync(
        join(scratch, "neg.go"),
        "package genericiface\n\nvar _ Mapper = Box{}\n",
      );
      const vet = spawnSync("go", ["vet", "."], {
        cwd: scratch,
        encoding: "utf8",
        env: {
          ...process.env,
          GOTOOLCHAIN: "local",
          GOFLAGS: "-mod=mod",
          GOWORK: "off",
        },
      });
      assert.notEqual(vet.status, 0);
      assert.match(
        vet.stderr,
        /Box does not implement Mapper \(wrong type for method Map\)/,
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
);

test("a generic method is not an implementer or a dispatch candidate; a generic type's plain method is", async () => {
  const { report, links } = await project(read("fixed/genericiface"));
  assert.deepEqual(report.failed, []);
  const file = "fixed/genericiface/genericiface.go";
  const implementers = links
    .filter(
      (link) => link.kind === "implements" && link.targetName === "Mapper",
    )
    .map((link) => link.at.split(/[\s[]/)[0])
    .sort();
  // `at` is the implementing type's spec; Box is not among them.
  assert.deepEqual(implementers, ["Gen", "Plain"]);
  const dispatch = call(links, file, "m.Map");
  assert.equal(dispatch.target, null);
  assert.deepEqual(
    dispatch.candidates,
    [
      `${file}:method:Mapper.Map`,
      `${file}:method:(Gen).Map`,
      `${file}:method:(Plain).Map`,
    ].sort(),
  );
  assert.ok(!dispatch.candidates.includes(`${file}:method:(Box).Map`));
});

test("remaining gaps still fail the file honestly", async () => {
  const { report, symbols, links } = await project(read("remaining"));
  // An empty statement (`;` after `{` or another `;`) followed by another
  // statement on the same line, and a non-BMP identifier on web-tree-sitter's 5,119-unit chunk boundary.
  assert.deepEqual(report.failed, [
    "remaining/chunkboundary/chunkboundary.go",
    "remaining/emptyblock/emptyblock.go",
    "remaining/emptybody/emptybody.go",
    "remaining/emptyfunclit/emptyfunclit.go",
  ]);
  for (const path of report.failed) {
    assert.deepEqual(
      symbols.filter((symbol) => symbol.file === path),
      [],
    );
    assert.deepEqual(
      links.filter((link) => link.file === path),
      [],
    );
  }
  // No final newline after the last `}` or `)`: the grammar reports only a
  // zero-width missing terminator at end of file, which the module (as on
  // main) does not treat as an error; Go accepts these files and the tree is
  // complete, so they are read.
  assert.deepEqual(
    symbolsOf(symbols, "remaining/nonewlinebrace/nonewlinebrace.go"),
    ["field:T.A", "struct:T"],
  );
  assert.deepEqual(
    symbolsOf(symbols, "remaining/nonewlineparen/nonewlineparen.go"),
    ["const:A"],
  );
});
