# C-27 evidence

The pin commits come from `sweep/repos.json`. The baseline is `5364e87`, the
main branch with C-22 merged. The after build uses Go module version 32
and the C-27 implementation in `ff90cf5`. Main advanced during the runs.
The merge from `0ccd239` adds SW-4 and C-25 without changing the measured Go
or graph-core sources. The merged branch has its own integration checks.
The Echo and restic cold controls used the same Go resolver before the
previous-record read moved into its own stack frame. A cold store starts
empty. All warm measurements and the seeded runs use the final
record-lifetime fix.

- Edit measurements use the same CLI route and the same three edits per
  pin. The summaries retain operation counts, wall time, CPU time, peak
  memory, stage timings and the row comparison after each revert.
- Cold measurements use fresh production SQLite stores on memory-backed
  storage. Each pin uses the same page-cache setting for all three runs.
  The comparison removes the new Go surface field, normalizes the module
  version and excludes the newly captured vendor manifest. The
  `cli-cold-corrections.json` file records the four definite field references
  that main assigned to a different standalone example. The comparison
  checks every row, including symbol keys and all link targets.
- Seeded comparisons run `indexProject` with the production SQLite store
  for both sides. They compare every graph row after each edit with a fresh
  store of that same tree. The temporary database uses memory-backed
  storage with an enlarged page cache. Persistent scratch, source copies,
  and logs remain on disk.

The time-boxed run completed 67 comparisons on restic, 25 on cli/cli and
12 on golang/tools. Each seed's JSON lists the edits and their results.

See [C-27](../../docs/changes/C-27.md) for the results and fallback rules.
