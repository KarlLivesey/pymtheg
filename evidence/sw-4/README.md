# One coverage sweep of main

[Coverage plan](../../docs/coverage-plan.md) · [Attempts, wall time and peak memory](attempts.md) · [Support item changes](items.md)

`coverage-plan-input.json.gz` records the measured main commit, local build
digest and Node version. It has one row per attempted pin per mode. For
finished pins it includes the exact counts of all links, Level 2 links,
and Level 2 links marked with an assumption, by source language. The
inventory lists every below-Level-2 combination of language, kind, stored
outcome and ordered reasons, with its link count. It reconciles to the score
for every pin and language. For each reason, the archive retains up to two
examples on distinct source lines per pin. The [0.1.0 release breakdown](../sw-3/breakdown.json.gz)
is the historical comparison.

An attempt finishes when the cold index, warm index and sweep queries all
return usable responses. A CLI `incomplete` graph can finish with individual
failed files. An attempt that cannot finish has no counts. Its elapsed time,
recorded peak memory and failure stage are still reported. Peak is the largest
peak reported for a stage. Raw stage output and databases stay in scratch.
The deadline includes the checkout and, where requested, installation.
Large pins have over 300,000 tracked lines across the supported extensions
in the [released sweep's inventory](../sw-1/results.json) of the same commits.

Installed attempts use the lockfile's package manager with lifecycle scripts
off and index without network access. The Go opt-in uses the pinned server
toolchain and its existing module cache. Go module downloads, telemetry and
cgo are off. The attempt report includes the route's clean-package counts,
since some packages can lack cached dependencies. Unusable alternate
attempts retain any graph observed in bare mode.

## Source review

Each language draws 150 of its missing **bare** links, including links in
other languages' pins. The unit of sampling is one stored graph link.
Each first-reason group receives its proportion of the 150 draws rounded
down, with the remaining draws assigned by largest remainder. Ties prefer
the lexically earlier reason. Within a group, pick the lowest SHA-256 ranks
over the fixed seed, repository ID, commit and stored link ID. The seed
and the resulting ranks are in the archive. This counts separate stored
links even if they share a source line. The alternate modes have exact
inventories and are outside this sample's population.

The archive publishes each selected file, line and column, stored kind,
target spelling, reason list, source line excerpt and source-review label.
`source-review.tsv` holds the hand-entered labels by rank. The note gives
the source evidence and the immediate cause. `staticAnswer` says `bare`
when captured source and shipped language data could establish a declaration,
`outside` when doing so needs a dependency, generated file or toolchain,
`none` when there is no single static Level 2 target, and `unknown` when
the source review cannot establish which applies. `itemAnswer` says whether
addressing the first-reason support item would provide a definite link.
Use `unknown` where that depends on facts the reviewer could not establish.

Per-item point ranges use 95% Wilson bounds for the reviewed share that
could become definite, with unknown labels counted at both extremes.
An unsampled reason has the range from zero through its exact count.
Points divide the estimated gain by all bare links in that language and
include possible gains that require outside material.
Item ranges are marginal and should not be added together. The audit's
language-wide shares weight each group by its exact link count. The bounds
use a stratified Hoeffding interval, with the error budget shared across
the three estimates, and include the full uncertainty of unsampled and
unknown links. The bare ceiling subtracts the estimated share of total
links that have no static answer or require outside material. These
intervals describe uncertainty in a draw from the finished graphs. They
do not cover new links from unfinished pins or future indexers.

## Reproduce the archive

Use the measured main build with the SW-4 sweep scripts. From the dev-server
sweep tree, export the raw receipts and read the sampled source. No product
tests run in the corpus checkouts.

The first parent of the SW-4 merge commit contains the exact runner and
product source used for this sweep. A later change on main added a Nest
installation option that was absent from the recorded run.

```sh
node scripts/sweep/run-refresh.mjs
node scripts/sweep/refresh-evidence.mjs export
node scripts/sweep/refresh-evidence.mjs draw --module rust
node scripts/sweep/refresh-evidence.mjs context --module rust --from 1 --limit 10
node scripts/sweep/refresh-evidence.mjs assemble --commit MEASURED_SHA \
  --labels evidence/sw-4/source-review.tsv --output "$PYM_SCRATCH/coverage-plan-input.json.gz"
```
