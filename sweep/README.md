# SW-1 corpus sweep

This sweep asks whether the public npm release `pymtheg@0.1.0` can build and
query a graph for 60 public repositories. It measures coverage and records
failures. Link proportions describe the graph, without measuring its accuracy.

## Selection

The manifest records a hand-stratified sample chosen on 17 November 2026.
Start with widely used public projects with visible community adoption, then
choose for coverage within each language. Repository reputation was a
qualitative filter. Git's fetch protocol provides commit activity but no star
counts, so the sweep uses no numerical star cutoff or ranking. Use one GitHub
owner per language and retain 20 repositories in each language. The `category`
and `why` fields record why each project fills a slot.

For each candidate, resolve the public default branch with
`git ls-remote <url> HEAD`, shallow-fetch that SHA, and inspect the commit date
with `git show -s --format=%cs HEAD`. All selected projects had default-branch
activity within the preceding six months, and 56 had activity within the
preceding 30 days. The manifest retains those default-branch SHAs except for
T3 Code. The ordering starts the largest jobs first. The results sort by
repository ID.

Size means physical lines in regular tracked files of the selected language.
Enumerate files with `git ls-tree -rz --full-tree HEAD`. Include tests, checked-in
generated files and fixtures. TypeScript counts `.ts`, `.tsx`, `.mts`, and
`.cts`, Go counts `.go`, and Rust counts `.rs`. Count LF bytes and include a
final unterminated line. The small band is 5,000–49,999 lines, medium is
50,000–300,000, and large is over 300,000 through 1,000,000. The final mix is
small/medium/large 5/13/2 for TypeScript, 10/8/2 for Go and 8/10/2 for Rust.
The index sees the whole checkout, including graph-supported languages outside
that size calculation. The TypeScript compiler repository includes its Go
compiler port and large JavaScript fixture trees. Its 809,893 TypeScript lines
fit the large band, and the whole checkout is a mixed-language stress case.

The required `pingdotgg/t3code` default branch had 5.56 million TypeScript
lines. The sweep uses `v0.0.24`, the last stable tag in the size band before
`v0.0.25` crossed one million lines. This runs on the entire pinned checkout.
Prisma, Angular, k6, Biome and Zed also exceeded the size cap at their checked
commits. Dexie, NestJS, GitHub CLI, SWC and Alacritty cover storage, decorators,
CLI scale, compiler tooling and desktop UI within the bands. Smaller projects
such as yargs, Bubble Tea and cortex-m give separate evidence from the larger
monorepos.

## Run on the dev server

```sh
pymtheg-dev --name sw1 -- node --test scripts/sweep/run.test.mjs
pymtheg-dev --name sw1 -- node scripts/sweep/run.mjs --parallel 12
pymtheg-dev --name sw1 --no-sync -- bash -c 'cat "$PYM_SCRATCH/results.json"' > evidence/sw-1/results.json
```

Use a separate scratch folder for independent runs. The runner uses
`$PYM_SCRATCH` by default or `--scratch PATH`, and supports a subset manifest
with `--manifest PATH`. It uses Git, npm, GNU `time` and `timeout`, and
`prlimit` on the dev server. It installs the exact release from the public npm
registry once per scratch folder with `--ignore-scripts`. Each project gets
a fresh `git init`, shallow fetch, detached checkout and SHA verification.
The runner disables Git hooks and submodule fetches, runs the released CLI,
and uses Node 24's default heap. Go toolchain support is opt-in in the release.
`pymtheg init` creates fresh settings, the sweep leaves them at their defaults,
and the Go and Rust graphs use source only. The runner runs no corpus project
package managers, builds, tests or installation scripts. A checkout that
already has root Pymtheg storage needs review before it can enter the corpus.

Each project runs `init`, cold `graph index`, repeat `graph index`, then
`graph status`, `graph search init`, `graph callees` and `graph file`. The
queries use `--no-sync --limit 25`. The runner uses the first returned `init`
match from a file of the selected language, or uses the first tracked source
file for `graph file` if there was no such match. It runs `graph callees` only
when it has a symbol ID from `search`. Record the CLI's `resultCounts`, status
and truncation. An index exit of 2 with graph data means `incomplete`, so the
runner keeps the graph and attempts the warm index and queries.

The default per-repository allowance is 60 minutes across all commands
(`--wall-minutes`), with up to 10 seconds for shutdown. Time and peak RSS from
GNU `time` are observations. Per-repository peak is the largest single-stage
peak; cold and warm measurements are also recorded. A fatal memory diagnostic
is recorded separately from other process errors. A signal alone leaves its
cause unknown. Failed-file groups retain the file list and up to two original
diagnostics with positions when available. TypeScript module counts include
JavaScript. Separate tracked-file and line counts distinguish those languages.
The link denominator is every stored link kind, with `resolved` calculated as
total minus `ambiguous` and `unresolved`. A zero-link graph has no percentages.

The work directory under `$PYM_SCRATCH/work` holds checkouts and raw command
output for diagnosis. Completed attempts, including failures, get an atomic
record by repository ID and SHA. Rerun with the same scratch path to skip those
records and regenerate the aggregate. Use a new scratch folder for an independent
rerun of the same commits. Only the compact aggregate and report belong in Git.

The committed `evidence/sw-1/results.json` also contains two things the three
commands above do not reproduce on their own: a sampled memory high-water mark
for runs that were force-stopped, and a re-run of the callee query after a
harness mistake in the symbol reference was corrected.

## Coverage scoreboard

`coverage-export.mjs` opens each completed graph read-only and checks the
counts against its warm CLI result. The v2 archive keeps every stored
module, kind, outcome, reason and uncertainty combination. File scope,
audit disposition and library evidence are additional dimensions.

Level 2 means a resolved checkout link or a stored library unit plus a
symbol name. Level 1 adds sites that name only the library unit. Both
use every stored link in the finished graphs. The strict-inside column
excludes only proved outside targets. Raw uses the released graph's
resolved count. Completion is a separate checklist.

The scoreboard includes links with recorded assumptions in Level 2 when
they have a checkout target or a named library target. It also reports
the count of those links and Level 2 with them excluded from the numerator.
The optional last v2 breakdown column flags assumption-backed rows. Earlier
archives retain their original counts.

The released graph has no target-ID representation for a library symbol.
The export derives an identity only from precise facts already captured.

- **Go.** A literal import gives the full package path. A named selector
  or qualified type provides a symbol through an explicit import alias
  or a standard package name. A receiver type alone leaves open whether
  a method or field is promoted from an embedded type. Unproved default
  dependency package names and interface dispatch need more evidence.
  Vendored paths and checked-in module replacements stay inside.
- **Rust.** A qualified path gives a crate and, when named, a member path.
  A glob or bare crate use identifies a unit only. An explicitly
  qualified trait call can identify the declaring trait and method
  through a crate path or import binding. A dot call's receiver type
  can be an alias, use deref or dispatch through a trait from another
  crate. Those receiver facts alone earn no unit or symbol credit.
  An unqualified standard prelude spelling can help explain an outside
  miss. It carries no stored unit by itself.
- **TypeScript and JavaScript.** A stored literal specifier identifies
  the module. A named import binds the recorded imported name to that
  module at its captured source position. Subsequent direct selectors
  can re-use that binding and append the member path. A declaration
  directive can name a unit like the DOM library. A reason such as
  `external-package` without a binding identifies no particular
  package. Fluent calls through an untyped return carry no inferred
  symbol credit.

The boundary check uses tracked workspace and vendor manifests. A package
found in the central directory of a tracked Yarn cache archive is inside
the checkout. Relative npm `file:`, `link:` and `portal:` entries and
recorded Cargo path dependencies resolve against the owning manifest and
the checkout boundary. Known paths beyond that boundary are outside.
Missing in-checkout path targets, unsupported absolute paths and paths
through tracked symlinks remain unclassified. No archives are extracted.
The strict-inside column can differ from older SW-3 exports because these
checks and exact recorded library identities refine the outside partition.

The file-scope split recognizes minified JavaScript by its filename or
long lines in `dist/`, `public/libs/` and `static/`. PocketBase's checked-in
`ui/dist/` JavaScript is also marked as a bundle. Explicit negative
fixtures and unexpanded templates have their own scopes. The default
counts all scopes. Alternate rows remove each scope separately and all
three together. A failed input still appears in the failed-source count.
A source site with no stored link is reported in the extraction checks.

The audit strata combine module, recorded reason, scope and disposition.
With `--sampling-base` the exporter uses the supplied measured strata
to allocate fixed site quotas. Within each stratum it selects the lowest
fixed-seed hashes of pinned source sites. Repeated stored links at a
selected site contribute their multiplicity to the ratio estimate.
Intervals use within-stratum variance and a finite-population correction
on the number of sites. A bucket that cannot be sized from a sample is
visible in the audit. The curated source labels distinguish local
misses, library misses, legitimate ambiguity and unclassified sites.
These estimates prioritise work. They do not add definite score credit.

### Reproduce the committed plan

Run from the repository root:

```sh
node scripts/sweep/coverage.mjs --results sweep/plan-input.json.gz --plan docs/coverage-plan.md
```

The cumulative archive contains the latest accepted rows for all pins and the
reference rows used for the comparison. It fixes the exact input for the
generated plan block. On an update, replace the affected pinned rows and
regenerate the block with the same command.

### Recompute after a candidate run

Use one dev-server scratch directory for the npm baseline and candidate runs
so the export can use the same released metadata readers and npm cache. A local
build directory needs built `dist/` files and its runtime dependencies. A
local `.tgz` installs offline from the scratch cache. Candidate records are
keyed by artifact digest and live separately from the release records.

```sh
pymtheg-dev --name sw3 -- bash -c '
  node scripts/sweep/run.mjs --manifest "$PYM_SCRATCH/affected.json" \
    --local-build "$PYM_SCRATCH/pymtheg-candidate.tgz" \
    --output "$PYM_SCRATCH/candidate-run.json" --parallel 12
  node scripts/sweep/coverage-export.mjs --results "$PYM_SCRATCH/candidate-run.json" \
    --output "$PYM_SCRATCH/candidate-coverage.json" \
    --reference-samples evidence/sw-3/samples.json.gz
'
pymtheg-dev --name sw3 --no-sync -- bash -c 'cat "$PYM_SCRATCH/candidate-coverage.json"' > /tmp/pymtheg-candidate-coverage.json
node scripts/sweep/coverage.mjs --results /tmp/pymtheg-candidate-coverage.json \
  --base evidence/sw-3/breakdown.json.gz --plan docs/coverage-plan.md
```

After a full run or subset overlay, `--scoreboard FILE` also writes the rates
and per-repository table. For an archived baseline, pass only its breakdown
as `--results`. The plan retains its prose and replaces the marked table and
running totals. The exporter records each matched site's current reason,
outcome and multiplicity. The estimate keeps its original sampling stratum
and weight when a diagnostic changes. A sample only contributes to remaining
misses while its outcome still matches. The estimate caps weighted misses at
the current measured total for each language, scope and outcome, and reports
any uncovered remainder. A changed graph without matching observations
contributes measured counts immediately. Item status tracks observed
resolution or library identification at reference sites. Refresh the sample
to review the shapes in a materially changed corpus.
