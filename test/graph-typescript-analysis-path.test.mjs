// SPDX-License-Identifier: MIT
// C-38A: the index command's report says which TypeScript analysis path ran.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SqliteGraphStore } from "../dist/graph/store.js";
import { LanguageRegistry } from "../dist/graph/index.js";
import { executeGraph } from "../dist/graph/commands.js";
import { formatGraph } from "../dist/cli/graph.js";
import typescript from "../dist/graph/languages/typescript/index.js";

test("the index report names the TypeScript analysis path", async () => {
  const root = await mkdtemp(join(tmpdir(), "c38a-path-"));
  const write = async (path, text) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  const f = "export function f(): string {\n  return 'f';\n}\n";
  try {
    await write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "ESNext",
          moduleResolution: "Bundler",
        },
        include: ["src"],
      }),
    );
    await write("src/f.ts", f);
    await write("src/g.ts", 'import { f } from "./f";\nf().toUpperCase();\n');
    const registry = new LanguageRegistry([typescript]);
    let text = "";
    const index = async () => {
      const response = await executeGraph(
        { command: "index", root },
        { registry },
      );
      assert.equal(response.status, "ok");
      text = formatGraph(response);
      return response.sync.report?.analysisPaths;
    };
    assert.deepEqual(await index(), [
      { module: "typescript", path: "full", note: "no previous index" },
    ]);
    assert.match(text, /^Analysis typescript: full \(no previous index\)$/m);
    // Nothing changed: the stored results are reused, no program built.
    // Only an injected module list gets here: with the production modules
    // a no-edit index takes the verified shortcut (C-33) and nothing
    // analyses, so the report has no path.
    assert.deepEqual(await index(), [{ module: "typescript", path: "reused" }]);
    assert.match(text, /^Analysis typescript: reused$/m);
    // Any edit: the whole analysis runs again.
    await write(
      "src/f.ts",
      f.replace("  return 'f';", "  void 0;\n  return 'f';"),
    );
    assert.deepEqual(await index(), [{ module: "typescript", path: "full" }]);
    assert.match(text, /^Analysis typescript: full$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const cli = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));
/** The real CLI's `graph index`: its JSON response and, from a second
 * copy of the same steps, its printed text (see `steps`). */
function cliIndex(root, json) {
  const result = spawnSync(
    process.execPath,
    [cli, "graph", "index", ...(json ? ["--json"] : []), "--root", root],
    { encoding: "utf8" },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result.stdout;
}
/**
 * Runs `steps` (each writes files, then indexes) twice, in two copies of a
 * project: once reading the JSON report's `analysisPaths`, once the
 * printed `Analysis` lines.
 */
async function bothWays(files, steps) {
  const out = { json: [], text: [] };
  for (const mode of ["json", "text"]) {
    const root = await mkdtemp(join(tmpdir(), "c38a-cli-"));
    try {
      const write = async (path, text) => {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), text);
      };
      for (const [path, text] of Object.entries(files)) await write(path, text);
      for (const step of steps) {
        await step(write, root);
        const stdout = cliIndex(root, mode === "json");
        out[mode].push(
          mode === "json"
            ? (JSON.parse(stdout).sync.report?.analysisPaths ?? null)
            : stdout.split("\n").filter((line) => line.startsWith("Analysis ")),
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  return out;
}

test("Go-only and Rust-only projects report no analysis path, cold and after an edit (real CLI)", async () => {
  const projects = {
    go: {
      files: {
        "go.mod": "module example.com/app\n\ngo 1.22\n",
        "main.go":
          "package main\n\nfunc helper() {}\n\nfunc main() { helper() }\n",
      },
      edit: [
        "main.go",
        "package main\n\nfunc helper() {}\n\nfunc main() {\n\thelper()\n}\n",
      ],
    },
    rust: {
      files: {
        "Cargo.toml": '[package]\nname="app"\nedition="2021"\n',
        "src/lib.rs": "fn helper() {}\npub fn entry() { helper(); }\n",
      },
      edit: [
        "src/lib.rs",
        "fn helper() {}\npub fn entry() {\n    helper();\n}\n",
      ],
    },
  };
  for (const [name, { files, edit }] of Object.entries(projects)) {
    const got = await bothWays(files, [
      async () => {},
      async (write) => write(...edit),
    ]);
    assert.deepEqual(got, { json: [null, null], text: [[], []] }, name);
  }
});

test("a TypeScript index after a run stopped during analysis is full, not a first index (real CLI)", async () => {
  const f = "export function f(): string {\n  return 'f';\n}\n";
  const got = await bothWays(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "ESNext",
          moduleResolution: "Bundler",
        },
        include: ["src"],
      }),
      "src/f.ts": f,
      "src/g.ts": 'import { f } from "./f";\nf().toUpperCase();\n',
    },
    [
      async () => {},
      // An edit, then a run that claims the store before analysis and is
      // stopped there: its mark stays, as after a signal or a crash.
      async (write, root) => {
        await write("src/f.ts", f.replace("  return", "  void 0;\n  return"));
        const store = new SqliteGraphStore(
          join(root, ".pymtheg/rebuildable/graph.sqlite"),
        );
        try {
          store.beginIndexRun();
          store.claimIndexRun();
        } finally {
          store.close();
        }
      },
    ],
  );
  assert.deepEqual(got, {
    json: [
      [{ module: "typescript", path: "full", note: "no previous index" }],
      [{ module: "typescript", path: "full" }],
    ],
    text: [
      ["Analysis typescript: full (no previous index)"],
      ["Analysis typescript: full"],
    ],
  });
});
