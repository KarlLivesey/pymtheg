# Coverage plan for 0.2.0

The release target is 90% coverage. The [scoreboard](../evidence/sw-3/scoreboard.md)
reports the measured baseline from `pymtheg@0.1.0`. This plan estimates how much
each support item could add. The ordering uses potential percentage points in
the item's language.

Adjusted coverage divides resolved links by resolved, ambiguous, inside-unresolved
and unclassified links. The raw score includes outside-unresolved links too.
The main plan includes every observed file scope. The source-only forecast
excludes checked-in bundles, deliberately broken fixtures and unrendered
templates. These source scopes are counted separately in the scoreboard.

A support item's link count is an estimate. The unresolved and ambiguous rows
were sampled at a fixed seed by language and recorded reason, then inspected at
the source site. The plan uses the share of each support shape within its
language, reason group and file scope. `≥` marks the number of repositories
where the sample directly showed the shape. A link that looked external or
whose target remained unclear could stay unlabeled. Some support items touch
candidate sets that may correctly remain ambiguous at run time.

The Rust failed-file item uses an exact stored count of eligible unresolved
links with `failed-file-unseen-declarations`. It takes precedence when the same
link also has `receiver-type-unverified`. The grammar items estimate only the
missing outgoing links from failed files. Existing links affected elsewhere
in their crate belong to the failed-file item. [Rust resolver](../src/graph/languages/rust/resolve.ts#L4371)

The SW-1 Serde profile points to recursive scope and `use` lookups in `find`,
`children`, `inScope`, `findUsePath` and `resolveUse`. The resolver stays in
synchronous work long enough to miss the CLI's shutdown signal. The memory
and timeout rows describe separate groups of lost graphs. [Rust lookup](../src/graph/languages/rust/resolve.ts#L2169)

For TypeScript, `no-symbol` records a lookup with no usable symbol. `local`
records a declaration in the captured source that has no graph anchor. The
source review uses those meanings when assigning support items. [No symbol](../src/graph/languages/typescript/extract.ts#L263) · [Local declaration](../src/graph/languages/typescript/extract.ts#L330)

The planning baseline adds an estimate for eligible links from failed source
files and repositories that did not finish. It multiplies line counts by the
median observed eligible links per readable source line for the language.
Mixed checkouts contribute an estimate to each module with source. Missing
repositories have no measured file scopes, so both planning variants use the
same estimates for them. The source excerpts for process failures show code
from the affected pins. The process logs locate the failures only to a phase.
If one of these repositories starts indexing, its actual score replaces its
zero in the pinned mean and its estimated missing volume in the plan.

Potential gain divides the estimated eligible links by the planning
denominator for that language. The running total assumes every listed link
can become definite. That is a planning ceiling, with uncertainty from
sampling, valid ambiguous calls and estimated missing volumes. The
`unexplained` count identifies the part of the eligible population left after
these estimates, including unsampled reasons and links whose source did not
establish a support shape.

<!-- sweep:coverage:start -->
<!-- sweep:coverage:end -->

Recompute the table and scoreboard with `scripts/sweep/coverage.mjs`. For a
candidate run on a subset, pass the release archive as `--base` and overlay
only matching pins. The status shows newly resolved sampled sites, reduced
failed-file counts or fewer failed attempts. A missing sampled site does not
count as resolved. [Sweep commands and classification rules](../sweep/README.md)
