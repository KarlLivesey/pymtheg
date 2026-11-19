# C-13 evidence

All runs used the dev server, Node 24.21.0 with its default heap (about
4.2 GB) unless a heap size is named. **Main** is `8ca29ac` (C-10 merged).
**C-13** is this branch. Both were built from source (`tsc`) and used as
`scripts/sweep/run.mjs --local-build` directories. Timings and memory are
observations on a shared machine.

## Files

- [`tools/`](tools/): the measurements.
  - `probe.mjs`, `analyze.mjs`, `livecount.mjs`: run the TypeScript module
    alone and log live heap, failed files and live checker objects.
  - `rebuild.mjs`, `synth.mjs`: reproduce rebuild retention.
  - `snap.mjs` (from C-2): summarises heap snapshots by retaining path.
  - `groups.mjs`, `budget.mjs`: the project groups and what a budget leaves
    out.
  - `components.mjs`: the prototype split of the no-config program.
  - `locate.mjs`: locates a compiler exception.
  - `identity.mjs`, `identity-all.mjs`: compare every stored row of two
    stores.
  - `cost.sh`, `cost-all.sh`: cold index cost.
  - `fetch.sh`: the pinned checkouts.
- [`compare.mjs`](compare.mjs): C-10's link comparison, seed `c13`.
  [`compare-summary.json`](compare-summary.json) is its output.
- [`identity.jsonl`](identity.jsonl): every stored row, main against C-13,
  per pin.
- [`run-main.json.gz`](run-main.json.gz), [`run-c13.json`](run-c13.json):
  the sweep records of the nine pins in [`pins.json`](pins.json).
- [`cost.txt`](cost.txt): cold index time (s) and peak RSS (KiB).
- [`plan-input.mjs`](plan-input.mjs), [`coverage-plan-input.json.gz`](coverage-plan-input.json.gz):
  the plan layering and its input.
