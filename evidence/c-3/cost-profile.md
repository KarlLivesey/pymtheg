# C-3 cold indexing profile

The comparison uses main `32ca7571` and the reviewed head `1355abc4`. Both
builds run the graph CLI with Node's default heap on the same pinned Astro
checkout and the same storage. Each invocation starts with an empty graph.
The CPU profiles use Node 24.21.0 with `--cpu-prof --cpu-prof-interval=2000`.
The unprofiled same-session runs below supersede the earlier paired timings
from the loaded shared server. [Earlier review measurements](review-summary.md#cost-against-main)

| Astro profile | Main | Reviewed head |
| --- | ---: | ---: |
| Cold wall seconds | 159.26 | 189.15 |
| Peak RSS MiB | 1,604 | 2,120 |
| User CPU seconds | 87.32 | 127.82 |
| System CPU seconds | 82.64 | 86.80 |
| Elapsed stack samples in graph storage, seconds | 114.60 | 118.89 |
| Elapsed stack samples in TypeScript program construction excluding module resolution, seconds | 3.21 | 19.31 |
| Elapsed stack samples in compiler binding and checker creation, seconds | 1.12 | 5.89 |
| Elapsed stack samples in TypeScript module resolution, seconds | 5.52 | 4.33 |
| Elapsed stack samples during TypeScript extraction, seconds | 10.54 | 12.23 |
| Elapsed stack samples in garbage collection, seconds | 4.18 | 6.93 |

SQLite transactions account for about 80 sampled seconds in both profiles.
That phase dominates elapsed time and is sensitive to storage load. The
largest measured increase is TypeScript program construction. Parsing,
binding and garbage collection grew, while module resolution and extraction
changed much less. TypeScript extraction includes both checker lookups and
graph symbol and link construction. Stack-sample durations can include time
blocked inside native functions.

Within extraction, sampled checker API calls were 4.07 → 4.17 s and
symbol helpers were 1.64 → 2.09 s. Declaration type warm-up was 5.97 → 6.23 s.
Graph validation was 0.92 → 0.94 s and the final TypeScript target-resolution
loop was 0.07 → 0.09 s. These stack views overlap the broader phases above.

The separate analyzer-only counters use the pinned file texts and each
build's captured project context. The workspace-off diagnostic build uses
the reviewed head's snapshot and disables virtual install links and project
reference redirects. Scoped symbols and existing local references still run.

| Astro analyzer census | Main | Reviewed head | Workspace off |
| --- | ---: | ---: | ---: |
| Compiler programs | 138 | 138 | 138 |
| Captured files loaded, counting copies across programs | 3,871 | 26,697 | 3,871 |
| Captured files loaded as dependencies, counting copies | 512 | 23,338 | 512 |
| Largest compiler program, files including standard declarations | 1,178 | 1,421 | 1,178 |
| Program construction, seconds | 4.00 | 26.49 | 4.30 |
| Initial binding, seconds | 1.27 | 6.49 | 1.09 |
| Analyzer wall seconds | 27.64 | 53.73 | 25.13 |
| Analyzer process peak RSS, MiB | 823 | 1,410 | 1,017 |

The workspace links make the compiler load and bind more copies of sibling
sources under the importing config. The program count stays the same.
Compiler resolution already caches by program. Disabling workspace resolution
reverses the additional dependency loads. The two local-declaration features
still produce the same counts of symbols and link sites in this ablation.
An initial diagnostic used main's context for both builds and counted only
2,598 dependency entries at the head. Main omits `pnpm-workspace.yaml` from
its capture. The table uses the head's complete context, including that file.

The measured candidate retains external-module dependencies under compatible
compiler document settings and implied module format, within a budget of one
million source characters. Each project keeps its own checker. The candidate
also decodes SQLite link rows incrementally and skips candidate-set allocation
for sites with zero or one target. The Astro analyzer reused 859 source trees.
Host parses went from 26,703 to 25,844 and analyzer wall time from 53.73 to
52.41 s, with the same 23,338 dependency entries. Analyzer peak RSS went from
1,410 to 1,436 MiB.

## Unprofiled cold runs

Each repository uses its own pinned checkout and one fixed project identity.
Main A, the reviewed head, the candidate, and main B run in that order in
one dev-server session, each with a fresh database on the same volume. The
OS file cache was left in its normal state. The trial built with `npm run
build:core` on Node 24.21.0.

| Repository | Main A wall s / RSS MiB | Reviewed head | Candidate | Main B |
| --- | ---: | ---: | ---: | ---: |
| Astro | 157.61 / 1,172 | 183.17 / 1,679 | 183.50 / 1,757 | 156.72 / 1,174 |
| Vitest | 137.39 / 1,518 | 150.30 / 1,530 | 152.13 / 2,484 | 134.76 / 1,526 |

The Astro main controls differed by 0.89 s and 2 MiB. Against their midpoint,
the candidate took 16.8% longer and peaked 49.8% higher. Candidate user CPU
fell from 121.17 to 118.23 s compared with the reviewed head, while peak RSS
rose by 78 MiB.

The Vitest main controls differed by 2.63 s and 8 MiB. Against their midpoint,
the candidate took 11.8% longer and peaked 63.2% higher. Candidate user CPU
fell from 116.46 to 112.13 s compared with the reviewed head, while peak RSS
rose by 954 MiB. The candidate misses the memory target on both repositories.

The candidate and reviewed head matched exactly on Astro, Vitest, and
Changesets. For each repository, rows were sorted and hashed with SHA-256
over every column in all seven graph tables: files, contexts, symbols, links,
candidates, parse failures, and metadata. The comparisons covered 281,427
stored links and all associated data and targets.

## Value and cost of workspace resolution

The workspace-off build exists only for diagnosis. Its graph and the reviewed
head's graph are scored with the sweep's Level 2 rules using the same pinned
sources. A scratch copy of the exporter reads the real cold counts and loads
TypeScript from the checkout build's dependency directory.

| Repository | Workspace off wall s / RSS MiB | Reviewed head | Workspace off Level 2 | Reviewed head Level 2 | Gain from workspace resolution |
| --- | ---: | ---: | ---: | ---: | ---: |
| Astro | 149.56 / 1,360 | 183.17 / 1,679 | 54.07% | 65.50% | 11.43 pp |
| Vitest | 147.77 / 1,166 | 150.30 / 1,530 | 37.59% | 66.34% | 28.75 pp |

On Astro, workspace resolution added 17,432 definite targets at the same
152,561 stored sites. The cold diagnostics measured a 33.61 s wall-time
difference and a 319 MiB peak-RSS difference. The analyzer-only ablation
also reduced peak RSS by 393 MiB.

On Vitest, workspace resolution added 33,411 definite targets at the same
116,220 stored sites. Peak RSS rose by 364 MiB and user CPU by 26.30 s.
The 2.53 s wall-time difference falls within the two main controls' spread.

The cost trial was reverted locally. The measurements for PR #12 use the
reviewed build named above.
