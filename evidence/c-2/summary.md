# C-2 evidence: indexing within the default Node heap

All runs: the dev server, Node 24.21.0 with its default heap limit
(`heap_size_limit` 4,288 MiB) unless a cap is named. Each run is a cold `graph index`
of a fresh copy of the pinned checkout.
**Before** is `main` at `3591c26`. **After** is this branch.

The work copies and graph databases were on tmpfs. That takes the shared
disk out of the wall times: one synced commit per file was spending most of
the time in disk waits. Peak RSS (GNU `time`) and wall time are observations
on a shared machine. RSS shows how lazily V8 collects as much as what it
keeps: the same build measured 2.7 and 4.6 GB on cli/cli in two rounds before
the statement fix. "Largest heap after a full GC" is the most reliable
memory figure here. It is the largest size V8 reported after a mark-compact
in a `--trace-gc` run: a lower bound on live memory at the peak, and the
number that meets the heap limit.

Tools are in [`tools/`](tools/):
- `fetch.sh` makes the pristine checkouts; `list.txt` lists them.
- `run2.sh` does one run. It uses a fixed project ID, so symbol and link IDs
  can be compared, and records peak RSS and an RSS-by-phase timeline.
- `dump.mjs` writes every stored file, parse-failure marker, context, symbol,
  link and candidate row, sorted, and prints a SHA-256 of that dump.
- `gcpeak.sh` reads the `--trace-gc` output.
- `table.sh` builds the table below.
- `snap.mjs` summarises a heap snapshot by shortest retaining path.
- `probe.mjs` logs live heap at each TypeScript program creation.
- `probe2.mjs` logs `process.memoryUsage()` around each module's phases.
- `procwatch.sh` samples RssAnon, RssFile and RssShmem.

## Outcome, memory and identity

| Repository | Languages | Stored files | Outcome before → after | Peak RSS MiB before → after (round 1; round 2) | Largest heap after a full GC, MiB, before → after | Wall s before → after (round 1) | After: peak RSS MiB per 1,000 files | Stored records |
|---|---|--:|---|---|---|---|--:|---|
| microsoft/TypeScript | TS, Go, JS | 32,448 | **out of heap** → done (exit 2) | 5,615 → 4,314; 5,673 → 4,281 | 4,092 → 2,580 | 854 → 706 | 133 | identical to the old build at a 16 GB heap |
| vercel/turborepo | Rust, TS | 4,587 | **out of heap** → done (exit 2) | 5,676 → 3,639; 5,671 → 3,548 | 4,069 → 1,614 | 1017 → 778 | 793 | same on every run of the new build |
| T3 Code `b387e3a1`, own code | TS | 7,214 | **out of heap** → done (exit 2) | 5,698 → 3,791; 5,654 → 4,174 | 4,079 → 2,553 | 813 → 540 | 526 | same on every run of the new build |
| withastro/astro | TS | 3,362 | done (exit 2) → done (exit 2) | 3,108 → 1,190; 3,428 → 1,619 | 587 → 278 | 125 → 69 | 354 | identical |
| cli/cli | Go | 1,191 | done → done | 4,528 → 1,415; 4,291 → 1,905 | 1,131 → 495 | 205 → 97 | 1,188 | identical |
| nestjs/nest | TS | 2,360 | done → done | 3,585 → 2,328; 2,783 → 1,713 | 695 → 304 | 275 → 196 | 986 | identical |
| pingdotgg/t3code (sweep pin) | TS | 1,006 | done (exit 2) → done (exit 2) | 2,976 → 2,049; 3,251 → 2,035 | 559 → 397 | 165 → 98 | 2,037 | identical |
| excalidraw/excalidraw | TS | 733 | done (exit 2) → done (exit 2) | 3,752 → 2,318; 3,753 → 2,341 | 599 → 645 | 132 → 80 | 3,162 | identical |
| trpc/trpc | TS | 1,353 | done (exit 2) → done (exit 2) | 2,355 → 1,513; 2,581 → 1,367 | 373 → 245 | 92 → 50 | 1,118 | identical |
| helix-editor/helix | Rust | 269 | done → done | 1,998 → 1,171; 1,936 → 1,163 | 420 → 222 | 126 → 77 | 4,353 | identical |
| restic/restic | Go | 559 | done → done | 1,910 → 642; 2,095 → 671 | 303 → 134 | 65 → 32 | 1,148 | identical |
| ratatui/ratatui | Rust | 250 | done → done | 1,515 → 869; 1,676 → 869 | 308 → 152 | 94 → 59 | 3,476 | identical |
| BurntSushi/ripgrep | Rust | 102 | done → done | 1,275 → 652; 1,329 → 654 | 212 → 110 | 54 → 31 | 6,392 | identical |
| gin-gonic/gin | Go | 99 | done → done | 730 → 385; 737 → 387 | 119 → 72 | 17 → 10 | 3,889 | identical |
| spf13/cobra | Go | 36 | done → done | 447 → 275; 456 → 278 | 29 → 22 | 9 → 5 | 7,639 | identical |

