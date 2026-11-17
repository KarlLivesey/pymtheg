# SW-2: comparison harness against other code-graph tools

New tooling, no product change. `scripts/compare/` runs the released
`pymtheg@0.1.0`, CodeGraph 1.6.2 and graphify 0.9.112 on the same pinned public
repositories, puts their symbols and links into one shape and lists what each
finds that the others miss. It reads the `sweep/repos.json` format that SW-1
writes, so the full comparison over the 60 sweep repositories can run once both
chunks are merged.

- One adapter per tool (`scripts/compare/adapters/`). Each tool keeps its own
  certainty wording. Pymtheg's candidate sets stay candidate sets (one edge per
  member, marked with the set's size and whether it is open); they are never
  counted as definite links.
- One stated, deterministic matching rule (`scripts/compare/lib/match.mjs`,
  written out in `scripts/compare/README.md`): same file and normalised name
  at both ends, declaration lines within 3, the container only breaking ties,
  then a second pass by call site for links the tools attribute to different
  enclosing symbols.
- `run.mjs` fetches each repository shallow at its pinned commit, runs every
  tool in its own copy with no network and no API keys, records outcome, wall
  time and peak memory (observations only), and writes counts plus a fixed-seed
  sample per diff bucket. It is resumable, and a failing tool or repository is
  recorded without stopping the run. An entry may name `exclude` paths, removed
  from the tools' copies only (used to leave out vendored trees).
- Network isolation is required by default: if `unshare -rn` does not work,
  the run stops with a message. `--no-isolate` runs the tools with network on
  purpose, and the results record `isolated: false`.
- Repository ids may be `owner/name`, as in `sweep/repos.json`; each id gets a
  folder named `owner__name`.
- `show.mjs` prints a bucket's sampled links with their source lines for
  hand-checking.
- `test/compare-harness.test.mjs` checks the normalising and matching on tiny
  fixtures, with no network and no tools installed.

The six-repository pilot, the hand-checked samples and the recommendation are
in `evidence/sw-2/summary.md`. Its findings about Pymtheg are listed there, not
fixed here.

Rejected as extra tools, with reasons in the summary: Sourcegraph's SCIP
indexers, universal-ctags, GitHub stack graphs and tree-sitter tags.

Known limit, not fixed here: when one tool emits the same link twice from two
enclosing symbols (CodeGraph's `Gt` reference at cobra `cobra.go:38`, once from
the file and once from `templateFuncs`), the second copy cannot join the
cluster that already holds that tool, so it is counted as "only others"
(`scripts/compare/lib/match.mjs`, the second matching pass). Absorbing such
duplicates would change the pilot's samples, so it is left for the full run.
