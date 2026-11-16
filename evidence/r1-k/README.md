# R1-K evidence: Rust links around project macros and imports

Scripts (run from a built checkout on the dev server):

- `measure.mjs <source-root> <label> <out-dir>` copies the project's `*.rs`,
  `Cargo.toml` and `Cargo.lock` files to scratch, cold-indexes them with the
  production indexer and Rust module, and writes `<label>-summary.json`
  (outcomes, unresolved links by reason and by target class, cold index
  seconds) and `<label>-links.jsonl` (one row per link, with derived and
  macro-argument links marked).
- `compare.mjs <out-dir> <before> <after> <source-root> <seed> <n1> <n2> [<n3>]`
  prints the before/after tables and seeded random samples with the source
  line of each link, for reading by hand: written links that went from
  unresolved to definite, new definite links (calls in macro arguments and
  derived macro-body calls), and optionally derived macro-body calls only.
- `controls/` (round 1) and `controls2/` (round 2): rustc programs, one per
  fixture shape, with `run.sh` and the printed `output.txt` (rustc 1.98.1,
  dev server; evidence only, never in the index path).

Target classes in the measurement are a reading aid, not a resolver fact:
`local-binding` (parse marked the head a local, parameter or generic),
`std-path`, `external-path` (head names no workspace crate or symbol),
`workspace-would-be-targets` (the link carries would-be targets),
`workspace-name-exists` (some workspace symbol has the last segment's name)
and `no-workspace-symbol-named-so`.

Corpora: ripgrep at 178cc027e283 (cloned to the dev server's scratch) and
the pinned Vector at 515e87d9 (`~/pymtheg-dev/corpora/vector`, read-only,
copied by `measure.mjs`). `before` is origin/main (Rust module version 26;
round 2 used 60552338); `after` is this branch (version 27). Both sides of
round 2 ran in parallel on the same machine.

Files here:

- `ripgrep-before-summary.json`, `ripgrep-after-summary.json`,
  `vector-before-summary.json`, `vector-after-summary.json`: the summaries.
- `ripgrep-compare.txt`, `vector-compare.txt`: `compare.mjs` output,
  including the round 2 samples (seeds 4409 and 5521; round 1 used 1117
  and 2203).
- `sample-review.md`: the hand review of every sampled link.

The full `*-links.jsonl` files (ripgrep 5 MB, Vector about 70 MB) are not
committed; `measure.mjs` regenerates them.
