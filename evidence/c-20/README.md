# C-20 installed TypeScript declarations evidence

The paired set is the 18 completed TypeScript pins selected by
`evidence/c-16/pins.mjs`. Run the main and C-20 builds without an install,
then run C-20 with `scripts/sweep/run.mjs --installed` on the same manifest.
Store the main and C-20 bare results as `main-run.json` and `bare-run.json`.
The analysis uses the pinned TypeScript 5.9.3 compiler on Node 24.

`reindex.mjs` recovers a cold graph after an interrupted attempt without
reinstalling the packages. It moves the interrupted store out of the checkout
and checks the new cold receipt against a read-only status query. The result
identifies the interrupted stage and the status-only follow-up.
An optional build directory name and worker count reindex the retained
installed checkouts with that build and record its digest.

`overlay.mjs BARE INSTALLED-OVERLAY ATTEMPTS…` retains the bare result for
any pin with an unavailable installed graph. It also writes an `-attempts`
file with the install outcomes. Compare the resulting graph stores using
these commands from the repository root.

```sh
PYM_COMPARE_ALL_LINKS=1 C16_CANDIDATE=bare node evidence/c-16/compare.mjs SCRATCH --candidate
PYM_COMPARE_CANDIDATES=1 PYM_COMPARE_SEED=pymtheg-c20-2026 C16_BASELINE=bare C16_CANDIDATE=installed node evidence/c-16/compare.mjs SCRATCH --candidate
```

The bare comparison checks outcomes, stable checkout target keys, library
targets, candidate keys, and link data. The installed comparison keeps the
same site identities and separately accounts for sites that changed or
disappeared. `report.mjs BARE-COMPARISON INSTALLED-COMPARISON ATTEMPTS
CHANGES.gz` renders the tables and writes the complete inventory of changed
definite destinations, with source offsets and before/after targets.

`audit.mjs SCRATCH INSTALLED-COMPARISON` ranks new installed targets with
the fixed comparison seed. It takes one eligible site per pin before taking
a second and reads declaration candidates from the resolver's recorded
inputs. The audit checks the pinned use and the installed declaration.

`cost.mjs SCRATCH BARE-RUN INSTALLED-ATTEMPTS PINS…` brackets the cold
candidate observations with main runs on the same memory-backed storage.
Each starts with a fresh graph store. The script restores the sweep stores
after measuring elapsed seconds, CPU seconds, and peak RSS.

Export the bare and installed attempts with `coverage-export.mjs` and the
SW-3 reference samples. `plan.mjs BARE-EXPORT INSTALLED-EXPORT OUTPUT.gz`
overlays the bare TypeScript graphs on C-16's cumulative archive and embeds
the installed results for the paired plan figure. Use `coverage.mjs --base
evidence/sw-3/breakdown.json.gz` and `evidence/c-11/plan.mjs` to replace the
TypeScript section alone.
