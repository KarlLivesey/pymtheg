// SPDX-License-Identifier: MIT
// C-22: after every edit, an incremental re-index must leave the store
// identical, row for row, to a cold index of the edited tree (same project
// id, since ids hash it): files and results, symbols, links with targets and
// reasons, candidates, library targets, context files and failure markers.
import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { executeGraph } from "../dist/graph/commands.js";
import {
  discoverLanguages,
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";

const registry = await discoverLanguages();

/**
 * Runs `steps` (each: a name, an edit of the tree, and an optional check of
 * the incremental store) over `files`, comparing with a cold index after the
 * first index and after every step. Returns the step names compared.
 */
async function equalAfterEveryStep(
  files,
  steps,
  incrementalRegistry = registry,
) {
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
      await indexProject(root, incrementalRegistry, incremental);
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
      chmod: (path, mode) => chmodSync(join(root, path), mode),
      link: (from, to) => linkSync(join(root, from), join(root, to)),
    };
    // The first case of every sequence: a re-index with no edit at all.
    for (const step of [
      { name: "re-index with no edit", edit: () => {} },
      ...steps,
    ]) {
      const omitted = step.omit;
      const faulty = join(base, "omitted.sqlite");
      if (omitted) {
        const db = new DatabaseSync(join(base, "incremental.sqlite"), {
          readOnly: true,
        });
        try {
          await backup(db, faulty);
        } finally {
          db.close();
        }
      }
      step.edit(tree);
      await compare(step.name);
      step.check?.(incremental);
      if (omitted) {
        const store = new SqliteGraphStore(faulty);
        try {
          await indexProject(
            root,
            omitGoAnalysis(omitted),
            omitGoDecisions(store, omitted),
          );
          assert.notDeepEqual(
            compareRows(
              storeRows(faulty),
              storeRows(join(base, "incremental.sqlite")),
            ),
            [],
            `omitting ${omitted} after ${step.name} leaves stale rows`,
          );
        } finally {
          store.close();
        }
        rmSync(faulty);
      }
    }
  } finally {
    incremental.close();
    rmSync(base, { recursive: true, force: true });
  }
  return compared;
}

/** Test-only faulty reuse: leave one file's existing notes and decisions alone. */
function omitGoAnalysis(path) {
  const go = registry.modules.find((module) => module.id === "go");
  return new LanguageRegistry([
    {
      ...go,
      async analyze(context) {
        const result = await go.analyze(context);
        return "resolutionFiles" in result
          ? {
              ...result,
              files: result.files.filter((file) => file.path !== path),
            }
          : result.filter((file) => file.path !== path);
      },
    },
  ]);
}

