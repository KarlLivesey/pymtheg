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
version_132. Two independent builds gave the same bytes.
