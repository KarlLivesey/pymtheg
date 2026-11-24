// SPDX-License-Identifier: MIT
// C-57: a module file chosen by `cfg_attr(…, path = "…")` is the module only
// under its predicate. Everything declared in it is conditional the same
// way: a name or macro two mutually exclusive files define is never one
// definite target, no offset in one file decides against another, an edit
// equals a cold index, and a failure is cited only from a file that can
// apply where the access is. Each case failed on main (b6fd7c91).
import "./isolated-config.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import rust from "../dist/graph/languages/rust/index.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";

const CARGO =
  '[package]\nname = "choice"\nversion = "0.1.0"\nedition = "2021"\n\n[features]\nfast = []\n';
const SELECTORS =
  '#[cfg_attr(feature = "fast", path = "fast.rs")]\n#[cfg_attr(not(feature = "fast"), path = "slow.rs")]\nmod choice;\n';
const LONG_COMMENT = `// ${"a comment that moves the macro below it ".repeat(12)}\n`;
const MACROS = {
  "Cargo.toml": CARGO,
  "src/lib.rs":
    "#[macro_use]\n" +
    SELECTORS +
    "struct T;\ntrait Marker {\n    fn f();\n}\npick!(T);\n\npub fn check(_: Option<()>) -> &'static str {\n    std::any::type_name::<Option<()>>()\n}\n",
  // slow.rs's macro sits at a larger offset than fast.rs's.
  "src/slow.rs":
    LONG_COMMENT +
    "macro_rules! pick {\n    ($ty:ident) => {\n        impl Marker for $ty {\n            fn f() {}\n        }\n    };\n}\n",
  "src/fast.rs":
    "macro_rules! pick {\n    ($ty:ident) => {\n        pub struct Option<T>(T);\n    };\n}\n",
};

async function write(dir, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
}
async function indexInto(dir, storePath) {
  const store = new SqliteGraphStore(storePath, "c57");
  try {
    await indexProject(dir, new LanguageRegistry([rust]), store);
    const symbols = new Map(store.findSymbols().map((s) => [s.id, s]));
    return { links: store.links(), symbols };
  } finally {
    store.close();
  }
}
async function scratch(use) {
  const dir = await mkdtemp(join(tmpdir(), "pymtheg-c57-"));
  try {
    return await use(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const targetOf = (g, l) => {
  const t = l.targetId ? g.symbols.get(l.targetId) : undefined;
  return t ? `${t.file}#${t.identity}` : null;
};

test("C-57 (1): a macro two cfg_attr(path) alternatives define is never one definite target", async () => {
  await scratch(async (dir) => {
    await write(join(dir, "p"), MACROS);
    const g = await indexInto(join(dir, "p"), join(dir, "g.sqlite"));
    const pick = g.links.filter(
      (l) => l.file === "src/lib.rs" && l.targetName === "pick",
    );
    assert.ok(pick.length > 0, "pick! is a link");
    for (const l of pick)
      assert.notEqual(
        l.resolution,
        "resolved",
        `pick! must not be definite: ${targetOf(g, l)} ${JSON.stringify(l.data)}`,
      );
  });
});

test("C-57 (2): a name a macro from either alternative could shadow is not resolved to std", async () => {
  await scratch(async (dir) => {
    await write(join(dir, "p"), MACROS);
    const g = await indexInto(join(dir, "p"), join(dir, "g.sqlite"));
    const option = g.links.filter(
      (l) => l.file === "src/lib.rs" && /(^|::)Option$/.test(l.targetName),
    );
    assert.ok(option.length >= 2, "both written Option are links");
    for (const l of option)
      assert.notEqual(
        l.resolution,
        "library",
        `Option must not be definite std: ${JSON.stringify(l.libraries)}`,
      );
  });
});

test("C-57 (3): a comment that moves one alternative's macro past the other's offset re-indexes to the cold index's rows", async () => {
  await scratch(async (dir) => {
    const project = join(dir, "p");
    await write(project, MACROS);
    await indexInto(project, join(dir, "warm.sqlite"));
    await writeFile(
      join(project, "src/fast.rs"),
      LONG_COMMENT + LONG_COMMENT + MACROS["src/fast.rs"],
    );
    await indexInto(project, join(dir, "warm.sqlite"));
    await indexInto(project, join(dir, "cold.sqlite"));
    assert.deepEqual(
      compareRows(
        storeRows(join(dir, "warm.sqlite")),
        storeRows(join(dir, "cold.sqlite")),
      ),
      [],
    );
  });
});

test("C-57 (4): a failure is cited only from an alternative file that can apply where the call is", async () => {
  await scratch(async (dir) => {
    await write(join(dir, "p"), {
      "Cargo.toml": CARGO,
      "src/lib.rs":
        SELECTORS +
        '\n#[cfg(feature = "fast")]\npub fn caller() {\n    choice::pick();\n}\n',
      "src/fast.rs": "pub fn pick() {}\n",
      "src/slow.rs": "pub fn pick( {\n",
    });
    const g = await indexInto(join(dir, "p"), join(dir, "g.sqlite"));
    const [call] = g.links.filter(
      (l) => l.file === "src/lib.rs" && l.targetName === "choice::pick",
    );
    assert.ok(call, "the call is a link");
    assert.equal(
      JSON.stringify(call.data).includes("slow.rs"),
      false,
      `slow.rs is never cited: ${JSON.stringify(call.data)}`,
    );
    assert.equal(
      (call.data.uncertainty ?? "").includes("invalid-code"),
      false,
      JSON.stringify(call.data),
    );
    // Where the call exists the module is fast.rs: its pick is the target.
    assert.equal(targetOf(g, call), "src/fast.rs#pick");
  });
});
