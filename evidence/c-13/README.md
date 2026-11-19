# C-13 evidence

All runs used the dev server, Node 24.21.0 with its default heap (about
4.2 GB) unless a heap size is named. **Main** is `53d248f` (C-23 merged) for
the final identity round, and `fdeb52f` for the microsoft/TypeScript round.
**C-13** is this branch. Both were built from source with the grammars and used as
`scripts/sweep/run.mjs --local-build` directories in one session. Timings and
memory are observations on a shared, loaded machine. The change note,
[`docs/changes/C-13.md`](../../docs/changes/C-13.md), summarises the results.

## Files

- [`pins.json`](pins.json): the nine pins: swc, microsoft/TypeScript, and
  the identity pins excalidraw, vitest, trpc, astro, hono, redux-toolkit and
  vite.
- [`run-main.json.gz`](run-main.json.gz), [`run-c13.json.gz`](run-c13.json.gz):
  the sweep records of the final identity round (the seven pins).
  [`run-main-with-typescript.json.gz`](run-main-with-typescript.json.gz)
  and [`run-c13-with-typescript.json.gz`](run-c13-with-typescript.json.gz)
  add microsoft/TypeScript ([`pins-taint.json`](pins-taint.json)).
- [`identity.jsonl`](identity.jsonl): every stored row, main against C-13,
  per pin (`tools/identity-all.mjs`). Symbol and link IDs become stable keys
  and module version 38 maps to 37. Zero rows differ on four pins. vitest
  and astro differ only in dependency stamps (inode, time, size of
  checked-in `node_modules` paths). Vite differs through its
  byte-order-mark package.
- [`taint-steps.txt`](taint-steps.txt): each identity pin's taint walks and
  most steps in one walk, against the 8,000,000-step budget.
- [`compare-summary.json`](compare-summary.json): every link, with C-10's
  [`compare.mjs`](compare.mjs) (seed `c13`). All 334,036 links that are
  definite on main keep their target.
- [`vite-transitions.json`](vite-transitions.json): Vite's changed outcomes
  (`tools/transitions.mjs`): 10,558 unresolved → library target and one new
  structural link. It also holds the 20-link hand-check sample (seed `c13`).
- [`scoreboard-main.md`](scoreboard-main.md), [`scoreboard-c13.md`](scoreboard-c13.md):
  `coverage.mjs` scoreboards of the two exports.
- [`plan-input.mjs`](plan-input.mjs), [`coverage-plan-input.json.gz`](coverage-plan-input.json.gz):
  C-23's committed input, with this round's seven pins and the latest
  microsoft/TypeScript and swc records replaced. The TypeScript /
  JS section was regenerated from it with `--base
  evidence/sw-3/breakdown.json.gz` and copied with `evidence/c-11/plan.mjs`.
  The two completion rows were updated. C-23's input alone reproduces
  main's TypeScript section exactly.
- [`cost.txt`](cost.txt): cold index time (s) and peak RSS (KiB) of astro
  and vite: main, C-13, main again (`tools/cost-all.sh`).
- [`tools/`](tools/):
  - `probe.mjs`: a TypeScript-only index with live heap per program;
  - `analyze.mjs`: runs `analyze()` directly, with failed-file reasons and
    heap, a budget override and a snapshot point;
  - `locate.mjs`: the node a compiler exception was thrown on;
  - `tracecalls.mjs`, `tracefiles.mjs`, `steps-all.sh`: debugging copies
    that log checker calls and the taint walk's files, parts and worklist,
    and the per-pin walk counts;
  - `components.mjs`: the prototype split of the no-config program;
  - `groups.mjs`, `budget.mjs`: project groups and what a budget leaves out;
  - `rebuild.mjs`, `synth.mjs`, `livecount.mjs`, `snap.mjs` (from C-2): the
    rebuild retention, its fixture, live checker objects, and heap snapshots
    by retaining path;
  - `identity.mjs`, `identity-all.mjs`, `transitions.mjs`: the comparisons;
  - `cost.sh`, `cost-all.sh`, `fetch.sh`: cost and checkouts.

## Where the memory went (measured before the fix)

- **swc's no-config program.** 50,117 files and 159,816,112 characters. On
  main, building it alone fills the default heap (OOM after 246 s, at
  4.08 GB, with `tools/probe.mjs`). On a 16 GB heap it holds 4.2 GB after
  parse and bind.
- **Shared global names.** `tools/components.mjs` joins loose files by
  imports, references, ambient modules and shared global names. Its largest
  component is 44,933 files; 174 more files augment lib globals.
- **Rebuild retention.** On a 2,022-file fixture with 20 files that trip the
  compiler (`tools/synth.mjs`), live heap grew from 607 to 2,499 MB over 21
  programs; the fix keeps it at 609 MB. The heap snapshot at the 8th
  program shows two retainers:
  - the host's `realpath` chain (`originalRealpath`) through every earlier
    program, 600 MB;
  - the caught `Error`'s stack frames holding the previous checker,
    283 MB, including 154 MB of `deferredDiagnosticsCallbacks`.
- **The microsoft/TypeScript assertion.** Reproduced with three script
  files (`test/graph-typescript-large.test.mjs`). In the repository it is
  thrown while warming a file whose object literal reads a member of an
  enum merged across `tests/cases` scripts.
- **swc's extraction trips.** They are thrown inside taint.ts's
  whole-program walk, on the merged global `Inner`: "Unhandled declaration
  kind! ModuleDeclaration". Charging the exception to the file whose
  declaration was being read fails those declaring files. Without that,
  every extracted file failed.
- **microsoft/TypeScript after the fix.** taint.ts's walk runs out of heap
  on `tsc/testdata/tests/cases/compiler/crossProductUnionIntersectionRepeatedPropDeclarationsNoOOM1.ts`.
  The same happens on main with that file and any file with a syntax error:
  100 s, 4.9 GB, killed. Without the failed file it takes 0.8 s.
