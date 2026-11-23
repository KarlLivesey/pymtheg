// SPDX-License-Identifier: MIT
// C-38A: the index command's report says which TypeScript analysis path ran.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
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
