// SPDX-License-Identifier: MIT
// Build a vendored tree-sitter grammar from a pinned upstream commit plus the
// committed patch files, as recorded in grammars/<language>/manifest.json.
//
//   node grammars/build.mjs <language>           build and compare with the committed .wasm
//   node grammars/build.mjs <language> --write   build, replace the .wasm, record its sha256
//
// Maintainer-time only: never run by `npm ci`, `npm test` or an install hook.
// Needs: git, node, network access to the upstream repository, and the
// tree-sitter CLI at the exact version in the manifest (set TREE_SITTER to its
// path, or have `tree-sitter` on PATH; install with
// `cargo install tree-sitter-cli@<version> --locked --root <dir>`). The CLI's
// first `build --wasm` downloads wasi-sdk and binaryen into
// ~/.cache/tree-sitter; their versions are checked against the manifest too.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [language, flag] = process.argv.slice(2);
if (!language || (flag && flag !== "--write")) {
  console.error("usage: node grammars/build.mjs <language> [--write]");
  process.exit(2);
}
const directory = join(here, language);
const manifestPath = join(directory, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const treeSitter = process.env.TREE_SITTER ?? "tree-sitter";
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function checkTool(name, actual) {
  const wanted = manifest.tools[name];
  if (actual !== wanted)
    throw Error(`${name}: found ${actual}, manifest pins ${wanted}`);
  console.log(`${name} ${actual}`);
}
checkTool(
  "tree-sitter-cli",
  run(treeSitter, ["--version"]).trim().split(/\s+/)[1],
);

const work = mkdtempSync(join(tmpdir(), `grammar-${language}-`));
try {
  const source = join(work, "src");
  run("git", ["init", "-q", source]);
  run("git", [
    "-C",
    source,
    "remote",
    "add",
    "origin",
    manifest.upstream.repository,
  ]);
  run("git", [
    "-C",
    source,
    "fetch",
    "-q",
    "--depth",
    "1",
    "origin",
    manifest.upstream.commit,
  ]);
  run("git", ["-C", source, "checkout", "-q", "FETCH_HEAD"]);
  const head = run("git", ["-C", source, "rev-parse", "HEAD"]).trim();
  if (head !== manifest.upstream.commit)
    throw Error(`fetched ${head}, expected ${manifest.upstream.commit}`);
  console.log(
    `upstream ${manifest.upstream.repository} ${manifest.upstream.tag} ${head}`,
  );
  for (const patch of manifest.patches) {
    run("git", [
      "-C",
      source,
      "apply",
      "--whitespace=nowarn",
      join(directory, patch.file),
    ]);
    console.log(
      patch.origin === "pymtheg"
        ? `applied ${patch.file} (Pymtheg's own patch, not upstream)`
        : `applied ${patch.file} (${patch.pullRequest} @ ${patch.headCommit.slice(0, 12)})`,
    );
  }
  run(treeSitter, ["generate"], { cwd: source });
  // Upstream's own corpus, including the cases the patches add.
  const tests = run(treeSitter, ["test"], { cwd: source });
  const failed = /(\d+) failure/.exec(tests);
  if (failed) throw Error(`tree-sitter test: ${failed[0]}\n${tests}`);
  console.log("tree-sitter test: all upstream corpus cases pass");
  const built = join(work, manifest.output);
  run(treeSitter, ["build", "--wasm", "-o", built, "."], { cwd: source });
  const cache = join(homedir(), ".cache", "tree-sitter");
  checkTool(
    "wasi-sdk",
    readFileSync(join(cache, "wasi-sdk", "VERSION"), "utf8")
      .split("\n")[0]
      .trim(),
  );
  checkTool(
    "binaryen",
    /\((version_\d+)\)/.exec(
      run(join(cache, "binaryen", "bin", "wasm-opt"), ["--version"]),
    )?.[1],
  );
  const digest = sha256(built);
  console.log(`built ${manifest.output} sha256 ${digest}`);
  if (flag === "--write") {
    copyFileSync(built, join(directory, manifest.output));
    manifest.sha256 = digest;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`wrote ${join(language, manifest.output)} and manifest sha256`);
  } else {
    const committed = sha256(join(directory, manifest.output));
    if (committed !== digest || manifest.sha256 !== digest)
      throw Error(
        `committed ${committed} / manifest ${manifest.sha256} differ from the build ${digest}`,
      );
    console.log("committed .wasm and manifest match the build");
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
