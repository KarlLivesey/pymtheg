# C-26 evidence

All runs used the dev server, Node 24.21.0 with its default heap unless a
heap size is named. **Main** is `0ccd239` (C-22, C-25 and SW-4 merged) for
identity and `5364e87` (C-22 merged) for
cost; the microsoft/TypeScript traces on main used `7d3762b`, whose
TypeScript module is the same. **C-26** is this branch. Timings and memory
are observations on a shared, loaded machine. The change note is
[`docs/changes/C-26.md`](../../docs/changes/C-26.md).

## Files

- [`identity.jsonl`](identity.jsonl): every stored row of the seven pins,
  main against C-26 (`tools/identity-all.mjs`, `tools/identity.mjs`).
  Symbol and link IDs become stable keys, module version 39 maps to 38,
  and main's `data.failedFiles` map is normalised to the digest C-26
  stores.
- [`compare-summary.json`](compare-summary.json): every link (C-10's
  `evidence/c-13/compare.mjs`).
- [`resolved-rows.jsonl`](resolved-rows.jsonl): stored `resolved` rows per
  pin, and context rows that differ only in C-20's dependency stamp.
- [`cost.txt`](cost.txt): cold index seconds and peak RSS (KiB) of astro
  and vite: main, C-26 (tagged `c13-r2` by C-13's script), main again.
- [`pins-seven.json`](pins-seven.json), [`pins-typescript.json`](pins-typescript.json):
  sweep manifests.
- [`tools/`](tools/):
  - `hang-probe.mjs`, `prof.sh`: the call that does not return, and its
    tick profile;
  - `flow-cycles.mjs`, `cycles-pins.sh`, `variants.mjs`: the flow check on
    whole checkouts and on small variants;
  - `trace.sh`, `trace-calls.sh`, `tracesum.sh`, `lastcalls.sh`: traced
    runs of microsoft/TypeScript (with C-13's `tracefiles.mjs` and
    `tracecalls.mjs`);
  - `analyze.mjs`: C-13's direct analysis, with result sizes and a heap
    snapshot at return;
  - `regress.sh`, `on-main.sh`: the tests against reverted or main code;
  - `sweeps.sh`, `long.sh`, `timed-index.sh`, `stamp.mjs`, `attempt.sh`,
    `identity.sh`: sweep runs and their read-outs;
  - `setup.sh`, `build-archive.sh`, `bg.sh`, `wait.sh`, `format.sh`,
    `test-ts.sh`: dev-server plumbing.