"Done (exit 2)" is the sweep's `incomplete`: the graph is complete and some
files failed to read, the same as before the change. The 12 repositories
that finished before are a mix of 6 TypeScript, 3 Go and 3 Rust; the
required nestjs/nest, excalidraw, cli/cli and helix are among them.

Ask 1 in the task, identity: every stored row on all 12 is byte-identical,
in both rounds, before and after (the digests below). The old build also
completes the TypeScript compiler repository if given a 16 GB heap: 14,350
MiB peak RSS, 796 s. Its stored records equal the new build's
(`94e44d06…`), so identity covers that checkout too. Turborepo and T3 Code
`b387e3a1` give the same digest on every run of the new build (three
default-heap runs and one 3 GB-cap run each).

Peak RSS per 1,000 stored files falls as checkouts grow: about 0.35–7.6 GB on
small and medium repositories, 0.13–0.8 GB on the large ones. Fixed costs
dominate small checkouts: Node, the compiler and the language library files.

### Headroom

| Repository | Heap cap | Outcome | Largest heap after a full GC, MiB | Peak RSS MiB | Stored records vs default heap |
|---|---|---|--:|--:|---|
| microsoft/TypeScript | 3,072 MB | done (exit 2) | 2,805 | 3,955 | identical |
| vercel/turborepo | 3,072 MB | done (exit 2) | 1,962 | 3,326 | identical |
| T3 Code `b387e3a1`, own code | 3,072 MB | done (exit 2) | 2,542 | 3,491 | identical |

At a 2,048 MB cap, my build before the statement fix ran out of heap on
T3 Code `b387e3a1`, the TypeScript repository and Turborepo. So the largest
checkouts need between 2 and 3 GB of heap. The default limit is 4.2 GB.

### Digests

Identical before and after for every repository that finished before.

| Repository | Files | Symbols | Links | Candidate rows | SHA-256 of the sorted dump |
|---|--:|--:|--:|--:|---|
| microsoft/TypeScript | 32,448 | 48,402 | 483,985 | 37,313 | `94e44d06a028ce78304d8a19cb69341b6174a96f4ca3a880df1cad4f5d6c8a07` |
| vercel/turborepo | 4,587 | 54,680 | 726,108 | 305 | `4f8fc692be762cfaded51f532c37fb42724247589b31837eedabfe411f11800a` |
| T3 Code `b387e3a1`, own code | 7,214 | 94,855 | 1,149,014 | 1,950 | `1f7a4963764070b13d0e845cb37e63075aba12a94d3e2d45e50b30583ea1a02f` |
| withastro/astro | 3,362 | 17,473 | 151,382 | 1,268 | `1aea38104da96b75a4931a30ebca827260793601b6550db04304c5f7186aeb09` |
| cli/cli | 1,191 | 18,585 | 207,303 | 8,428 | `46c35d902acbc1e50a82ae9f0f2ae1f4e495249d44808fe1aee290c8a9dc5e95` |
| nestjs/nest | 2,360 | 14,474 | 161,185 | 38 | `38ed8d1973d8e67d559eef7254a7f7f8e0699e08a2813b9333ab8b52f620c7f3` |
| pingdotgg/t3code (sweep pin) | 1,006 | 18,571 | 161,530 | 1,872 | `b2a027b0fccd76788416c7fbc939775423f0c8d9114dcddfe3ce0612280f7bc0` |
| excalidraw/excalidraw | 733 | 7,434 | 103,386 | 0 | `cfb33e561381ed70d6565d9c3b551260d3719b266b93a6ce23ee419bd1cac30c` |
| trpc/trpc | 1,353 | 11,167 | 105,855 | 14 | `1ebf26d84c3590385a3d250b2630987f1bfc0deefd3d409a44c4c0f6ca1fb592` |
| helix-editor/helix | 269 | 8,450 | 86,281 | 60 | `7cf0affe132706121c02ca5d53f78cd9de1491d3abeb425e1b4b3dcb18f0a344` |
| restic/restic | 559 | 7,369 | 63,408 | 9,251 | `2525620f7855269aa8a134763e21cfe3dde12214477983bd1e3de0e590c35469` |
| ratatui/ratatui | 250 | 5,802 | 57,390 | 8 | `6981faf5ca3731065748a65dbdaee3582e871ddfbb5a8d055bb1e2ce227447e0` |
| BurntSushi/ripgrep | 102 | 4,392 | 39,086 | 24 | `b1b0090c1c5bb808f117e3c95d96dfb01c5562dafb187c2484c08db8467fc36e` |
| gin-gonic/gin | 99 | 2,264 | 20,364 | 2,920 | `255bdda399588fb4045a5589ecee3033eb484cf199762db75d30fbb651577cd6` |
| spf13/cobra | 36 | 832 | 8,792 | 4 | `4cc5a16c7ed8e0b88ce7f36ad9429500766d099d3c366d70b2e142c23b741d70` |

