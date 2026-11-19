# C-18 Rust macro identity evidence

The measurement uses the same 18 finished Rust pins as C-12. The paired
sweep runs the standard runner with each graph's C-12 project identity.
The cold-only option skips warm indexing and queries for the paired
coverage runs. Use the same public pin manifest for both builds.
[Change note](../../docs/changes/C-18.md) · [Sweep guide](../../sweep/README.md)

```sh
PYM_PAIR_COLD_ONLY=1 node evidence/c-18/paired-sweep.mjs \
  "$scratch" "$c12_results" "$c12_work" \
  --scratch "$work" --manifest "$pins" --local-build "$build" \
  --output "$results" --parallel 3
```

Run `check-warm.mjs` on the candidate's stores to generate the warm CLI
totals checked by the standard coverage exporter. It also compares those
totals with the cold CLI response. [Warm index check](check-warm.mjs)

The database comparison matches every Rust link's file, kind, origin,
span, spelling and source key. It checks definite target equivalence,
assumption marks, receiver decisions, and the inventory and identity of
Rust symbols. Set `PYM_COMPARISON_SEED=c18-identity-2026-11-19` and
`--all-samples` on the
C-12 comparison script for the C-18 audit. The audit draw ranks pins
with enough eligible links by that seed, then takes the lowest five
proved and five assumption-backed link ranks in each of the first six
pins. [Database comparison](../c-12/compare.mjs)
[Audit draw](draw.mjs)

### Review attribution

For the availability-gated review attribution, copy the build from
`826af3b` to scratch and run
`node evidence/c-18/review-withdrawals.mjs --relax-provenance "$copy"`.
Index the affected pins with that copy, keeping its release,
namespace and export-availability checks. Pass the C-12, original PR,
corrected PR and provenance-relaxed result/work-directory pairs to the
same script. Pass `--affected` with the first three pairs to identify the
pins that need a control. A lost Level 2 link that returns in the
control is attributed to provenance. A link still missing is attributed to availability,
including exports whose presence cannot be established. The attribution
uses availability first when both guards can withhold a site. The
coverage plan uses the final build with the compiling-code rule.
[Review attribution script](review-withdrawals.mjs)

### Opacity census and cost

Run the opacity census on each graph set with its matching build. Set
`PYM_MACRO_CENSUS_SEED=c18-identity-2026-11-19` to keep the 50 lowest-ranked
rows from each of A, B and F in the census output. The same option tallies
replayed links with no named blocker by their stored diagnostic, and links
from derived facts by their origin. [Census script](../c-12/remaining.mjs)

The cold-cost script indexes fresh graph stores in a single memory-backed
directory and uses `/usr/bin/time` to record user CPU, system CPU, elapsed
seconds and peak RSS. The two C-12 controls bracket the C-18 run for each
pin. [Cold-cost script](cold-cost.mjs)
