# C-11 TypeScript and JavaScript library targets

The sweep cohort is the 18 TypeScript pins that returned a graph in
release 0.1.0. The sweep uses the dev server's Node 24 toolchain. It runs
each published checkout without dependency installation, then repeats the
index and queries the store. The score uses all stored TypeScript-module link
kinds. A library target with a symbol earns Level 2. A unit alone earns Level 1.

[Change note](../../docs/changes/C-11.md) · [Pinned source audit](audit.md) · [Coverage comparison](coverage.md) · [Cold indexing and heap](resources.md)

The current plan input contains nine completed C-11 graphs. [Plan input](coverage-plan-input.json.gz)

The 0.1.0 replay reproduced the archived SW-3 TypeScript and JavaScript
coverage counts on each of the 18 released pins.

## Library queries

Each query used a result bound of two. The full class counts matched the
stored targets. Astro and T3 Code returned their incomplete-source status
alongside the counts.

| Repository | Command | Library | Candidate sets |
| --- | --- | ---: | ---: |
| Astro | `graph uses zod` | 1,227 | 0 |
| Astro | `graph uses fs readFileSync` | 106 | 0 |
| Hono | `graph uses dom ParentNode.prototype.querySelector` | 138 | 0 |
| T3 Code | `graph uses es Map.prototype.delete` | 84 | 0 |

## How to reproduce

Build `main` at `6b3cdf24687fb30d27c31dde62ec0d4dc4ac38b8` and pack it into `main.tgz` under
`PYM_SCRATCH`. The candidate uses the installed build directory on the dev
server. Run `evidence/c-11/run.mjs` with `release`, `main` and `candidate`.
The runner reuses completed attempts for the same artifact. Use
`release-export candidate`, `main-export candidate`, `candidate-export release`
and `candidate-export main candidate-main` to export both directions of the
shared-site comparison. `metrics.mjs` reads those four exports.

`compare.mjs candidate REPO …` checks symbol keys and existing link sites in the specified
repositories, and compares every resolved checkout destination by its file
and symbol key. `sample.mjs candidate REPO …` draws eight distinct library
symbol sites per repository. `uses.mjs` runs the CLI against completed
candidate graphs and checks its exact class counts against the recorded
targets. `own-code.mjs` indexes the T3 Code `b387e3a1` pin with its `.repos`
directory excluded, as in C-2.

`verify.mjs` builds and runs the checks in a scratch copy so the sweep keeps
the same executable. `bench.mjs` uses the C-7 cold runner to index each
selected pin with main, C-11 and main again on the same source copy.

The full suite exposed an unreadable workspace-manifest case. The fixed
module passes both workspace-manifest regression cases. The nine measured
graphs use the earlier candidate executable. `workspace-audit.mjs` ran the
fixed workspace reader over their captured contexts and found zero readable
TypeScript or JavaScript files under an affected root. The only unreadable
manifest in these nine stores is yargs's broken-JSON fixture.

`plan.mjs` overlays the new TypeScript runs on the exact inputs used for
main's coverage plan. Run `scripts/sweep/coverage.mjs` with its
`c11-plan-input.json.gz` as `--results` and `c11-plan-base.json.gz` as `--base`
to regenerate the coverage plan block. Compare the measured pins with the
release using `--base evidence/sw-3/breakdown.json.gz`.
