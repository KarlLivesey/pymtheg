# C-38 evidence

All runs on the dev server, Node 24.21.0, pins from `sweep/repos.json` with
dependencies installed as the sweep's installed mode installs them
(`scripts/reindex/install.mjs`). **Main** is `5d97762`. **after2** is this
branch before its last change (the no-edit case of retried failures) and
wording; **after3** is the branch with it. Timings and memory are
observations on a shared, heavily loaded server. The change note is
[`docs/changes/C-38.md`](../../docs/changes/C-38.md).

## Files

- [`edits-main.txt`](edits-main.txt), [`edits-after.txt`](edits-after.txt),
  [`edits-after3-trpc.txt`](edits-after3-trpc.txt): each index of
  `scripts/reindex/measure.mjs` (cold, no edit, comment, body, export, each
  reverted). Columns: process CPU and wall seconds, peak MiB, TypeScript
  programs built and files extracted, whether the scoped path ran, surface
  programs built, results changed, failed files, and why a scoped path was
  declined. Every revert equalled the cold store.
- [`edit-equals-cold.txt`](edit-equals-cold.txt) (body edits, after2) and
  [`edit-equals-cold-comment-export.txt`](edit-equals-cold-comment-export.txt)
  (comment and export edits, after3): each case edit's store compared with
  a cold index of the edited tree (`scripts/reindex/edit-equals-cold.mjs`);
  all equal.
- `random-<pin>-<seed>.json`: the seeded random edits (after3), each step
  with its kind, file and line, whether it was scoped, CPU, its equality
  with a cold index, and the following no-edit run.
- [`cold.json`](cold.json): cold index of each pin with main, after2 and
  main again (`scripts/reindex/cold-cost.mjs --ts-loaded-by`), with each
  store's row differences from main's first run (none).
- [`tools/`](tools/):
  - `setup.sh`, `build.sh`: fetch, install, build;
  - `measure.sh`, `measure-pairs.sh`, `summary.mjs`: the edit measurements;
  - `checks4.sh`, `checks-seq.sh`: edited stores against cold;
  - `cold.sh`: the cold comparison;
  - `random.sh`: the seeded random edits;
  - `tests.sh`: build and the TypeScript and re-index tests;
  - `blockers.mjs`, `probe-*.mjs` and their fixtures: diagnosis aids used
    while building (what blocked a scoped path; which link names a file;
    the surface of one file in a plain program; whether a lookup is cut).
