# C-11 TypeScript and JavaScript library targets

The measured cohort is the 18 TypeScript pins that returned a graph in
release 0.1.0. The sweep uses the dev server's Node 24 toolchain. It runs
each published checkout without dependency installation, then repeats the
index and queries the store. The score uses all stored TypeScript-module link
kinds. A library target with a symbol earns Level 2. A unit alone earns Level 1.

[Change note](../../docs/changes/C-11.md) · [Pinned source audit](audit.md)

## Confirmed corpus result

On the Hono pin, release 0.1.0 recorded Level 2 at 25,472 of 70,761 sites
(36.00%). C-11 records Level 2 at 45,897 of 72,340 sites (63.45%). On the
70,761 shared sites it records Level 2 at 44,318 (62.63%). Of the candidate's
links, 11,279 name a stored library symbol and 325 name a stored unit only.
The released measure gave symbol credit to 154 selections from untyped
imported values, including `vi.stubGlobal` and `qs.parse`. C-11 gives those
sites unit credit because the member declarations are unavailable.

These Hono queries use a result bound of two. The reported class counts are
independent of the result bound.

| Command | Library | Candidate sets |
| --- | ---: | ---: |
| `graph uses zod` | 31 | 0 |
| `graph uses fs readFileSync` | 7 | 0 |
| `graph uses dom ParentNode.prototype.querySelector` | 138 | 0 |
| `graph uses es Map.prototype.delete` | 1 | 0 |

## How to reproduce

Build `main` at `6b3cdf24687fb30d27c31dde62ec0d4dc4ac38b8` and pack it into `main.tgz` under
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

`verify.mjs` builds and runs the checks in a scratch copy so the sweep keeps
the same executable. `bench.mjs` uses the C-7 cold runner to index each
selected pin with main, C-11 and main again on the same source copy.

`plan.mjs` overlays the new TypeScript runs on the prior evidence. Feed its
archive to `scripts/sweep/coverage.mjs --base evidence/sw-3/breakdown.json.gz`
to generate the coverage plan block.
