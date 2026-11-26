// SPDX-License-Identifier: MIT
// C-62: an index run that another run has overtaken writes nothing, and
// never disturbs the newer run's mark. Each run is a child process stopped
// (SIGSTOP) at a named gate (test/graph-index-ownership-child.mjs); this test
// waits for it to be stopped, acts, and continues it. No timing: every step
// waits on an event. Every case must end equal to a cold index of the tree,
// with its completion intact, with no further index.
import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import {
  discoverLanguages,
  indexProject,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";

const child = new URL("graph-index-ownership-child.mjs", import.meta.url)
  .pathname;
const proc = existsSync("/proc/self/status");
const production = await discoverLanguages();
const graphAt = (root) => join(root, ".pymtheg/rebuildable/graph.sqlite");

/** Each language's tree, with an export to remove, a file to add and a body edit. */
const LANGUAGES = {
  go: {
    files: {
      "go.mod": "module example.com/m\n\ngo 1.22\n",
      "a/a.go": "package a\n\nfunc Hello() int { return 1 }\n",
      "b/b.go":
        'package b\n\nimport "example.com/m/a"\n\nfunc B() int { return a.Hello() }\n',
    },
    exported: "a/a.go",
    removeExport: (text) => text.replace("func Hello", "func hello"),
    added: ["c/c.go", "package c\n\nfunc C() int { return 3 }\n"],
    edit: (text) => text.replace("return 1", "return 2"),
  },
  rust: {
    files: {
      "Cargo.toml":
        '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n',
      "src/lib.rs": "pub mod a;\npub fn use_it() -> u32 { a::hello() }\n",
      "src/a.rs": "pub fn hello() -> u32 { 1 }\n",
    },
    exported: "src/a.rs",
    removeExport: (text) => text.replace("pub fn hello", "fn hello"),
    added: ["src/c.rs", "pub fn c() -> u32 { 3 }\n"],
    edit: (text) => text.replace("{ 1 }", "{ 2 }"),
  },
  typescript: {
    files: {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true },
        include: ["src"],
      }),
      "src/a.ts": "export function foo() { return 1 }\n",
      "src/b.ts": "import { foo } from './a';\nexport const b = foo();\n",
    },
    exported: "src/a.ts",
    removeExport: (text) => text.replace("export function", "function"),
    added: ["src/c.ts", "export const c = 3;\n"],
    edit: (text) => text.replace("return 1", "return 2"),
  },
};

