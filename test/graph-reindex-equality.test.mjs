// SPDX-License-Identifier: MIT
// C-22: after every edit, an incremental re-index must leave the store
// identical, row for row, to a cold index of the edited tree (same project
// id, since ids hash it): files and results, symbols, links with targets and
// reasons, candidates, library targets, context files and failure markers.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { executeGraph } from "../dist/graph/commands.js";
import { graphWork, resetGraphWork } from "../dist/graph/work.js";
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
  // The work counters of the latest incremental index, for step checks.
  let work = {};
  try {
    const compare = async (name) => {
      resetGraphWork();
      await indexProject(root, incrementalRegistry, incremental);
      work = { ...graphWork.counts };
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
      step.check?.(incremental, work);
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

for (const mutation of ["replaceFile", "resolveLinks", "SQL delete"]) {
  test(`Go: the direct indexer repairs a clean graph after ${mutation}`, async () => {
    const base = mkdtempSync(join(tmpdir(), "c27-direct-repair-"));
    const root = join(base, "tree");
    mkdirSync(root);
    writeFileSync(
      join(root, "a.go"),
      "package a\nfunc F() {}\nfunc Use() { F() }\n",
    );
    const path = join(base, "graph.sqlite");
    let store = new SqliteGraphStore(path);
    try {
      await indexProject(root, registry, store);
      const cold = storeRows(path);
      if (mutation === "replaceFile") store.replaceFile(store.getFile("a.go"));
      else if (mutation === "resolveLinks") store.resolveLinks([]);
      else {
        const db = new DatabaseSync(path);
        try {
          db.prepare("DELETE FROM graph_links WHERE kind='calls'").run();
        } finally {
          db.close();
        }
      }
      assert.notDeepEqual(compareRows(storeRows(path), cold), []);
      if (mutation !== "replaceFile") {
        store.close();
        store = new SqliteGraphStore(path);
      }
      await indexProject(root, registry, store);
      assert.equal(targetFile(store, "a.go", "F"), "a.go");
      assert.deepEqual(compareRows(storeRows(path), cold), []);
    } finally {
      store.close();
      rmSync(base, { recursive: true, force: true });
    }
  });
}

test("Go: the command path re-resolves one file after a plain body edit", async () => {
  const root = mkdtempSync(join(tmpdir(), "c27-command-body-"));
  try {
    const edited = join(root, "a.go");
    writeFileSync(edited, "package a\nfunc F() int { return 1 }\n");
    writeFileSync(
      join(root, "use.go"),
      "package a\nfunc Use() int { return F() }\n",
    );
    await executeGraph({ command: "index", root });
    writeFileSync(edited, "package a\nfunc F() int { return 2 }\n");
    resetGraphWork();
    const result = await executeGraph({ command: "index", root });
    assert.equal(result.sync.complete, true);
    assert.equal(graphWork.counts["resolve.go.decisionFiles"], 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Go: verified re-indexes still compare bytes across saves, renames and checkouts", async () => {
  const base = mkdtempSync(join(tmpdir(), "c33-inventory-"));
  const root = join(base, "tree");
  mkdirSync(root);
  const a = join(root, "a.go");
  const b = join(root, "b.go");
  const one = "package p\nfunc One() int { return 1 }\n";
  const two = "package p\nfunc Two() int { return 2 }\n";
  const oldTime = new Date(1_700_000_000_000);
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Pymtheg Test",
        "-c",
        "user.email=fixture@example.com",
        "-c",
        "commit.gpgSign=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  const graph = join(root, ".pymtheg/rebuildable/graph.sqlite");
  let step = 0;
  const compare = async (indexed) => {
    resetGraphWork();
    const answer = await executeGraph({ command: "index", root });
    assert.equal(answer.sync.complete, true);
    assert.equal(answer.sync.report.indexed, indexed);
    if (indexed === 0) {
      assert.equal(graphWork.counts["inventory.filesHashed"], 2);
      assert.equal(graphWork.stages["store.beginRun"], undefined);
    }
    const warm = storeRows(graph);
    const path = join(base, `cold-${step++}.sqlite`);
    const cold = new SqliteGraphStore(path, warm.project[0]);
    try {
      await indexProject(root, registry, cold);
    } finally {
      cold.close();
    }
    assert.deepEqual(compareRows(warm, storeRows(path)), []);
  };
  try {
    git("init", "--quiet");
    writeFileSync(a, one);
    writeFileSync(b, two);
    git("add", "a.go", "b.go");
    git("commit", "-qm", "Initial declarations");
    const initial = git("rev-parse", "HEAD").trim();
    writeFileSync(a, two);
    writeFileSync(b, one);
    git("commit", "-qam", "Swap declarations");
    const swapped = git("rev-parse", "HEAD").trim();
    git("checkout", "--quiet", "--detach", initial);
    utimesSync(a, oldTime, oldTime);
    await compare(2);
    await compare(0);
    const stamp = statSync(a);
    writeFileSync(a, one.replace("return 1", "return 3"));
    utimesSync(a, oldTime, oldTime);
    assert.equal(statSync(a).size, stamp.size);
    assert.equal(statSync(a).mtimeMs, stamp.mtimeMs);
    await compare(1);
    utimesSync(a, oldTime, new Date(oldTime.getTime() + 1000));
    await compare(0);
    const replacement = join(base, "replacement.go");
    writeFileSync(replacement, one);
    renameSync(replacement, a);
    await compare(1);
    git("checkout", "--quiet", "--detach", swapped);
    await compare(2);
  } finally {
    rmSync(base, { recursive: true, force: true });
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

// C-36: a crate whose files read each other's surface.
const rustWorkspace = {
  "core/Cargo.toml":
    '[package]\nname = "shapes_core"\nversion = "0.1.0"\nedition = "2021"\n\n[features]\nx = []\n',
  "core/src/lib.rs": `#[macro_use]
mod macros;
pub mod names;
pub mod shapes;
pub mod util;

pub use shapes::Shape;

fn helper() -> u32 {
    7
}
`,
  "core/src/macros.rs": `macro_rules! double {
    ($e:expr) => {
        $e * 2
    };
}
`,
  "core/src/names.rs": `pub fn unrelated() -> u32 {
    0
}
`,
  "core/src/shapes.rs": `#[derive(Debug, Clone)]
pub enum Shape {
    Circle(u32),
    Square(u32),
}

pub struct Point {
    pub x: u32,
    pub y: u32,
    pub shape: Shape,
}

pub trait Area {
    fn area(&self) -> u32;
}

impl Area for Shape {
    fn area(&self) -> u32 {
        match self {
            Shape::Circle(r) => r * 3,
            Shape::Square(s) => s * s,
        }
    }
}

impl Point {
    pub fn sum(&self) -> u32 {
        self.x + self.y
    }
}

pub fn make() -> Point {
    Point { x: 1, y: 2, shape: Shape::Square(1) }
}
`,
  "core/src/util/mod.rs": `mod child;

use crate::shapes::{Area, Shape};

pub fn total(s: &Shape) -> u32 {
    s.area() + crate::shapes::make().sum() + double!(1) + crate::helper()
}

pub fn via_field(p: &crate::shapes::Point) -> u32 {
    p.shape.area()
}

pub fn classify(s: &Shape) -> u32 {
    match s {
        Shape::Circle(_) => 1,
        Shape::Square(_) => 2,
    }
}
`,
  "core/src/util/child.rs": `use super::*;

pub fn child(s: &Shape) -> u32 {
    drop(1);
    total(s)
}

pub fn via_root(s: &crate::Shape) -> u32 {
    crate::shapes::extra_fn() + total(s)
}
`,
};
const rewrite = (path, from, to) => (t) => {
  const text = rustWorkspace[path];
  assert.ok(text.includes(from), `${path} contains ${from}`);
  t.write(path, text.replace(from, to));
};
// Edits whose effect reaches another file. Each must equal a cold index, and
// each must leave stale rows when only the edited file is re-decided.
const rustCrossFileEdits = [
  {
    name: "add a pub fn another file calls",
    edit: rewrite(
      "core/src/shapes.rs",
      "pub fn make()",
      "pub fn extra_fn() -> u32 {\n    3\n}\n\npub fn make()",
    ),
  },
  {
    name: "remove a pub fn",
    edit: rewrite(
      "core/src/shapes.rs",
      "pub fn make() -> Point {\n    Point { x: 1, y: 2, shape: Shape::Square(1) }\n}\n",
      "",
    ),
  },
  {
    name: "rename a pub fn",
    edit: rewrite("core/src/shapes.rs", "pub fn make()", "pub fn build()"),
  },
  {
    name: "rename a private fn a sibling module uses",
    edit: rewrite("core/src/lib.rs", "fn helper()", "fn assist()"),
  },
  {
    name: "rename a method in an impl",
    edit: rewrite(
      "core/src/shapes.rs",
      "pub fn sum(&self)",
      "pub fn add(&self)",
    ),
  },
  {
    name: "rename a trait method with implementors elsewhere",
    edit: (t) =>
      t.write(
        "core/src/shapes.rs",
        rustWorkspace["core/src/shapes.rs"].replaceAll(
          "fn area(&self)",
          "fn surface(&self)",
        ),
      ),
  },
  {
    name: "rename an enum variant another file matches",
    edit: rewrite("core/src/shapes.rs", "    Circle(u32),", "    Round(u32),"),
  },
  {
    name: "rename a struct field",
    edit: rewrite(
      "core/src/shapes.rs",
      "    pub shape: Shape,",
      "    pub form: Shape,",
    ),
  },
  {
    name: "change a return type used in a method chain",
    edit: rewrite(
      "core/src/shapes.rs",
      "pub fn make() -> Point {\n    Point { x: 1, y: 2, shape: Shape::Square(1) }\n}",
      "pub fn make() -> Shape {\n    Shape::Square(2)\n}",
    ),
  },
  {
    name: "remove a use a child module imports",
    edit: rewrite(
      "core/src/util/mod.rs",
      "use crate::shapes::{Area, Shape};",
      "use crate::shapes::Area;",
    ),
  },
  {
    name: "remove a pub use re-export",
    edit: rewrite("core/src/lib.rs", "pub use shapes::Shape;\n", ""),
  },
  {
    name: "add a glob import that shadows a prelude name",
    edit: (t) => {
      t.write(
        "core/src/names.rs",
        rustWorkspace["core/src/names.rs"] + "\npub fn drop(_: u32) {}\n",
      );
      rewrite(
        "core/src/util/mod.rs",
        "mod child;\n",
        "mod child;\n\npub use crate::names::*;\n",
      )(t);
    },
  },
  {
    name: "move a macro_rules! module after the module that uses it",
    edit: rewrite(
      "core/src/lib.rs",
      "#[macro_use]\nmod macros;\npub mod names;\npub mod shapes;\npub mod util;\n",
      "pub mod names;\npub mod shapes;\npub mod util;\n#[macro_use]\nmod macros;\n",
    ),
  },
  {
    name: "change a macro_rules! body",
    edit: rewrite(
      "core/src/macros.rs",
      "$e * 2",
      "$e * $crate::shapes::make().sum()",
    ),
  },
  {
    name: "add an attribute macro to a declaration",
    edit: rewrite(
      "core/src/shapes.rs",
      "pub struct Point {",
      "#[shapes_magic::wrap]\npub struct Point {",
    ),
  },
  {
    name: "add a cfg to a declaration",
    edit: rewrite(
      "core/src/shapes.rs",
      "pub fn make()",
      '#[cfg(feature = "x")]\npub fn make()',
    ),
  },
  {
    name: "remove a mod line",
    edit: rewrite("core/src/lib.rs", "pub mod util;\n", ""),
  },
  {
    name: "make a file unparseable",
    edit: (t) =>
      t.write(
        "core/src/shapes.rs",
        rustWorkspace["core/src/shapes.rs"] + "\npub fn broken( {\n",
      ),
  },
];

/** Test-only faulty scope: re-decide only the edited files, whatever they changed. */
const rustNarrowed = (() => {
  const rust = registry.modules.find((module) => module.id === "rust");
  return new LanguageRegistry([
    {
      ...rust,
      async analyze(context) {
        if (!context.previousFiles?.size) return rust.analyze(context);
        const { previousFiles: _previous, ...full } = context;
        const files = await rust.analyze(full);
        return {
          files: files.filter((file) => context.previousFiles.has(file.path)),
          resolutionFiles: [...context.previousFiles.keys()],
        };
      },
    },
  ]);
})();

test("Rust: comment and body edits re-decide only the edited file", async () => {
  const scoped = (isomorphic) => (store, work) => {
    const path = Object.keys(work).filter((key) =>
      key.startsWith("analyze.rust."),
    );
    assert.equal(work["analyze.rust.scopedFiles"], 1, path.join());
    assert.equal(work["resolve.rust.decisionFiles"], 1);
    assert.equal(work["analyze.rust.isomorphicScopes"], isomorphic);
  };
  const compared = await equalAfterEveryStep(rustWorkspace, [
    {
      name: "comment-only edit",
      edit: (t) =>
        t.write(
          "core/src/shapes.rs",
          "// leading comment\n" + rustWorkspace["core/src/shapes.rs"],
        ),
      check: scoped(1),
    },
    {
      name: "body-only edit",
      edit: rewrite(
        "core/src/shapes.rs",
        "    Point { x: 1, y: 2, shape: Shape::Square(1) }",
        "    let _ = 0;\n    Point { x: 1, y: 2, shape: Shape::Square(1) }",
      ),
      check: scoped(1),
    },
    {
      // New calls move no surface link here (the file has no attribute or
      // later item links), but its old lookups differ from its new ones and
      // are checked separately.
      name: "body edit that adds calls",
      edit: rewrite(
        "core/src/names.rs",
        "    0\n",
        "    let _ = crate::shapes::make().sum();\n    0\n",
      ),
      check: scoped(undefined),
    },
    {
      name: "a new export changes the surface",
      edit: rewrite(
        "core/src/shapes.rs",
        "pub fn make()",
        "pub fn extra_fn() -> u32 {\n    3\n}\n\npub fn make()",
      ),
      check: (store, work) => {
        assert.equal(work["analyze.rust.fullPass.surface"], 1);
        assert.equal(work["analyze.rust.scopedFiles"], undefined);
      },
    },
    {
      name: "a new file",
      edit: (t) => t.write("core/src/orphan.rs", "pub fn orphan() {}\n"),
      check: (store, work) =>
        assert.equal(work["analyze.rust.scopedFiles"], undefined),
    },
    {
      name: "delete a file",
      edit: (t) => t.remove("core/src/util/child.rs"),
    },
    {
      name: "change a manifest",
      edit: (t) =>
        t.write(
          "core/Cargo.toml",
          rustWorkspace["core/Cargo.toml"].replace('"0.1.0"', '"0.2.0"'),
        ),
      check: (store, work) =>
        assert.equal(work["analyze.rust.scopedFiles"], undefined),
    },
  ]);
  assert.equal(compared.length, 9);
});

for (const shape of rustCrossFileEdits)
  test(`Rust: ${shape.name} equals cold, and not when only the edited file is re-decided`, async () => {
    await equalAfterEveryStep(rustWorkspace, [
      shape,
      {
        name: "revert",
        edit: (t) => {
          for (const [path, text] of Object.entries(rustWorkspace))
            t.write(path, text);
        },
      },
    ]);
    await assert.rejects(
      equalAfterEveryStep(rustWorkspace, [shape], rustNarrowed),
      new RegExp(`after ${shape.name.replace(/[!]/g, "\\$&")}`),
    );
  });

test("Rust: an edit in one workspace crate re-decides its dependent crate", async () => {
  const crates = {
    "Cargo.toml": '[workspace]\nmembers = ["app", "dep"]\n',
    "app/Cargo.toml":
      '[package]\nedition = "2024"\nname = "app"\n[dependencies]\ndep = { path = "../dep" }\n',
    "dep/Cargo.toml": '[package]\nedition = "2024"\nname = "dep"\n',
    "dep/src/lib.rs": "pub fn f() {}\n",
    "app/src/lib.rs": "fn run() {\n    dep::f();\n}\n",
  };
  const rename = {
    name: "rename the function the dependent crate calls",
    edit: (t) => t.write("dep/src/lib.rs", "pub fn g() {}\n"),
    check: (store) =>
      assert.equal(targetFile(store, "app/src/lib.rs", "dep::f"), null),
  };
  await equalAfterEveryStep(crates, [
    {
      name: "the call resolves across crates",
      edit: () => {},
      check: (store) =>
        assert.equal(
          targetFile(store, "app/src/lib.rs", "dep::f"),
          "dep/src/lib.rs",
        ),
    },
    rename,
  ]);
  await assert.rejects(
    equalAfterEveryStep(crates, [rename], rustNarrowed),
    /after rename the function the dependent crate calls/,
  );
});

test("Rust: an unparseable file is repaired by the next index", async () => {
  await equalAfterEveryStep(rustWorkspace, [
    rustCrossFileEdits.find(
      (shape) => shape.name === "make a file unparseable",
    ),
    {
      name: "repair it",
      edit: (t) =>
        t.write("core/src/shapes.rs", rustWorkspace["core/src/shapes.rs"]),
    },
  ]);
});

test("Rust: a body edit inside a glob cycle uses the full pass", async () => {
  const runner = `use super::*;

pub fn run(server: &AppServer) -> u32 {
    server.port()
}
`;
  await equalAfterEveryStep(
    {
      "Cargo.toml":
        '[package]\nname = "cycle"\nversion = "0.1.0"\nedition = "2021"\n',
      "src/lib.rs": "mod serve;\npub use serve::*;\n",
      "src/serve/mod.rs":
        "mod runner;\nmod server;\npub use runner::*;\npub use server::*;\n",
      "src/serve/server.rs": `use super::*;

pub struct AppServer;

impl AppServer {
    pub fn port(&self) -> u32 {
        run_count()
    }
}

pub fn run_count() -> u32 {
    1
}
`,
      "src/serve/runner.rs": runner,
    },
    [
      {
        name: "body edit in a module that globs its parent",
        edit: (t) =>
          t.write(
            "src/serve/runner.rs",
            runner.replace(
              "    server.port()",
              "    let _ = 0;\n    server.port()",
            ),
          ),
        check: (store, work) =>
          assert.equal(work["analyze.rust.fullPass.lookup-cut"], 1),
      },
    ],
  );
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

// C-33 review: the command's verified no-edit path. Each case runs
// `graph index` through the command and compares the store with a cold index.
const installedDeclaration = "node_modules/kit/index.d.ts";
function commandTree(files) {
  const base = mkdtempSync(join(tmpdir(), "c33-command-"));
  const root = join(base, "tree");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { base, root, graph: join(root, ".pymtheg/rebuildable/graph.sqlite") };
}
const installedFiles = {
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
  [installedDeclaration]:
    "export declare class Page {\n  locate(): string;\n}\nexport declare function open(): Page;\n",
  "src/main.ts": 'import { open } from "kit";\n\nopen().locate();\n',
  // The package manager's shared store, present before the first index.
  "node_modules/.pnpm/lock.yaml": "lockfileVersion: '9.0'\n",
};
let coldStep = 0;
async function differencesFromCold({ base, root, graph }) {
  const warm = storeRows(graph);
  const path = join(base, `cold-${coldStep++}.sqlite`);
  const cold = new SqliteGraphStore(path, warm.project[0]);
  try {
    await indexProject(root, registry, cold);
  } finally {
    cold.close();
  }
  return compareRows(warm, storeRows(path));
}
/** One command index; whether it answered without beginning an index run. */
async function commandIndex(root) {
  resetGraphWork();
  const answer = await executeGraph({ command: "index", root });
  return {
    answer,
    verified: graphWork.stages["store.beginRun"] === undefined,
  };
}

for (const [name, edit] of [
  [
    "a second hard link to it (a shared package store)",
    (root) =>
      linkSync(
        join(root, installedDeclaration),
        join(root, "node_modules/.pnpm/shared.d.ts"),
      ),
  ],
  [
    "a permission-only change",
    (root) => chmodSync(join(root, installedDeclaration), 0o600),
  ],
])
  test(`TypeScript: the command records an installed declaration's new stamp after ${name}`, async () => {
    const tree = commandTree(installedFiles);
    try {
      assert.equal((await commandIndex(tree.root)).answer.sync.complete, true);
      edit(tree.root);
      const restamp = await commandIndex(tree.root);
      assert.equal(restamp.answer.sync.complete, true);
      assert.deepEqual(await differencesFromCold(tree), []);
      assert.equal(restamp.verified, false);
      // Every later unchanged run is verified and keeps the cold rows.
      const bytes = readFileSync(tree.graph);
      const again = await commandIndex(tree.root);
      assert.equal(again.answer.sync.complete, true);
      assert.equal(again.verified, true);
      assert.deepEqual(readFileSync(tree.graph), bytes);
      assert.deepEqual(await differencesFromCold(tree), []);
    } finally {
      rmSync(tree.base, { recursive: true, force: true });
    }
  });

test("A verified no-edit index writes nothing and answers beside another writer", async () => {
  const tree = commandTree(installedFiles);
  try {
    const first = await commandIndex(tree.root);
    assert.equal(first.answer.sync.complete, true);
    // A store left in write-ahead-log mode (persistent in the header).
    const wal = new DatabaseSync(tree.graph);
    try {
      wal.exec("PRAGMA journal_mode=WAL");
    } finally {
      wal.close();
    }
    const before = readFileSync(tree.graph);
    assert.equal(before[18], 2);
    const unchanged = await commandIndex(tree.root);
    assert.equal(unchanged.answer.sync.complete, true);
    assert.equal(unchanged.verified, true);
    assert.deepEqual(readFileSync(tree.graph), before);
    // Another connection holds the write lock with an uncommitted graph
    // write and does not wait: the answer is the committed graph.
    const writer = new DatabaseSync(tree.graph, { timeout: 0 });
    try {
      writer.exec("BEGIN IMMEDIATE");
      writer.exec("DELETE FROM graph_links");
      const beside = await commandIndex(tree.root);
      assert.equal(beside.answer.sync.complete, true);
      assert.equal(beside.verified, true);
      assert.deepEqual(beside.answer.counts, first.answer.counts);
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
    assert.deepEqual(readFileSync(tree.graph), before);
    assert.deepEqual(await differencesFromCold(tree), []);
    // A run that committed its first write and has not finished: never
    // verified; the command indexes and takes it over.
    const run = new DatabaseSync(tree.graph);
    try {
      run.exec(`BEGIN IMMEDIATE;
        INSERT INTO graph_meta VALUES ('index-run','unfinished');
        DELETE FROM graph_meta WHERE key IN ('command-complete','analysis-complete');
        DELETE FROM graph_links;
        COMMIT;`);
    } finally {
      run.close();
    }
    const taken = await commandIndex(tree.root);
    assert.equal(taken.answer.sync.complete, true);
    assert.equal(taken.verified, false);
    assert.deepEqual(taken.answer.counts, first.answer.counts);
    assert.deepEqual(await differencesFromCold(tree), []);
  } finally {
    rmSync(tree.base, { recursive: true, force: true });
  }
});

test("Go: a no-edit index without the analysis completion record re-runs recovery", async () => {
  const tree = commandTree({
    "a.go": "package a\nfunc Target() {}\nfunc Use() { Target() }\n",
  });
  const recorded = () => {
    const db = new DatabaseSync(tree.graph, { readOnly: true });
    try {
      return db
        .prepare("SELECT value FROM graph_meta WHERE key='analysis-complete'")
        .get()?.value;
    } finally {
      db.close();
    }
  };
  try {
    assert.equal((await commandIndex(tree.root)).answer.sync.complete, true);
    const record = recorded();
    assert.equal(typeof record, "string");
    const db = new DatabaseSync(tree.graph);
    try {
      db.exec("DELETE FROM graph_meta WHERE key='analysis-complete'");
    } finally {
      db.close();
    }
    const recovery = await commandIndex(tree.root);
    assert.equal(recovery.answer.sync.complete, true);
    assert.equal(recovery.verified, false);
    assert.equal(recorded(), record);
    assert.deepEqual(await differencesFromCold(tree), []);
    assert.equal((await commandIndex(tree.root)).verified, true);
  } finally {
    rmSync(tree.base, { recursive: true, force: true });
  }
});
