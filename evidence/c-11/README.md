# C-11 TypeScript and JavaScript library targets

The evidence uses the pinned TypeScript and JavaScript corpus and the
dev server's Node 24 toolchain. The sweep runs each published checkout
without dependency installation, then repeats the index and queries the
store. The score uses all stored TypeScript-module link kinds. A library
target with a symbol earns Level 2. A unit alone earns Level 1.

[Change note](../../docs/changes/C-11.md) · [Pinned source audit](audit.md)

## How to reproduce

Build the `main` comparison revision and pack it into `main.tgz` under
`PYM_SCRATCH`. The candidate uses the installed build directory on the dev
server. Run `evidence/c-11/run.mjs` with `release`, `main` and `candidate`.
The runner reuses completed attempts for the same artifact. Use
`release-export candidate`, `main-export candidate`, `candidate-export release`
and `candidate-export main candidate-main` to export both directions of the
shared-site comparison. `metrics.mjs` reads those four exports.

`compare.mjs` checks symbol keys and existing link sites in the specified
repositories, and compares every resolved checkout destination by its file
and symbol key. `sample.mjs candidate REPO …` draws eight distinct library
symbol sites per repository. `uses.mjs` runs the CLI against completed
candidate graphs and checks its exact class counts against the recorded
targets. `own-code.mjs` indexes the T3 Code `b387e3a1` pin with its `.repos`
directory excluded, as in C-2.

`plan.mjs` overlays the new TypeScript runs on the prior evidence. Feed its
archive to `scripts/sweep/coverage.mjs --base evidence/sw-3/breakdown.json.gz`
to generate the coverage plan block.
