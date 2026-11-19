# C-11 TypeScript and JavaScript library targets

The review fixes and the self-index measurements are recorded separately.
[First review evidence](review-1.md)

The sweep cohort is the 18 TypeScript pins that returned a graph in
release 0.1.0. The sweep uses the dev server's Node 24 toolchain. It runs
each published checkout without dependency installation, then repeats the
index and queries the store. The score uses all stored TypeScript-module link
kinds. A library target with a symbol earns Level 2. A unit alone earns Level 1.

[Change note](../../docs/changes/C-11.md) · [Pinned source audit](audit.md) · [Coverage comparison](coverage.md) · [Cold indexing and heap](resources.md)

The plan input contains the coverage export for all 18 completed C-11 graphs.
The 0.1.0 replay
reproduced the archived SW-3 TypeScript and JavaScript coverage counts on
each pin. [Plan input](coverage-plan-input.json.gz)

## Build provenance

All 18 final review graphs use the module 28 build with digest
`416b5f81027c76a32e848116575a4b42d58f8710eb93fbc44db4fc61ddc550df`.
The six exact checkout comparisons use main at `595ec7b`.

The first sweep build had digest
`015c000df99defbd55bf03ffea9fb9e7da306e07b9629f5ddc8c6fe736173274`.
`workspace-audit.mjs` checked every captured workspace context against the
two subsequent package-boundary fixes. Seventeen pins and the T3 Code
own-code checkout have no readable files at affected roots and no linked
checkout `@types/*` packages. Vite's unreadable UTF-8 BOM fixture can
hide a workspace member. Its graph was replaced by a replay with both
fixes and build digest
`04428ad0d1030316914504c305d0216796e7195a421f30c5d2e34bc77a932350`.
The final source draw reproduced all 40 hand-checked targets.

## Library queries

Each query used a result bound of two. The full class counts matched the
stored targets. The first five queries returned their incomplete-source
status alongside the counts. Hono returned `ok`.

| Repository | Command | Library | Candidate sets |
| --- | --- | ---: | ---: |
| tRPC | `graph uses zod` | 1,648 | 0 |
| Vitest | `graph uses fs readFileSync` | 236 | 0 |
| Excalidraw | `graph uses dom ParentNode.prototype.querySelector` | 199 | 0 |
| T3 Code | `graph uses es Map.prototype.delete` | 84 | 0 |
| Vitest | `graph uses url` | 334 | 6 |
| Hono | `graph uses @std/assert` | 65 | 0 |

## Validation

The dev-server build, no-emit check and format check passed. On tmpfs,
`npm test` passed all 3,041 tests, including repository initialization.
All 18 sweep-tool tests passed. The [self-index bracket](review-1.md)
also records isolated measurements for the repository initialization test.

## How to reproduce

Build main at `595ec7b` under `PYM_SCRATCH` and set `C11_MAIN_BUILD` to
that directory's name. Set `C11_BUILD` to the built candidate directory's
name. Run `evidence/c-11/run.mjs` with `release`, `main` and `candidate`.
The runner reuses completed attempts for the same artifact. Use
`release-export candidate`, `main-export candidate`, `candidate-export release`
and `candidate-export main candidate-main` to export both directions of the
shared-site comparison. `metrics.mjs` reads those four exports.
Save the module 27 run as `review1-run.json` before replaying module 28.
`review-transitions.mjs review1 candidate` compares the stored outcomes on
the same source spans.

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

`plan.mjs` overlays the new TypeScript runs on the retained C-7 input.
Run `scripts/sweep/coverage.mjs` with its `c11-plan-input.json.gz` as
`--results` and `c11-plan-base.json.gz` as `--base` to generate a plan.
Pass the generated plan and `docs/coverage-plan.md` to `plan.mjs` to copy
the TypeScript / JS section. Use `--base evidence/sw-3/breakdown.json.gz`
to compare the measured pins with the release.
