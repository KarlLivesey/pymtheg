# C-41 evidence

All runs on the dev server, Node 24.21.0, the 19 installed TypeScript pins
of SW-6 ([`pins-installed.json`](pins-installed.json)) installed as the
sweep's installed mode installs them. **Before** is main `5d97762` with
[`tools/diagnostic.patch`](tools/diagnostic.patch) (it records the shape of
each `local` declaration and changes no link). **After** is this branch
(build `cand2`). Timings and memory are observations on a shared server.
The change note is [`docs/changes/C-41.md`](../../docs/changes/C-41.md).

## Files

- [`classify-local.txt`](classify-local.txt),
  [`classify-local.json`](classify-local.json): the `local` links of the
  before run by declaration kind, place and member symbol, in total and per
  pin (`tools/classify.mjs`).
- [`compare.json`](compare.json): before against after, site by site, per
  pin: symbols, definite links kept and changed, candidate sets changed,
  newly definite links, library targets changed (`tools/compare.mjs`).
- [`sample-gained.json`](sample-gained.json): the 30 lowest-hash newly
  definite links (seed `c41`), audited in the note.
- [`remaining.json`](remaining.json): each `local` literal-member link of
  the before run and its outcome after, with six sample sites per shape
  still `local` (`tools/remaining.mjs`).
- [`pinscore-before.tsv`](pinscore-before.tsv),
  [`pinscore-after.tsv`](pinscore-after.tsv): per pin, TypeScript links,
  Level 2 links, assumption-marked Level 2 links and their percentages
  (`tools/pinscore.mjs`, SW-6's).
- [`cold.json`](cold.json): cold indexes of redux-toolkit, vitest and
  excalidraw with main, after and main (`tools/cold.sh`).

## Tools

- `build.sh NAME`, `sweep.sh BUILD`, `bg.sh NAME COMMAND…`: build a tree,
  run the installed sweep with it, run a command detached.
- `local-shape.ts`: the diagnostic's shape function, applied by the patch.
- `probe-local.mjs DIST FIXTURE.json`, with `shapes.json` and
  `iface.json`: index a small fixture and print each link's outcome and
  shape (used to write the tests).
- `sample.mjs`: sample sites of one shape from a run.
