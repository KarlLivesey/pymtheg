# C-23 installed TypeScript evidence

Select the 18 completed TypeScript pins with `evidence/c-16/pins.mjs`.
Build current main and the candidate in separate dev-server artifact
directories. Run both with `scripts/sweep/run.mjs --local-build` and
`--installed`. Retain raw receipts and graph stores in disk-backed scratch.
Nest is measured once on main with its documented install flag before
comparing the analyzer change. Earlier archived C-20 figures retain its
bare graph. The paired score uses bare figures when installations are
unavailable.

`census.mjs SCRATCH RECEIPT PREFIX` groups all installed misses by pin,
link kind and stored reason and draws 200 sites at seed
`pymtheg-c23-2026`. `checker.mjs SCRATCH RECEIPT BUILD DRAW` runs the pinned
TypeScript checker over owning configs and captured declarations. The sample
archive keeps the source review alongside each raw answer. The four
targeted witnesses have their own draw label.

Compare with `evidence/c-16/compare.mjs`. Use
`PYM_COMPARE_ALL_LINKS=1` on the designated bare pins to compare every
site with its checkout and library targets, candidates, and link data.
Use `PYM_COMPARE_CANDIDATES=1 PYM_COMPARE_SEED=pymtheg-c23-gains-2026`
for matched installed pins. `report.mjs SCRATCH COMPARISON ATTEMPTS PREFIX`
writes exact transition inventories and draws new definite targets. It
round-robins pins ordered by the best hash, then draws within each pin in
hash order. Use `checker.mjs` and the actual declaration files to verify
the draw. `withdrawals.mjs SCRATCH BASELINE CANDIDATE` checks each of the
5,098 C-20 withdrawal sites before and after.

`same-install.mjs SCRATCH RECEIPT PIN BUILD` replays the cold and warm
indices on a retained install and saves the replay graph separately from
the original sweep store. The tRPC controls retain the ordinary sweep result
and identify which changes persist with the same installed inputs.
[Control counts](trpc-control.json)

`cost.mjs SCRATCH RECEIPT PINS…` runs three cold indices on each retained
installed checkout, with main before and after the candidate. It restores
the original sweep store when complete. The same Linux network isolation
applies to the cost replay and installed sweep.

Export the installed attempts with `scripts/sweep/coverage-export.mjs`
using the SW-3 reference samples. `plan-input.mjs INSTALLED-EXPORT INPUT.gz`
builds the cumulative input with C-20's
verified bare input and replaces the nested installed export with this run.
Regenerate the plan with `scripts/sweep/coverage.mjs` and
`evidence/c-11/plan.mjs`. The Go and Rust sections are taken verbatim from main.

## PR 30 review replay

Build the original PR head and the review candidate separately. Replay all
18 pins with `--installed`, plus the candidate's bare sweep. Confirm the
bare outcomes against main with `PYM_COMPARE_ALL_LINKS=1` on Dexie, Zustand
and Yargs. Compare both installed builds with the same setting to check
checkout keys, sites and outcomes by link.

`review-identity.mjs SCRATCH PRIOR CANDIDATE PREFIX [PIN…]` compares every
named library target at its stored site and reports which prior names acquired
package-relative declaration paths. It draws up to 60 changed sites by pin at
seed `pymtheg-c23-qualified-2026` for review with `checker.mjs` and the
installed declaration files. `review-volar.mjs SCRATCH RECEIPT BASELINE
CANDIDATE` asks `graph uses` about both members and their old shared name in a
small checkout using Astro's installed Volar declarations.
