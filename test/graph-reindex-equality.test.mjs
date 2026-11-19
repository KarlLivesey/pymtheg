// SPDX-License-Identifier: MIT
// C-22: after every edit, an incremental re-index must leave the store
// identical, row for row, to a cold index of the edited tree (same project
// id, since ids hash it): files and results, symbols, links with targets and
// reasons, candidates, library targets, context files and failure markers.
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  discoverLanguages,
  indexProject,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";

const registry = await discoverLanguages();

/**
 * Runs `steps` (each: a name, an edit of the tree, and an optional check of
 * the incremental store) over `files`, comparing with a cold index after the
 * first index and after every step. Returns the step names compared.
 */
async function equalAfterEveryStep(files, steps) {
  const base = mkdtempSync(join(tmpdir(), "c22-equality-"));
  const root = join(base, "tree");
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  const incremental = new SqliteGraphStore(join(base, "incremental.sqlite"));
  const compared = [];
  try {
    const compare = async (name) => {
      await indexProject(root, registry, incremental);
      const cold = join(base, `cold-${compared.length}.sqlite`);
      const store = new SqliteGraphStore(cold, incremental.projectId);
      try {
        await indexProject(root, registry, store);
      } finally {
        store.close();
      }
      assert.deepEqual(
        compareRows(
          storeRows(join(base, "incremental.sqlite")),
          storeRows(cold),
        ),
        [],
        `after ${name}`,
      );
      compared.push(name);
    };
    await compare("first index");
    const tree = {
      write,
      remove: (path) => rmSync(join(root, path)),
      rename: (from, to) => renameSync(join(root, from), join(root, to)),
    };
    for (const step of steps) {
      step.edit(tree);
      await compare(step.name);
      step.check?.(incremental);
    }
  } finally {
    incremental.close();
    rmSync(base, { recursive: true, force: true });
  }
  return compared;
}

/** The file of the definite target of the link named `name` from `file`. */
function targetFile(store, file, name) {
  const links = store
    .links()
    .filter((link) => link.file === file && link.targetName === name);
  assert.ok(links.length > 0, `a link to ${name} from ${file}`);
  const targets = new Set(
    links.map((link) =>
      link.targetId === null ? null : store.getSymbol(link.targetId)?.file,
    ),
  );
  assert.equal(targets.size, 1, `one outcome for ${name} from ${file}`);
  return [...targets][0];
}

const goA = `package a

// Hello greets.
func Hello() string { return "hello" }

type T struct{ N int }

func (t T) Size() int { return t.N }
`;
const goB = `package b

import "example.com/m/a"

func Use() int {
	_ = a.Hello()
	_ = a.Extra()
	var t a.T
	return t.Size()
}

func Fail() error { return nil }
`;

test("Go: incremental re-index equals a cold index after every kind of edit", async () => {
  const steps = [
    {
      name: "comment-only edit",
      edit: (t) => t.write("a/a.go", goA + "\n// trailing comment\n"),
    },
    {
      name: "body-only edit",
      edit: (t) =>
        t.write(
          "a/a.go",
          goA.replace('{ return "hello" }', '{ _ = 0; return "hello!" }'),
        ),
    },
    {
      name: "new export in a widely imported file",
      edit: (t) => t.write("a/a.go", goA + "\nfunc Other() int { return 2 }\n"),
    },
    {
      name: "add a file that declares a name another file uses",
      edit: (t) =>
        t.write("a/extra.go", "package a\n\nfunc Extra() int { return 1 }\n"),
      check: (store) =>
        assert.equal(targetFile(store, "b/b.go", "a.Extra"), "a/extra.go"),
    },
    {
      name: "delete that file",
      edit: (t) => t.remove("a/extra.go"),
      check: (store) =>
        assert.equal(targetFile(store, "b/b.go", "a.Extra"), null),
    },
    {
      name: "rename a file",
      edit: (t) => t.rename("b/b.go", "b/use.go"),
    },
    {
      name: "a package-level declaration shadows a predeclared name",
      edit: (t) => t.write("b/shadow.go", "package b\n\ntype error = int\n"),
    },
    {
      name: "remove a declaration other files use",
      edit: (t) =>
        t.write(
          "a/a.go",
          goA.replace("func (t T) Size() int { return t.N }\n", ""),
        ),
      check: (store) =>
        assert.equal(targetFile(store, "b/use.go", "t.Size"), null),
    },
    {
      name: "a syntax error fails the edited file",
      edit: (t) => t.write("a/a.go", goA + "\nfunc broken( {\n"),
    },
    {
      name: "repair it",
      edit: (t) => t.write("a/a.go", goA),
      check: (store) =>
        assert.equal(targetFile(store, "b/use.go", "t.Size"), "a/a.go"),
    },
    {
      name: "change go.mod so the import no longer names this module",
      edit: (t) => t.write("go.mod", "module example.com/other\n\ngo 1.22\n"),
      check: (store) =>
        assert.equal(targetFile(store, "b/use.go", "a.Hello"), null),
    },
  ];
  const compared = await equalAfterEveryStep(
    {
      "go.mod": "module example.com/m\n\ngo 1.22\n",
      "a/a.go": goA,
      "b/b.go": goB,
    },
    steps,
  );
  assert.equal(compared.length, steps.length + 1);
});

const rustA = `pub fn hello() -> u32 {
    1
}

pub struct T;

impl T {
    pub fn size(&self) -> u32 {
        2
    }
}
`;
const rustB = `use crate::a::*;

pub fn use_it() -> u32 {
    let t = T;
    hello() + t.size() + extra()
}
`;

