# C-25 evidence

Use the 18 TypeScript pins selected by `evidence/c-16/pins.mjs`. Build main
and the candidate to separate artifact directories and keep the bare and
installed sweep receipts under disk-backed dev-server scratch. The installed
sweep uses lifecycle scripts off and disables network access during index.

`pair.mjs BARE INSTALLED OUTPUT` makes an 18-pin comparison receipt with the
bare attempt for pins without a usable installed graph. `compare.mjs SCRATCH
BEFORE AFTER PREFIX SEED SIZE [PIN…]` checks checkout keys, stored sites
and prior definite destinations. The Level 2 tables count all sites and
the shared sites. The seeded draw rotates through pins, in hash order within
each pin. It samples newly definite links with entry provenance.

`emit-check.mjs SCRATCH RECEIPT DRAW OUTPUT` runs the pinned TypeScript
compiler with the selected checkout config. It captures real emitted
declarations and their source files in memory. Reads are confined to the
checkout and the compiler's own library directory. It loads no build script
or plugin. It records when a compiler build could supply no matching output.

`convention-build.mjs BUILD` modifies a separate copy of the compiled
analyzer in scratch for the experiment. The candidate and packaged analyzer
keep their proof requirements. `replay.mjs SCRATCH RECEIPT BUILD RESULT
PARALLEL [--cold-only] [PIN…]` runs indexing on the same retained checkout
and installation, saves the experimental graph separately, and restores
the sweep store. The ordinary and experimental outputs keep separate
receipts. Use `--cold-only` to compare fresh tRPC stores independently of
the warm declaration-input replay.

Export the candidate's bare and installed experiments with
`scripts/sweep/coverage-export.mjs` and the SW-3 reference samples. Merge the
candidate TypeScript exports into the earlier cumulative input with
`plan-input.mjs BASE BARE INSTALLED OUTPUT.gz`. Run `coverage.mjs` with the
SW-3 baseline, then use `evidence/c-11/plan.mjs` to replace the generated
TypeScript section of the plan.

The compact audit archives list public checkout paths, source destinations,
compiler output names, and verdicts. The full declaration text stays in
scratch. The change archives preserve each old and new destination for
review, including unit-only links whose stored attribution changed.
