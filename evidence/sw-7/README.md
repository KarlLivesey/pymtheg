# SW-7 What microsoft/TypeScript does to the TypeScript figure

Measurement only: no product code and no coverage-rule change. The question
is how a 20th installed TypeScript pin, microsoft/TypeScript, would move
the headline, so that a ruling can say how such a pin should count.

## How it was measured

- **Build.** The pin reaches the 60-minute limit on main (SW-6). PR 51
  (branch `c-40-streamed-module-results`, head `a95a346`, not merged) lets it
  finish at Node's default heap. The index was run with a build of that
  head. **The scripts here run on main**, but the index they read needs
  PR 51's build. This branch is therefore based on `origin/main`, and
  `run.sh` has to be run from a checkout of PR 51's head.
- **Policy.** One installed attempt of `microsoft/TypeScript` at pin
  `21ba970`, with the SW-5 runner and policy (`scripts/sweep/run.mjs
  --installed`): frozen lockfile, lifecycle scripts off, no network while
  indexing. It ran alone, with a 90-minute budget instead of 60.
- **Outcome.** The cold index finished in 4,918 s, peaking at 5.4 GB:
  32,448 files, 274,386 symbols, 993,013 links, 12,477 failed files, the
  figures PR 51 reports.
  - Its status is `incomplete` (exit 2) because files failed, as for any pin
    with failed files.
  - The sweep's query stage then ran past the budget, so the run records
    `wall-limit` (`sweep-sw7.json` on the server) and the pin has no
    finished receipt.
  - The figures below are read from the stored graph directly
    (`score.mjs --any-outcome`), with the same identity rule SW-6's
    `pinscore.mjs` uses.
  - The server was heavily loaded (load 20–28), so the 4,918 s against PR
    51's 35 minutes is an observation.
- **The pin is the Go port.** At `21ba970` the compiler is Go, under
  `tsc/`. Of the 993,013 links, 485,580 are Go and **507,433 are
  TypeScript**. Only those count in the TypeScript figure. Most of them are
  the compiler's TypeScript test corpus, under `tsc/testdata/`.
