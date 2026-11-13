# W2-S: vendored grammar route and patched Go grammar

The Go module now loads a grammar that Pymtheg builds itself from pinned
upstream source and committed patches: `grammars/go/tree-sitter-go.wasm`
(upstream `tree-sitter-go` v0.25.0 + PRs #202 and #198). The `.wasm`, its
sha256, the tool versions and the upstream licence are checked in, and a test
verifies them. This chunk sets up the route for every language. Rust follows
in the next chunk.

## What changes for users

- Go files using **Go 1.26 `new(expr)`**, **user-declared `new` / `make`
  called with values**, or **Go 1.27 generic methods** are read instead of
  failing. On restic `c734245`, `internal/ui/termstatus/status_test.go` is now
  read. Its two `new(…)` calls resolve to restic's own `func new`.
- Go module version 22 → 23. The parser that produces the stored results has
  changed, so stored Go results are re-parsed once. The corpus comparison
  below shows that every file that parsed before produces the same output.
- Two Go module changes were needed because the grammar now produces trees it
  could not produce before:
  - **Generic methods** (`extract.ts`, `methodDeclaration`): a method's own
    type parameters are scoped like a generic function's, and the method gets
    `generic: true`. Without this, a method type parameter `U` read as a
    package-level type `U` and gave a **wrong definite link** (the method's
    `u.Close()` resolved to `(U).Close` of an unrelated `type U`).
  - **`new(expr)`** (`extract.ts`, builtin result hint): when the argument is
    an expression (never a type node), the result is described from the
    value, so `p := new(S(v)); p.M()` resolves to `(S).M`. Under the old
    grammar this argument was always a type node, so no previously parsed file
    can reach the new branch.
- Known limit, not a wrong result: an explicitly instantiated generic method
  call `t.Map[C](x)` stays unresolved. The grammar reads it as a conversion to
  a package-qualified generic type `t.Map[C]`, the same shape as `pkg.F[T](x)`.
  Describing a local operand differently would also change existing calls
  such as `s.handlers[k](req)`. The inferred form `t.Map(x)` resolves.

## Gaps that remain (tests: `test/graph-go-grammar.test.mjs`)

| Shape                                                                    | Outcome                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty statement `;` right after `{` (function literal, body, `if` block) | File fails (as before)                                                                                                                                                                    |
| Non-BMP identifier on web-tree-sitter's 5,119-unit chunk boundary        | File fails (runtime limit; fix belongs to `src/graph/tree-sitter.ts`, another chunk)                                                                                                      |
| No final newline after the last `}` / `)`                                | Read (as on main): the grammar reports only a zero-width missing terminator at end of file, which the Go module's error walk does not reach. Go accepts the file and the tree is complete |

## Evidence (`evidence/w2-s/`)

- `build-verify.txt`: `node grammars/build.mjs go` rebuilds from the pinned
  commit and patches. Upstream's own `tree-sitter test` corpus passes,
  including the PRs' new cases, and the build reproduces the committed sha256
  `e4a54cba…5d28`. This is the third identical build: W2-P's scratch build,
  this chunk's `--write` and this verify run.
- Pinned corpus (`corpus.txt`): restic `c734245` (clean shallow clone, recreate
  as written there), a restic control without the file the old grammar
  rejected, 18 Go module-cache entries (`module@version`, checksum-pinned), and
  a subset of the Go 1.26.10 toolchain source (`encoding/json/**`,
  `runtime/secret/**`) with its control. `run-corpus.sh` dumps the stored
  graph (files, symbols, links with resolution) with `origin/main`'s build and
  this build (`graph-dump.mjs`), then diffs the dumps (`graph-diff.mjs`,
  outputs in `diffs/`).
- Results:
  - **Byte-identical apart from the version field**: all 18 module-cache
    entries, and both controls (restic without the file, the toolchain subset
    without the two files).
  - **restic**: 1 failed file → 0. It gains 14 symbols and 146 links of its
    own (plus the package's `contains` link to it), and both `new(…)` calls
    resolve to restic's `func new`. Links in 174 other
    files lose the `declarations-may-be-unseen` reason, and 30 builtin calls
    lose their `invalid-code` cause. Both existed only because a failed file
    might have declared the names.
  - **Toolchain subset**: 2 failed files (`encoding/json/v2/arshal_test.go`,
    a parameter named `make`; `runtime/secret/secret_test.go`, `new(T(v))`)
    → 0. They gain 556 symbols and 8,299 links of their own (plus two
    `contains` links).
  - **Every other change in the other files is attributed**
    (`explain-restic.txt`, `explain-toolchain-subset.txt`, 0 unexplained).
    `explain-changes.mjs` compares the old build _without_ the newly read
    files against the new build _with_ them. Each changed link is either
    reaching a declaration in a newly read file, an overflow candidate count
    grown by that file's same-named declarations, or the package's `contains`
    link to the new file.
- `fixtures-go-vet.txt`: `go vet ./...` (Go 1.27.4) passes on
  `test/fixtures/graph-go/grammar`.
- `npm-pack.txt`, `clean-build.txt`: package contents and a clean
  `npm ci --ignore-scripts` build.
- Fetched over the network for the build: `github.com/tree-sitter/tree-sitter-go`
  at `1547678a…` (depth 1, by `build.mjs`), and PR heads `e9739428…` and
  `2a37d91d…` once, to cut the patch files. The tree-sitter CLI is installed
  from crates.io `tree-sitter-cli@0.27.2`. On first use it downloads wasi-sdk
  34.0 and binaryen version_132.

## How to rebuild or update a vendored grammar

1. **Tools.** Install the exact CLI version from the manifest, outside the
   repository:
   `cargo install tree-sitter-cli@0.27.2 --locked --root <dir>` and set
   `TREE_SITTER=<dir>/bin/tree-sitter`. Node 24 and git are also needed. The
   first `build --wasm` downloads wasi-sdk and binaryen into
   `~/.cache/tree-sitter`; `build.mjs` checks their versions against the
   manifest.
2. **Check the current file.** Run `node grammars/build.mjs go`. It fetches
   the pinned commit, applies the patches, runs `tree-sitter generate` and
   `tree-sitter test`, builds the `.wasm` and fails unless the bytes match the
   committed file and the manifest.
3. **Change something** (a new upstream tag, an added or dropped patch, new
   tool versions):
   1. Edit `grammars/<lang>/manifest.json`: `upstream.tag` and the full
      `upstream.commit`, and the `patches` entries (file, pull-request URL,
      full head commit, base commit, paths), or `tools`.
   2. Cut a patch from the upstream PR head with only the grammar source and
      its test corpus:
      `git diff <base> <head> -- grammar.js test/corpus > grammars/<lang>/patches/NNNN-prNNN-<what>.patch`.
      Do not include the PR's generated `src/parser.c`; `tree-sitter generate`
      rebuilds it.
   3. If the upstream commit changed, copy its `LICENSE` into
      `grammars/<lang>/LICENSE`.
   4. Run `node grammars/build.mjs <lang> --write`. This replaces the `.wasm`
      and records its sha256 in the manifest.
4. **Gate on the pinned corpus before committing.** Build `origin/main` in a
   scratch copy:
   `git archive origin/main src tsconfig.json package.json | tar -x -C <dir>`,
   link `node_modules`, then `npx tsc -p <dir>/tsconfig.json`. Then run
   `bash evidence/w2-s/run-corpus.sh <dir>/dist <scratch> <go-mod-cache>`.
   - Every file that parsed before must give identical output.
   - Any change in other files must be explained by newly read files (0
     unexplained).
   - Files whose trees change but still parse need a reason in the change
     note. This is how W2-P rejected PR #190.
5. **Bump the language module's `version`** when the grammar changes, so that
   stored results are re-parsed.
6. **Run the checks**: `npm test` (it includes `test/grammar-vendored.test.mjs`
   and the language's graph tests), `npm run format:check` and
   `node scripts/grammar-check.mjs`.

## Layout decision

The files live in a top-level `grammars/` directory, not in `src/`. They are
built artefacts shared by the language modules, not TypeScript source, and
`tsc` does not copy a `.wasm` out of `src/` (the W1-C backlog item). The
package lists only `grammars/*/tree-sitter-*.wasm`, the manifests, the
licences and `grammars/README.md`. The Go module resolves its grammar relative
to its own compiled file (`../../../../grammars/go/…`), so it works from
`dist/` and from the installed package without a build-time copy step. The
npm `tree-sitter-go` dependency stays: `scripts/grammar-check.mjs` uses its
tags query, and the vendored-grammar test uses its `.wasm` to show that the
module loads the vendored build. The Rust module is unchanged and still loads
npm `tree-sitter-rust`.
