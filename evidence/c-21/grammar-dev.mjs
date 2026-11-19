// SPDX-License-Identifier: MIT
// Scratch build of the Rust grammar for the corpus gate: the same inputs and
// steps as grammars/build.mjs (pinned commit, manifest patches in order,
// `tree-sitter generate`, `tree-sitter test`, `build --wasm`), but the .wasm
// goes to a scratch path and the manifest is not touched. Optionally prints
// `tree-sitter parse` output for sample files.
//   [ONLY=00NN] TREE_SITTER=<cli> node grammar-dev.mjs <workdir> <out.wasm> [file.rs...]
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const directory = join(repo, "grammars", "rust");
const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
const [work, out, ...samples] = process.argv.slice(2);
const treeSitter = process.env.TREE_SITTER ?? "tree-sitter";
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1 << 28,
    ...options,
  });

const source = join(work, "src");
rmSync(source, { recursive: true, force: true });
mkdirSync(source, { recursive: true });
run("git", ["init", "-q", source]);
run("git", ["-C", source, "fetch", "-q", "--depth", "1", manifest.upstream.repository, manifest.upstream.commit]);
run("git", ["-C", source, "checkout", "-q", "FETCH_HEAD"]);
// ONLY=0011 applies 0001-0008 and that one C-21 patch (attribution builds).
const only = process.env.ONLY;
for (const patch of manifest.patches) {
  const number = /patches\/(\d{4})-/.exec(patch.file)[1];
  if (only && number >= "0009" && number !== only) continue;
  run("git", ["-C", source, "apply", "--whitespace=nowarn", join(directory, patch.file)]);
  console.log(`applied ${patch.file}`);
}
run(treeSitter, ["generate"], { cwd: source });
try {
  const tests = run(treeSitter, ["test"], { cwd: source });
  console.log(/failure/.test(tests) ? tests : "tree-sitter test: all corpus cases pass");
} catch (error) {
  console.log(`tree-sitter test failed:\n${error.stdout}${error.stderr}`);
}
run(treeSitter, ["build", "--wasm", "-o", join(work, "out.wasm"), "."], { cwd: source });
copyFileSync(join(work, "out.wasm"), out);
console.log(`wrote ${out}`);
for (const file of samples) {
  try {
    console.log(run(treeSitter, ["parse", resolve(file)], { cwd: source }));
  } catch (error) {
    console.log(error.stdout);
  }
}