- **The 19 other pins** are SW-6's. `score.mjs` run on the C-41 baseline
  sweep (main `5d97762`, whose TypeScript links equal SW-6's) reproduces
  SW-6 exactly: 1,238,834 Level 2 of 1,444,057 links, and 24,303 library
  module links ([pins-19.json](pins-19.json)).

## microsoft/TypeScript by the coverage rules on main

| | Links | Share |
| --- | ---: | ---: |
| TypeScript links | 507,433 | |
| Level 2 | 358,385 | 70.63% |
| proven (no assumption) | 208,527 | 41.09% |
| assumption-marked | 149,858 | 29.53% |
| of which `no-unseen-declarations` (C-13: computed by a program that contains an unread file) | 149,852 | 29.53% |
| D20 library module links | 251 | 0.05% |
| Below Level 2 and not a library module link | 148,797 | 29.32% |

### Remaining groups by first blocker

| First stored blocker | Links | Points of the pin | Largest areas |
| --- | ---: | ---: | --- |
| `taint-budget-exhausted` | 138,422 | 27.28 | tsc/testdata/tests 102,103, tsc/internal/bundled 22,718, tsc/testdata/baselines 10,801 |
| `invalid-code` | 4,646 | 0.92 | tsc/testdata/tests 3,210, tsc/testdata/baselines 1,052, root files 195 |
| `local` | 2,616 | 0.52 | tsc/testdata/fixtures 1,782, packages/typescript/test 395, packages/typescript/src 362 |
| `(candidate set)` | 2,595 | 0.51 | tsc/testdata/fixtures 1,963, packages 310, packages/typescript/src 237 |
| `missing-module` | 127 | 0.03 | tsc/testdata/fixtures 123, tools 4 |
| `no-symbol` | 97 | 0.02 | tsc/testdata/fixtures 72, packages/typescript/test 21 |
| `external` | 94 | 0.02 | tools 28, tsc/testdata/fixtures 24, packages/typescript/test 23 |
| `any-receiver` | 72 | 0.01 | tsc/testdata/fixtures 56, packages/typescript/test 12 |
| `ambiguous-project` | 41 | 0.01 | packages 41 |
| `library-member-written` | 35 | 0.01 | tsc/testdata/fixtures 28 |
| `workspace-build-output-missing` | 26 | 0.01 | packages/typescript/test 26 |
| `external-package` | 17 | 0.00 | tsc/testdata/fixtures 17 |
| others (`(unit only)`, `(no reason)`, `computed-specifier`, `object-producer-unverified`) | 9 | 0.00 | |

`taint-budget-exhausted` is the failed-file walk (C-13) giving up. The
programs that read the test corpus contain thousands of failed files, so the
walk that would clear a link of an unread declaration runs out of budget.
93% of what is below Level 2 is that one cause.

### Test corpus against the TypeScript-written source

| Area | Links | Level 2 | Share | Assumption-marked | Library module links |
| --- | ---: | ---: | ---: | ---: | ---: |
| tsc/testdata/tests (compiler, conformance and fourslash test inputs) | 212,896 | 107,583 | 50.53% | 107,583 | 0 |
| tsc/testdata/fixtures (test fixtures) | 145,956 | 141,607 | 97.02% | 82 | 2 |
| tsc/testdata/baselines (expected-output baselines) | 33,795 | 21,942 | 64.93% | 21,942 | 0 |
| tsc/internal/bundled (the bundled lib `.d.ts` files) | 41,972 | 19,253 | 45.87% | 19,253 | 0 |
| packages/typescript/src (the TypeScript-written package source) | 33,115 | 32,489 | 98.11% | 0 | 7 |
| packages/typescript/test | 19,548 | 18,936 | 96.87% | 6 | 115 |
| packages (other: vscode-typescript, vendor, enums, scripts, lib) | 9,875 | 8,052 | 81.54% | 673 | 50 |
| tools (build and release scripts) | 8,634 | 8,249 | 95.54% | 45 | 77 |
| root files (`Herebyfile.mjs`) | 1,502 | 255 | 16.98% | 255 | 0 |
| tsc (other TypeScript beside the Go compiler) | 140 | 19 | 13.57% | 19 | 0 |

- **The test corpus** (`tsc/testdata`) holds 392,647 links, 77.4% of the
  pin. 271,132 of them are Level 2.
- **The compiler's own source is Go,** so none of it counts here.
- **The rest** is 114,786 links: the bundled lib declarations, `packages/`,
  `tools/` and the root files. Among it, `packages/typescript/src`
  reaches 98.11%, all proven.

### The 12,477 failed files

| Area | Failed files |
| --- | ---: |
| tsc/testdata/baselines | 11,209 |
| tsc/testdata/tests | 1,189 |
| tsc/testdata/fixtures | 79 |

- **Are failed files counted?** No. A failed file stores no links (0 here,
  checked), so it is in neither the numerator nor the denominator. The
  sweep reports it on its own, as failed files and lines (`failedSources`
  by family in the coverage export). Its effect on the figure is
  indirect, through the other links:
  - 288,274 links (57% of the pin) were computed by a program that contains
    an unread file, and carry `no-unseen-declarations`. 149,852 of them are
    Level 2 and count as assumption-marked.
  - 138,422 are withheld, because the failed-file walk exhausted its budget.
- **Why they failed.** 4,068 failed otherwise, almost all with their own
  syntax errors. These are deliberate negative tests, and baseline files
  that concatenate a source and its emitted output. 8,409 (8,362 of them baseline `.js` files)
  carry the indexer's placeholder "Awaiting project analysis": the
  TypeScript module returned no result for them, and reported no
  analysis error.
  - The placeholder is written when an analysing module returns no result
    for a file (`indexer.ts`, `failure("Awaiting project analysis")`).
  - These are probably `.js` files no program loads.
  - Whether that is PR 51's streaming or older behaviour was not checked
    here; it is worth checking before PR 51 merges.
- Three files failed on encoding (UTF-16 and invalid UTF-8 tests), reported
  in `errors`.

## The headline for 20 pins

Today's rule (D19) is link-weighted. The mean of per-pin percentages weighs
each pin once. "With library module links" adds D20's.

| Pins | Links | Link-weighted Level 2 | with library module links | proven only | Mean of per-pin Level 2 | with library module links | proven only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 19 pins (SW-6's) | 1,444,057 | 85.79% | 87.47% | 81.72% | 81.65% | 83.17% | 78.25% |
| microsoft/TypeScript alone | 507,433 | 70.63% | 70.68% | 41.09% | 70.63% | 70.68% | 41.09% |
| **20 pins** | 1,951,490 | **81.85%** | **83.10%** | 71.16% | **81.10%** | **82.54%** | 76.40% |
| microsoft/TypeScript without tsc/testdata | 114,786 | 76.01% | 76.23% | 58.37% | 76.01% | 76.23% | 58.37% |
| 20 pins, microsoft/TypeScript without tsc/testdata | 1,558,843 | 85.07% | 86.64% | 80.00% | 81.37% | 82.82% | 77.26% |

Link-weighted, the pin carries 26% of the 20-pin links. It moves the
headline from 85.79% to 81.85% (−3.94 points), and its proven share from
81.72% to 71.16%. As a mean of per-pin percentages it moves the headline
from 81.65% to 81.10% (−0.55). Without its test corpus it would move the
link-weighted headline to 85.07% (−0.72).

## Files

- `pin.json`: the one-pin manifest (from `sweep/repos.json`).
- `run.sh`: the installed attempt; run from a checkout of PR 51's head (see
  above).
- `score.mjs`: per pin, links, Level 2, assumption-marked Level 2 and D20
  library module links, using the coverage rules on main.
  - `--detail PIN` adds, for that pin:
    - the first blockers below Level 2;
    - the figures by area;
    - the failed files by area and diagnostic;
    - the `no-unseen-declarations` links;
    - the assumed links by assumption.
  - `--any-outcome` reads an attempt the sweep did not record as finished.
- `headline.mjs`: the 20-pin table above.
- `pins-19.json`, `typescript-pin.json`, `headline.md`: the outputs.

## Reproduce

On the dev server:

```sh
# from a checkout of PR 51's head, with this folder copied in:
bash evidence/sw-7/run.sh
# from main:
SWEEP_SCRATCH=<scratch>/sw node evidence/sw-7/score.mjs <scratch>/sweep-sw7.json typescript-pin.json \
  --detail microsoft/TypeScript --any-outcome
SWEEP_SCRATCH=<baseline scratch>/sw node evidence/sw-7/score.mjs <baseline scratch>/sweep-diag.json pins-19.json
node evidence/sw-7/headline.mjs pins-19.json typescript-pin.json headline.md
```
