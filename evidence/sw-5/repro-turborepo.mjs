// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contentHash, validateResult } from "../../dist/graph/identity.js";
import typescript from "../../dist/graph/languages/typescript/index.js";

const [checkout] = process.argv.slice(2);
if (!checkout) throw Error("Pass the checkout of the pinned Turborepo commit");

const capture = (path) => {
  const bytes = readFileSync(join(checkout, path));
  return { path, text: bytes.toString("utf8"), hash: contentHash(bytes) };
};
const workspaces = ["examples/basic", "examples/with-yarn"];
const files = workspaces.flatMap((dir) => [
  `${dir}/apps/web/eslint.config.js`, `${dir}/packages/eslint-config/next.js`,
]).map((path) => ({ ...capture(path), module: "typescript", version: "",
  result: { status: "clean", diagnostics: [], links: [], symbols: [] } }));
const contextFiles = ["examples/basic/pnpm-workspace.yaml", ...workspaces.flatMap((dir) => [
  `${dir}/package.json`, `${dir}/apps/web/package.json`, `${dir}/packages/eslint-config/package.json`,
])].map((path) => ({ ...capture(path), status: "clean", diagnostics: [] }));

const results = typescript.analyze({ projectId: "sw5-repro", files, contextFiles,
  changedFiles: files.map(({ path }) => path), changedContextFiles: contextFiles.map(({ path }) => path) });
const path = "examples/with-yarn/packages/eslint-config/next.js";
const { text } = files.find((file) => file.path === path);
const { result } = results.find((file) => file.path === path);
assert.throws(() => validateResult(text, result), { message: "Invalid UTF-16 range" });
assert.equal(text.length, 68);
assert.equal(result.symbols.find(({ kind }) => kind === "module").range.end, 903);
console.log(`${path}: Invalid UTF-16 range (903 > 68)`);
