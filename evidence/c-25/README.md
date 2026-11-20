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

For the review's unbundled-entry study, copy the compiled candidate in
scratch. Run `bundler-probe.mjs SCRATCH CHECKOUT BUILD HONO_TARBALL` on the
copy, supplying Hono's pinned checkout and registry archive. It parses the
pack configuration as syntax and verifies the archive checksum. It limits
the experimental lookup to declaration paths in the published build.
Reindex only Hono with the copy and compare against the plain-build
candidate. Use `emit-check.mjs` and the archive's declarations to inspect
the drawn destinations. The committed production analyzer uses no
experimental lookup.

`source-budget.mjs SCRATCH RECEIPT` adds up the bytes of tracked TypeScript
and JavaScript files. This upper bound also covers workspace source
imports inside a single program.

For the recorded-assumption census, `compare.mjs` reports the Level 2
count carrying `ts-unbuilt-entry-is-compiler-emit`. Draw all marked-entry
sites from the initial PR artifact and from the assumption artifact with
the same seed and a limit above the population. Run
`assumption-exclusions.mjs SCRATCH BUILD RECEIPT OLD_DRAW MARKED_DRAW`
against the candidate's snapshot. It joins the original sites to the
marked sites and reads the candidate's captured build guards to assign
exclusions. Use the seeded 60-site installed draw with `emit-check.mjs`
for the audit.

`built-targets.mjs SCRATCH INSTALLED_RECEIPT` counts checkout destinations
at compiler output paths, destinations whose path matches Git ignore
rules, and declaration destinations with a same-checkout map. The emit
paths come from captured tsconfig and jsconfig inputs. These counts cover
checkout targets. Installed library rows lack a checkout destination.
