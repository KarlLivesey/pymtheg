# Vendored tree-sitter grammars

Pymtheg builds some tree-sitter grammars itself instead of taking the `.wasm`
from an npm package. The reason: a grammar that rejects valid code fails whole
files (W2-P), and the fixes exist upstream only as unmerged pull requests.

Each `grammars/<language>/` directory holds:

| File                      | What it is                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`           | The single record: upstream repository, tag and full commit; each patch with its pull request, PR head commit and base; tool versions; ABI; sha256 of the `.wasm` |
| `patches/*.patch`         | The exact `grammar.js` (and upstream `test/corpus`) changes, applied in manifest order                                                                            |
| `tree-sitter-<lang>.wasm` | The built grammar. Shipped in the npm package and loaded by the language module                                                                                   |
| `LICENSE`                 | The upstream licence, copied from the pinned commit                                                                                                               |

`build.mjs` rebuilds a grammar from those inputs (`node grammars/build.mjs go`
checks; `--write` replaces). It is a maintainer tool: `npm ci`, `npm test` and
the package install never run it, and no install hook exists.
`test/grammar-vendored.test.mjs` checks every manifest against its `.wasm`
(sha256, ABI, licence, patch files). Step-by-step rebuild and update:
`docs/changes/W2-S.md`.

## go

Upstream `tree-sitter-go` v0.25.0 (`1547678a9da59885853f5f5cc8a99cc203fa2e2c`,
MIT) plus:

1. [PR #202](https://github.com/tree-sitter/tree-sitter-go/pull/202) at
   `e97394289ad02c28ca4c60ad1ed2673b9cb90661`: `new` takes an expression
   (Go 1.26), with the type reading preferred. This also lets calls of
   user-declared `new`/`make` with value arguments parse.
2. [PR #198](https://github.com/tree-sitter/tree-sitter-go/pull/198) at
   `2a37d91d26d36a2709c3d0dbcfa9ba79f9e58a87`: methods with their own type
   parameters (Go 1.27).

Not taken: PR #190, which changes the tree of 1,785 files that already parse
(W2-P). Built with tree-sitter CLI 0.27.2, wasi-sdk 34.0 and binaryen
version_132. Three builds from these inputs gave the same bytes: W2-P's scratch build, this chunk's `--write` build and the verify run in `evidence/w2-s/build-verify.txt`.

## rust

Upstream `tree-sitter-rust` v0.24.2 (`77a3747266f4d621d0757825e6b11edcbf991ca5`,
MIT; a GitHub release only, not on npm) plus, in order:

1. [PR #319](https://github.com/tree-sitter/tree-sitter-rust/pull/319) at
   `70157d40a8e148ca547fd08f34826e7ba3a98958`: attributes (`#[cfg]`) on
   struct-pattern fields.
2. [PR #271](https://github.com/tree-sitter/tree-sitter-rust/pull/271) at
   `1660fa6c950ed3f6d56210c56627b7fdf67fadc0`: a where clause on a unit
   struct.
3. [PR #317](https://github.com/tree-sitter/tree-sitter-rust/pull/317) at
   `1bf4964e4afa48e53e848a285a6b0c89fd23ad01`: `~` in macro token trees.
4. [PR #312](https://github.com/tree-sitter/tree-sitter-rust/pull/312) at
   `1d3d5d6df51d5edfac3bdd3178433eb0aa437ea5`: `<=` after a cast to a named
   type.
5. [PR #283](https://github.com/tree-sitter/tree-sitter-rust/pull/283) at
   `bb723fa5db73847d77d33891db2e51fb4baea5a2`: `_` in unicode escapes.
6. [PR #281](https://github.com/tree-sitter/tree-sitter-rust/pull/281) at
   `7d6fe656932a6f0f27bdc92ea80c075585a00943`: foreign `type X;` in extern
   blocks.

v0.24.2 itself already reads `&raw` on a variable named `raw` and
`unsafe extern` blocks. Not taken: PR #256, which makes `safe` a reserved
word (29 registry files with a parameter, field or macro named `safe` break),
and PR #297, which breaks `macro_rules` used as an identifier (W2-P). Built
with the same tools as Go. The `--write` build here and W2-P's scratch build
of the same inputs gave the same bytes, and `evidence/w2-v/build-verify.txt`
records a third.