function omitGoDecisions(store, path) {
  return new Proxy(store, {
    get(target, key) {
      if (key === "replaceAnalysis")
        return (module, result, validated) =>
          target.replaceAnalysis(
            module,
            result,
            module === "go" && validated
              ? {
                  current: validated.current.filter(
                    (link) => link.file !== path,
                  ),
                  desired: validated.desired.filter(
                    (link) => link.file !== path,
                  ),
                }
              : validated,
          );
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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

func Failure() error { return nil }
`;
const goB = `package b

import "example.com/m/a"

func Use() int {
	_ = a.Hello()
	_ = a.Extra()
	_ = a.Other()
	var t a.T
	return t.Size()
}

func Fail() error { return nil }
`;

test("Go: incremental re-index equals a cold index after every kind of edit", async () => {
  const steps = [
    {
      name: "comment-only edit",
      omit: "a/a.go",
      edit: (t) => t.write("a/a.go", "// Leading comment.\n" + goA),
    },
    {
      name: "body-only edit",
      omit: "a/a.go",
      edit: (t) =>
        t.write(
          "a/a.go",
          goA.replace('{ return "hello" }', '{ _ = 0; return "hello!" }'),
        ),
    },
    {
      name: "new export in a widely imported file",
      omit: "b/b.go",
      edit: (t) => t.write("a/a.go", goA + "\nfunc Extra() int { return 2 }\n"),
      check: (store) =>
        assert.equal(targetFile(store, "b/b.go", "a.Extra"), "a/a.go"),
    },
    {
      name: "rename that export",
      omit: "b/b.go",
      edit: (t) => t.write("a/a.go", goA + "\nfunc Other() int { return 2 }\n"),
      check: (store) =>
        assert.equal(targetFile(store, "b/b.go", "a.Extra"), null),
    },
    {
      name: "remove the renamed export",
      omit: "a/a.go",
      edit: (t) => t.write("a/a.go", goA),
    },
    {
      name: "add a file that declares a name another file uses",
      omit: "b/b.go",
      edit: (t) =>
        t.write(
          "a/extra.go",
          "package a\n\nfunc Extra() int { return 1 }\ntype error = int\n",
        ),
      check: (store) =>
        assert.equal(targetFile(store, "b/b.go", "a.Extra"), "a/extra.go"),
    },
    {
      name: "delete that file",
      omit: "a/a.go",
      edit: (t) => t.remove("a/extra.go"),
      check: (store) =>
        assert.equal(targetFile(store, "b/b.go", "a.Extra"), null),
    },
    {
      name: "rename a file",
      omit: "b/use.go",
      edit: (t) => t.rename("b/b.go", "b/use.go"),
    },
    {
      name: "a package-level declaration shadows a predeclared name",
      omit: "b/use.go",
      edit: (t) => t.write("b/shadow.go", "package b\n\ntype error = int\n"),
    },
    {
      name: "remove a declaration other files use",
      omit: "a/a.go",
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
      omit: "b/use.go",
      edit: (t) => t.write("a/a.go", goA + "\nfunc broken( {\n"),
    },
    {
      name: "repair it",
      omit: "b/use.go",
      edit: (t) => t.write("a/a.go", goA),
      check: (store) =>
        assert.equal(targetFile(store, "b/use.go", "t.Size"), "a/a.go"),
    },
    {
      name: "change go.mod so the import no longer names this module",
      omit: "b/use.go",
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
  assert.equal(compared.length, steps.length + 2);
});

test("Go: method sets, embedding, imports, test files and build variants agree with cold", async () => {
  const producer = `package producer
type First struct { Field int }
func (First) Run() {}
type Second struct{}
func (Second) Run() {}
type Wrap struct { First }
func Produce() First { return First{} }
`;
  const bridge = `package bridge
import "example.com/m/producer"
var Selected = producer.Produce()
`;
  const files = {
    "go.mod": "module example.com/m\n\ngo 1.22\n",
    "producer/producer.go": producer,
    "bridge/bridge.go": bridge,
    "user/user.go": `package user
import "example.com/m/bridge"
func Use() {
  bridge.Selected.Run()
}
`,
    "wrapper/wrapper.go": `package wrapper
import "example.com/m/producer"
func Use(w producer.Wrap) {
  w.Run()
  _ = w.Field
  _ = w.Renamed
  w.RenamedRun()
}
`,
    "contract/contract.go":
      "package contract\ntype Runner interface { Run() }\nfunc Use(x Runner) { x.Run() }\n",
    "consumer/consumer.go": "package consumer\nfunc Use() { _ = New() }\n",
    "producer/options_linux.go":
      "//go:build linux\n\npackage producer\nfunc Choose() int { return 1 }\n",
    "producer/options_windows.go":
      "//go:build windows\n\npackage producer\nfunc Choose() int { return 2 }\n",
    "producer/portable.go":
      "package producer\nfunc Portable() int { return Choose() }\n",
    "producer/portable_test.go":
      "package producer\nfunc ForTest() error { return nil }\n",
  };
  const target = (store, file, name) => {
    const link = store
      .links()
      .find((link) => link.file === file && link.targetName === name);
    return link?.targetId ? store.getSymbol(link.targetId)?.identity : null;
  };
  const implementsRunner = (store) =>
    store
      .links()
      .some(
        (link) =>
          link.kind === "implements" &&
          link.file === "producer/producer.go" &&
          link.targetName === "Runner",
      );
  await equalAfterEveryStep(files, [
    {
      name: "change A's return type, selecting a different method in C through B",
      omit: "user/user.go",
      edit: (t) =>
        t.write(
          "producer/producer.go",
          producer.replace(
            "Produce() First { return First{} }",
            "Produce() Second { return Second{} }",
          ),
        ),
      check: (store) =>
        assert.equal(
          target(store, "user/user.go", "bridge.Selected.Run"),
          "(Second).Run",
        ),
    },
    {
      name: "rename a method and a field",
      omit: "wrapper/wrapper.go",
      edit: (t) =>
        t.write(
          "producer/producer.go",
          producer
            .replace("Field int", "Renamed int")
            .replace("(First) Run()", "(First) RenamedRun()"),
        ),
      check: (store) => {
        assert.equal(target(store, "wrapper/wrapper.go", "w.Run"), null);
        assert.equal(target(store, "wrapper/wrapper.go", "w.Field"), null);
      },
    },
    {
      name: "restore the method and field, but change embedding",
      omit: "wrapper/wrapper.go",
      edit: (t) =>
        t.write(
          "producer/producer.go",
          producer.replace("Wrap struct { First }", "Wrap struct { Second }"),
        ),
      check: (store) => {
        assert.equal(
          target(store, "wrapper/wrapper.go", "w.Run"),
          "(Second).Run",
        );
        assert.equal(target(store, "wrapper/wrapper.go", "w.Field"), null);
      },
    },
    {
      name: "add an interface method, removing implementations in another package",
      omit: "producer/producer.go",
      edit: (t) =>
        t.write(
          "contract/contract.go",
          files["contract/contract.go"].replace(
            "{ Run() }",
            "{ Run(); Stop() }",
          ),
        ),
      check: (store) => assert.equal(implementsRunner(store), false),
    },
    {
      name: "rename the added interface method",
      omit: "contract/contract.go",
      edit: (t) =>
        t.write(
          "contract/contract.go",
          files["contract/contract.go"].replace(
            "{ Run() }",
            "{ Run(); Cancel() }",
          ),
        ),
    },
    {
      name: "remove the new interface requirement",
      omit: "producer/producer.go",
      edit: (t) =>
        t.write("contract/contract.go", files["contract/contract.go"]),
      check: (store) => assert.equal(implementsRunner(store), true),
    },
    {
      name: "add a blank import",
      omit: "consumer/consumer.go",
      edit: (t) =>
        t.write(
          "consumer/consumer.go",
          'package consumer\nimport _ "example.com/m/producer"\nfunc Use() { _ = New() }\n',
        ),
    },
    {
      name: "add a dot import",
      omit: "consumer/consumer.go",
      edit: (t) =>
        t.write(
          "consumer/consumer.go",
          'package consumer\nimport . "example.com/m/producer"\nfunc Use() { _ = Produce() }\n',
        ),
      check: (store) =>
        assert.equal(
          targetFile(store, "consumer/consumer.go", "Produce"),
          "producer/producer.go",
        ),
    },
    {
      name: "change a build constraint",
      omit: "producer/options_linux.go",
      edit: (t) =>
        t.write(
          "producer/options_linux.go",
          files["producer/options_linux.go"].replace(
            "//go:build linux",
            "//go:build ignore",
          ),
        ),
    },
    {
      name: "shadow a predeclared type in a test build",
      omit: "producer/portable_test.go",
      edit: (t) =>
        t.write(
          "producer/portable_test.go",
          files["producer/portable_test.go"] + "\ntype error = int\n",
        ),
      check: (store) =>
        assert.equal(
          targetFile(store, "producer/portable_test.go", "error"),
          "producer/portable_test.go",
        ),
    },
  ]);
});

test("Go: the cold comparison catches a closure narrowed to the edited file", async () => {
  const go = registry.modules.find((module) => module.id === "go");
  const narrowed = new LanguageRegistry([
    {
      ...go,
      async analyze(context) {
        const result = await go.analyze(context);
        if (!("resolutionFiles" in result) || !context.previousFiles?.size)
          return result;
        return {
          files: result.files.filter((file) =>
            context.previousFiles.has(file.path),
          ),
          resolutionFiles: [...context.previousFiles.keys()],
        };
      },
    },
  ]);
  await assert.rejects(
    equalAfterEveryStep(
      {
        "go.mod": "module example.com/m\n\ngo 1.22\n",
        "a/a.go": "package a\nfunc Existing() {}\n",
        "b/b.go":
          'package b\nimport "example.com/m/a"\nfunc Use() { a.Added() }\n',
      },
      [
        {
          name: "export omitted from importer",
          edit: (t) =>
            t.write(
              "a/a.go",
              "package a\nfunc Existing() {}\nfunc Added() {}\n",
            ),
        },
      ],
      narrowed,
    ),
    /after export omitted from importer/,
  );
});

test("Go: a direct graph write invalidates reuse even without a source edit", async () => {
  const root = mkdtempSync(join(tmpdir(), "c27-graph-write-"));
  try {
    writeFileSync(
      join(root, "a.go"),
      "package a\nfunc Target() {}\nfunc Use() { Target() }\n",
    );
    await executeGraph({ command: "index", root });
    const path = join(root, ".pymtheg/rebuildable/graph.sqlite");
    const cold = storeRows(path);
    const store = new SqliteGraphStore(path);
    try {
      store.resolveLinks([]);
    } finally {
      store.close();
    }
    assert.notDeepEqual(compareRows(storeRows(path), cold), []);
    const report = await executeGraph({ command: "index", root });
    assert.equal(report.sync.complete, true);
    assert.deepEqual(compareRows(storeRows(path), cold), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Go: standalone examples in the same directory select their own fields", async () => {
  const source = (name) =>
    `package main\ntype Options struct { Field string }\nfunc ${name}(opts Options) string { return opts.Field }\n`;
  const first = "examples/first.go";
  const second = "examples/second.go";
  await equalAfterEveryStep(
    { [first]: source("First"), [second]: source("Second") },
    [
      {
        name: "move one example's declarations",
        edit: (tree) =>
          tree.write(second, "// A standalone example.\n" + source("Second")),
        check: (store) => {
          assert.equal(targetFile(store, first, "opts.Field"), first);
          assert.equal(targetFile(store, second, "opts.Field"), second);
        },
      },
    ],
  );
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
  assert.equal(compared.length, steps.length + 2);
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
  assert.equal(compared.length, steps.length + 2);
});

test("TypeScript with installed declarations: a re-index equals a cold index, also after metadata-only changes", async () => {
  const declaration = "node_modules/kit/index.d.ts";
  const kit =
    "export declare class Page {\n  locate(): string;\n}\nexport declare function open(): Page;\n";
  const named = (store) =>
    store
      .links()
      .some(
        (link) =>
          link.file === "src/main.ts" &&
          link.resolution === "library" &&
          link.libraries?.some((item) => item.unit === "kit"),
      );
  const steps = [
    {
      name: "an installed declaration's mode changes, not its bytes",
      edit: (t) => t.chmod(declaration, 0o600),
      check: (store) => assert.ok(named(store), "kit stays a named library"),
    },
    {
      name: "a second hard link to an installed declaration (a shared store)",
      edit: (t) => t.link(declaration, "node_modules/kit/store-link.d.ts"),
      check: (store) => assert.ok(named(store), "kit stays a named library"),
    },
    {
      name: "an installed declaration gains a member",
      edit: (t) =>
        t.write(
          declaration,
          kit.replace(
            "locate(): string;",
            "locate(): string;\n  close(): void;",
          ),
        ),
    },
    {
      name: "a source file uses the new member",
      edit: (t) =>
        t.write(
          "src/main.ts",
          'import { open } from "kit";\n\nopen().locate();\nopen().close();\n',
        ),
    },
  ];
  const compared = await equalAfterEveryStep(
    {
      "package.json": JSON.stringify({
        name: "fixture",
        private: true,
        dependencies: { kit: "1.0.0" },
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "nodenext",
          moduleResolution: "nodenext",
        },
        include: ["src"],
      }),
      "node_modules/kit/package.json": JSON.stringify({
        name: "kit",
        version: "1.0.0",
        types: "index.d.ts",
      }),
      [declaration]: kit,
      "src/main.ts": 'import { open } from "kit";\n\nopen().locate();\n',
    },
    steps,
  );
  assert.equal(compared.length, steps.length + 2);
});
