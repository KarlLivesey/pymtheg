// SPDX-License-Identifier: MIT
// C-38 review: the index command's report says which TypeScript analysis
// path ran and, in order, why a scoped analysis was not used.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { LanguageRegistry } from "../dist/graph/index.js";
import { executeGraph } from "../dist/graph/commands.js";
import { formatGraph } from "../dist/cli/graph.js";
import typescript from "../dist/graph/languages/typescript/index.js";

test("the index report names the analysis path and the decline reasons", async () => {
  const root = await mkdtemp(join(tmpdir(), "c38-path-"));
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
      return response.sync.report.analysisPaths;
    };
    assert.deepEqual(await index(), [
      { module: "typescript", path: "full", note: "no previous index" },
    ]);
    assert.match(text, /^Analysis typescript: full \(no previous index\)$/m);
    // A body-only edit: scoped, nothing declined.
    await write(
      "src/f.ts",
      f.replace("  return 'f';", "  void 0;\n  return 'f';"),
    );
    assert.deepEqual(await index(), [{ module: "typescript", path: "scoped" }]);
    // A new export changes the syntactic surface: full, with its reason.
    await write("src/f.ts", f + "export const g = 1;\n");
    assert.deepEqual(await index(), [
      { module: "typescript", path: "full", declined: ["syntactic surface"] },
    ]);
    // The text output says the same.
    assert.match(
      text,
      /^Analysis typescript: full \(scoped declined: syntactic surface\)$/m,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