## The exported breakdown

The common pipeline ran on the 12 repositories with the old build and on
14 with this branch:
- `scripts/sweep/run.mjs --local-build`: cold index, repeat index and the
  queries;
- `coverage-export.mjs` with `--reference-samples evidence/sw-3/samples.json.gz`.

That candidate was this branch before the statement change. Its stored
records equal the final build's digests on all 15 checkouts.

For all 12 repositories, every exported field matches, with only the
attempt path and timing fields left out: `breakdown`, `sourceFiles`,
`failedSources`, `strata`, `reviewSites`, `libraryExamples` and `checks`.
`run.mjs` reports microsoft/TypeScript and vercel/turborepo as `finished`.
`coverage.mjs --base evidence/sw-3/breakdown.json.gz --plan docs/coverage-plan.md`
then marks them finished, so 55 of 60 pins finish.

Level 2 is unchanged on each of the 12: ripgrep 41.68%, cli 68.55%,
excalidraw 57.79%, gin 67.58%, helix 33.23%, nest 47.92%, t3code 67.21%,
ratatui 31.34%, restic 76.54%, cobra 76.94%, trpc 53.31% and astro 52.89%.

The language figures move only because two more graphs are counted:

| | Before (53 graphs) | After (55 graphs) |
|---|--:|--:|
| Go | 74.17% | 76.80% |
| Rust | 33.27% | 31.47% |
| TypeScript / JS | 48.02% | 47.83% |
| Overall | 55.79% | 54.94% |

The newly counted repositories are microsoft/TypeScript at 84.90% Level 2
over 483,985 links and vercel/turborepo at 30.60% over 726,108 links.

**The TypeScript repository's TS and JS are not analysed.** The TypeScript
module's analysis throws a compiler assertion there ("Debug Failure. False
expression."), on the old build too. So all 27,194 TS and JS files are
stored as failed, and its 84.90% is the Go port's links only. This is not a
memory outcome and was not fixed here (see the change note).

No link resolution changed, so the hand check of newly definite links in
the common rules has nothing to sample: there are no newly definite links.

## What the measurements showed

Four kinds of measurement, in order.

**Heap snapshots** at a capped heap:
- nestjs/nest on the old build, at 700 MB, in the resolve phase. The
  store's decoded-file cache held 96 MB. An all-links array held 105 MB. A
  row array of link bodies being decoded held 148 MB. Two or three whole
  file arrays held 78, 47 and 28 MB. Compiler data was already gone.
- T3 Code `b387e3a1` on this branch before the statement change, at 2 GB,
  in TypeScript analysis. The current program's checker held 1.0 GB. About
  half of that was the compiler's deferred-diagnostic callbacks: 512 MB
  rooted at `deferredDiagnosticsCallbacks`, of which 294 MB was retained
  through `errorLocation`. Node links were 260 MB. The current program's
  source files held about 0.4 GB and the session host's cache 126 MB. Two
  full sets of source texts held 96 MB each: the module input, plus the
  indexer's captured sources kept after writing. Results held about
  140 MB.

**The program-lifetime probe** (`probe.mjs`) on T3 Code `b387e3a1`. Live heap
after a forced GC, at each of 43 program creations, rose to 1.6 GB inside
the largest group and fell back to about 550 MB between later groups. So
earlier programs are released, and the peak is one group's program.

**RSS split** (`/proc/<pid>/status`) on the TypeScript repository, before
the statement change. The 9 GB peak was all anonymous memory, appearing
during the store's write of the Go module's results. `process.memoryUsage()`
around that write showed heap total near 3.3 GB and external memory 66 MB
throughout, while RSS rose from 4.2 to 8.9 GB.

**A statement-reuse experiment** on a copy of cli/cli's graph. Rewriting
198,234 Go link targets in one transaction with a fresh statement per row
raised RSS by 4.0 GB; a second pass added 2.9 GB. With one reused statement,
RSS rose by 60 MB. Released statements carry native memory that V8 does not
count. With this schema's triggers compiled into each one, it is not
reclaimed until a full collection.

## Tests

Full suite on the dev server: 2,935 tests, 2,935 pass. `npm run
format:check` is clean.

`test/graph-index-memory.test.mjs` checks two things:
- Live decoded records, counted with `v8.queryObjects`: zero after every
  run, and one per file while each module resolves.
- Statements prepared during a module's analysis write: 7 for both 20 and
  80 files. The old build prepares 1,403 and 5,603.

Both checks fail on the old build. The first fails there because 100 file
records are cloned. It also fails on this branch before the analyze and
resolve phases moved into their own frames: 40 live records instead of 20.