test("Rust: incremental re-index equals a cold index after every kind of edit", async () => {
  const steps = [
    {
      name: "comment-only edit",
      edit: (t) => t.write("src/a.rs", rustA + "\n// trailing comment\n"),
    },
    {
      name: "body-only edit",
      edit: (t) =>
        t.write(
          "src/a.rs",
          rustA.replace("    1\n", "    let _ = 0;\n    1\n"),
        ),
    },
    {
      name: "new export in a glob-imported module",
      edit: (t) =>
        t.write("src/a.rs", rustA + "\npub fn other() -> u32 {\n    3\n}\n"),
    },
    {
      name: "add a module that declares a name another file uses",
      edit: (t) => {
        t.write("src/a.rs", rustA + "\npub use crate::extra::extra;\n");
        t.write("src/extra.rs", "pub fn extra() -> u32 {\n    4\n}\n");
        t.write("src/lib.rs", "pub mod a;\npub mod b;\npub mod extra;\n");
      },
      check: (store) =>
        assert.equal(targetFile(store, "src/b.rs", "extra"), "src/extra.rs"),
    },
    {
      name: "a local declaration shadows the glob import",
      edit: (t) =>
        t.write("src/b.rs", rustB + "\nfn hello() -> u32 {\n    5\n}\n"),
      check: (store) =>
        assert.equal(targetFile(store, "src/b.rs", "hello"), "src/b.rs"),
    },
    {
      name: "delete the added module file",
      edit: (t) => t.remove("src/extra.rs"),
    },
    {
      name: "rename a module file",
      edit: (t) => {
        t.rename("src/b.rs", "src/user.rs");
        t.write("src/lib.rs", "pub mod a;\npub mod user;\npub mod extra;\n");
      },
    },
    {
      name: "remove a declaration other files use",
      edit: (t) =>
        t.write("src/a.rs", rustA.replace(/impl T \{[\s\S]*\}\n$/, "")),
    },
    {
      name: "a syntax error fails the edited file",
      edit: (t) => t.write("src/a.rs", rustA + "\npub fn broken( {\n"),
    },
    {
      name: "change Cargo.toml (crate name)",
      edit: (t) =>
        t.write(
          "Cargo.toml",
          '[package]\nname = "renamed"\nversion = "0.1.0"\nedition = "2021"\n',
        ),
    },
  ];
  const compared = await equalAfterEveryStep(
    {
      "Cargo.toml":
        '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n',
      "src/lib.rs": "pub mod a;\npub mod b;\n",
      "src/a.rs": rustA,
      "src/b.rs": rustB,
    },
    steps,
  );
  assert.equal(compared.length, steps.length + 1);
});

const tsA = `export function hello(): string {
  return "hello";
}

export * from "./c";
`;
const tsB = `import { hello, shared, extra } from "./a";
import { helper } from "@fixture/lib";

export function useIt(): string {
  return hello() + shared() + extra() + helper();
}
`;
const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "nodenext",
    moduleResolution: "nodenext",
  },
  include: ["src", "packages"],
});

test("TypeScript: incremental re-index equals a cold index after every kind of edit", async () => {
  const steps = [
    {
      name: "comment-only edit",
      edit: (t) => t.write("src/a.ts", tsA + "\n// trailing comment\n"),
    },
    {
      name: "body-only edit",
      edit: (t) =>
        t.write(
          "src/a.ts",
          tsA.replace('return "hello";', 'void 0;\n  return "hello!";'),
        ),
    },
    {
      name: "a new export shadows a re-exported name",
      edit: (t) =>
        t.write(
          "src/a.ts",
          tsA + "\nexport function shared(): string {\n  return 'a';\n}\n",
        ),
      check: (store) =>
        assert.equal(targetFile(store, "src/b.ts", "shared"), "src/a.ts"),
    },
    {
      name: "add a file that declares a name another file uses",
      edit: (t) => {
        t.write(
          "src/extra.ts",
          "export function extra(): string {\n  return 'x';\n}\n",
        );
        t.write("src/a.ts", tsA + 'export * from "./extra";\n');
      },
      check: (store) =>
        assert.equal(targetFile(store, "src/b.ts", "extra"), "src/extra.ts"),
    },
    {
      name: "delete that file",
      edit: (t) => t.remove("src/extra.ts"),
    },
    {
      name: "rename a file",
      edit: (t) => t.rename("src/b.ts", "src/user.ts"),
    },
    {
      name: "remove a declaration other files use",
      edit: (t) => t.write("src/c.ts", "export const unrelated = 1;\n"),
    },
    {
      name: "a syntax error fails the edited file",
      edit: (t) => t.write("src/a.ts", tsA + "\nexport function broken( {\n"),
    },
    {
      name: "change a workspace package.json (package name)",
      edit: (t) =>
        t.write(
          "packages/lib/package.json",
          JSON.stringify({
            name: "@fixture/other",
            version: "1.0.0",
            main: "index.ts",
          }),
        ),
    },
    {
      name: "change tsconfig.json (drop the source folder)",
      edit: (t) =>
        t.write(
          "tsconfig.json",
          JSON.stringify({
            compilerOptions: { strict: true },
            include: ["packages"],
          }),
        ),
    },
  ];
  const compared = await equalAfterEveryStep(
    {
      "package.json": JSON.stringify({
        name: "fixture",
        private: true,
        workspaces: ["packages/*"],
      }),
      "tsconfig.json": tsconfig,
      "packages/lib/package.json": JSON.stringify({
        name: "@fixture/lib",
        version: "1.0.0",
        main: "index.ts",
      }),
      "packages/lib/index.ts":
        "export function helper(): string {\n  return 'h';\n}\n",
      "src/a.ts": tsA,
      "src/b.ts": tsB,
      "src/c.ts": "export function shared(): string {\n  return 'c';\n}\n",
    },
    steps,
  );
  assert.equal(compared.length, steps.length + 1);
});