const cli = (root, command = "index", ...args) => {
  const result = spawnSync(
    process.execPath,
    [
      resolve("dist/cli/main.js"),
      "graph",
      command,
      ...args,
      "--root",
      root,
      "--json",
    ],
    { encoding: "utf8" },
  );
  assert.ok(result.status <= 2, result.stderr);
  return JSON.parse(result.stdout);
};
function project(language) {
  const base = mkdtempSync(join(tmpdir(), `c62-${language}-`));
  const root = join(base, "tree");
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const read = (path) => readFileSync(join(root, path), "utf8");
  for (const [path, text] of Object.entries(LANGUAGES[language].files))
    write(path, text);
  assert.equal(cli(root).sync.complete, true);
  return { base, root, write, read };
}
/** A run in a child, stopped at `gate`; `resume()` returns its reply. */
async function stopped(root, how, gate) {
  const run = fork(child, [root, how, gate], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  let reply;
  let stop;
  const at = new Promise((done) => (stop = done));
  run.on("message", (message) => {
    if (message.stopped) stop(message);
    if (message.reply) reply = message.reply;
  });
  const exited = new Promise((done) =>
    run.once("exit", (code, signal) => {
      stop(undefined);
      done({ code, signal });
    }),
  );
  const message = await at;
  assert.ok(message, `the run reached ${gate}`);
  // Stopped for certain, not only about to be.
  while (!/^State:\s+T/m.test(readFileSync(`/proc/${run.pid}/status`, "utf8")))
    await new Promise(setImmediate);
  return {
    async resume() {
      run.kill("SIGCONT");
      const result = await exited;
      assert.equal(result.code, 0);
      return reply;
    },
    async kill() {
      run.kill("SIGKILL");
      await exited;
    },
  };
}
/** The stored rows against a cold index of the tree as it is now. */
async function differencesFromCold(base, root) {
  const graph = graphAt(root);
  const cold = join(base, `cold-${Math.random().toString(36).slice(2)}.sqlite`);
  const store = new SqliteGraphStore(cold, storeRows(graph).project[0]);
  try {
    await indexProject(root, production, store, {
      excludeDirectories: [".pymtheg"],
    });
  } finally {
    store.close();
  }
  return compareRows(storeRows(graph), storeRows(cold));
}
/** Equal to cold and complete as stored, with no further index. */
async function settled(base, root, what) {
  assert.deepEqual(await differencesFromCold(base, root), [], what);
  assert.equal(cli(root, "status").sync.complete, true, what);
}
const overtaken = (reply, what) =>
  assert.ok(
    reply.error === "GraphIndexTakenOver" ||
      reply.error === "GraphIndexStale" ||
      reply.complete === false,
    `${what}: ${JSON.stringify(reply)}`,
  );

for (const language of Object.keys(LANGUAGES)) {
  const L = LANGUAGES[language];
  test(
    `${language}: a run paused after parsing an export's removal writes nothing once the file is restored and a syncing query found it current`,
    { skip: !proc && "needs /proc to see the child stopped" },
    async () => {
      const { base, root, write, read } = project(language);
      try {
        const original = read(L.exported);
        write(L.exported, L.removeExport(original));
        const A = await stopped(root, "command", "after-parse");
        write(L.exported, original);
        // A syncing query: it finds the tree current and writes nothing.
        assert.equal(cli(root, "status").sync.complete, true);
        const query = cli(root, "file", L.exported);
        assert.equal(query.sync.complete, true);
        overtaken(await A.resume(), "A");
        await settled(base, root, "after A");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );

  test(
    `${language}: a run paused after its walk never deletes a file another run indexed meanwhile`,
    { skip: !proc && "needs /proc to see the child stopped" },
    async () => {
      const { base, root, write } = project(language);
      try {
        const A = await stopped(root, "index", "after-walk");
        write(...L.added);
        assert.equal(cli(root).sync.complete, true);
        overtaken(await A.resume(), "A");
        await settled(base, root, "after A");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );

  test(
    `${language}: a run's late completion leaves a newer, still running run's mark alone`,
    { skip: !proc && "needs /proc to see the child stopped" },
    async () => {
      const { base, root, write, read } = project(language);
      try {
        // A has written its rows and passed its own checks.
        write(L.exported, L.edit(read(L.exported)));
        const A = await stopped(root, "command", "before-publish");
        // B claims for a newer edit and is still running.
        write(L.exported, L.edit(L.edit(read(L.exported))) + "\n");
        const B = await stopped(root, "command", "before-finish");
        await A.resume();
        const reply = await B.resume();
        assert.equal(reply.complete, true, JSON.stringify(reply));
        await settled(base, root, "after B");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );
}

// Three runs. A holds an older capture, before its claim; B has claimed for
// a newer tree and holds its mark; C, a full index, takes over and finishes.
// In either resume order, A and B write nothing more and disturb nothing:
// C's result stands, complete, with no further index.
for (const order of ["A, B", "B, A"])
  test(
    `three runs: an older capture and a taken-over run resumed ${order} leave the third run's complete result`,
    { skip: !proc && "needs /proc to see the child stopped" },
    async () => {
      const L = LANGUAGES.go;
      const { base, root, write, read } = project("go");
      try {
        const original = read(L.exported);
        write(L.exported, L.removeExport(original));
        const A = await stopped(root, "command", "after-parse");
        write(L.exported, L.edit(original));
        const B = await stopped(root, "command", "before-finish");
        write(...L.added);
        assert.equal(cli(root).sync.complete, true);
        const runs = { A, B };
        for (const name of order.split(", "))
          overtaken(await runs[name].resume(), name);
        await settled(base, root, `after ${order}`);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );

// A run killed at any gate leaves a store that one more index makes equal
// to a cold index of the tree; a run killed before its claim wrote nothing.
for (const gate of [
  "after-walk",
  "after-parse",
  "before-finish",
  "before-publish",
])
  test(
    `a run killed at ${gate} needs at most one more index`,
    { skip: !proc && "needs /proc to see the child stopped" },
    async () => {
      const L = LANGUAGES.go;
      const { base, root, write, read } = project("go");
      try {
        const before = storeRows(graphAt(root));
        write(L.exported, L.edit(read(L.exported)));
        const A = await stopped(
          root,
          gate === "after-walk" ? "index" : "command",
          gate,
        );
        await A.kill();
        if (gate === "after-walk" || gate === "after-parse")
          assert.deepEqual(
            compareRows(before, storeRows(graphAt(root))),
            [],
            "nothing written before the claim",
          );
        assert.equal(cli(root).sync.complete, true);
        await settled(base, root, `after ${gate}`);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );
