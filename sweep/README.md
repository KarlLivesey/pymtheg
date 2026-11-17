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

`coverage-export.mjs` opens a completed graph in read-only mode and checks its
link totals against that run's warm CLI result. Its aggregate includes every
stored language, kind, outcome, `data.reason` and `data.uncertainty` combination,
plus the file scope and the coverage classification. Ambiguous links remain
in the denominator. Resolved structural links such as `contains` count too.
The scoreboard has a completion checklist and separate per-module rates
across finished checkouts. An unfinished attempt contributes no links to
coverage. A newly finished pin enters the measured denominator.

Outside requires evidence that the target is unavailable in the checkout.

- **Go.** Follow import edges or a selector whose recorded expression has a
  package-name root. Use an explicit alias, or an undisputed last path segment
  for the implicit alias. The released Go layout checks local modules and
  replacements. A recorded `vendor/` package stays inside. The standard
  library roots, recorded builtin calls and dependencies declared in the owning
  `go.mod` can count as outside. Concrete standard-library receiver types and
  named standard factory results can also be traced from stored Go expressions
  and same-package signatures. This trace keeps interface dispatch, C imports
  and unproved receiver chains in the denominator.
- **Rust.** Use explicit `std`, `core`, `alloc`, `proc_macro` and `test` paths,
  an unconditional top-level import binding, or a named Cargo dependency with
  an unambiguous path or registry origin. Local Rust names and conflicting
  bindings prevent external attribution. A fixed list of prelude macros and
  types also counts as outside when the checkout shows no possible shadow,
  disabled prelude or relevant `no_std` restriction. Macro-use imports and
  blocked sites prevent that inference. `crate`, `self`, `super` and authored
  module declarations are inside. Uncertain receiver types stay unclassified.
- **TypeScript and JavaScript.** Use literal specifiers or simple, unshadowed
  import bindings. A workspace package or relative import under the checkout
  stays inside. The export checks tracked npm and pnpm workspace manifests
  before assigning package origins. Relative imports that escape the checkout count as outside.
  Built-in Node specifiers and unvendored declared package dependencies can
  be outside. A configured alias that could bind locally prevents an external
  guess. An `external` link on a literal receiver or an unshadowed runtime or
  compiler-library name can count as outside. Fluent assertions can be traced
  to a named assertion package through their import. Other `external-package`
  links with no package evidence stay unclassified. The released TypeScript
  parser reads import declarations for this rule without executing source.

The file-scope split recognizes checked-in minified JavaScript, PocketBase's
checked-in `ui/dist/` bundles, explicit negative fixture paths, Tauri's
unexpanded source templates and mdBook's hidden-line snippets. The default
score counts them. The alternate scores remove one named scope at a time and
all three together. The split follows the source of a link. An incoming link
from another scope retains that scope. A failed file with no links still
appears in the failed-source counts. The 14 known invalid Go tools inputs count
as broken fixtures. The three reviewed valid Go files that the grammar rejected
stay in the source scope.

The source audit stratifies unresolved and ambiguous links by language,
reason family, source scope and strict disposition. It ranks sites by a
SHA-256 hash of seed `0x7c8a59bd2e41`, the repository pin, source span, kind
and target spelling. Pass `--sampling-base` with the measured breakdown to
allocate about 420 sites per module in proportion to bucket volumes. The
review records a support shape, an outside target, a legitimately ambiguous
runtime target or a cannot-tell reason for every selected site. Only the
estimate uses the review's outside labels. Rust links marked
`failed-file-unseen-declarations` keep a separate exact count, including when
they also carry a receiver reason. The same baseline export checks a few
syntactically identifiable source shapes with no stored link, using the
installed release's TypeScript and Go readers. They remain outside the
stored-link measure.

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
running totals. The candidate estimate reweights the labelled reference
sample. Buckets with no remaining reference observations stay unclassified
and are reported in the candidate scoreboard. A finished pin that lacked a
baseline graph has measured strict coverage immediately. Refresh the sample
to review the shapes in a materially changed corpus.
