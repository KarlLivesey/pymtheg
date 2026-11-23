# C-40 evidence

Runs on the shared dev server, bare checkouts of the pins in
[`sweep/repos.json`](../../sweep/repos.json), Node's default heap
(4,288 MiB) unless stated.

- `probe-samples.txt`: [`scripts/memory/probe.mjs`](../../scripts/memory/probe.mjs)
  before the change. It gives the live heap after a full collection at each
  phase of a cold index. The runs are microsoft/TypeScript at the default
  heap (it ran out at the Go resolution input) and at 12,000 MB; a slice of
  it (everything except 23,639 of the test files), before and after; trpc
  before and with `lastAsked` alone cleared (no difference); and turborepo
  after.
- `probe-after.txt`: the same probe on microsoft/TypeScript at the default
  heap with this change. It finishes.
- `snapshot.txt`: [`scripts/memory/snapshot.mjs`](../../scripts/memory/snapshot.mjs)
  over a heap snapshot of the slice after the TypeScript analysis and its
  writes: self size by type, and the shortest strong path from the roots to
  the retained checker (through `libCache`).
- `peaks.txt`: [`scripts/memory/peak.sh`](../../scripts/memory/peak.sh)
  cold indexes before (`3756b30`) and after, with peak RSS, wall time and a
  row-digest comparison on turborepo, astro, cli/cli and helix. Also the
  microsoft/TypeScript `graph index` through the CLI
  ([`cli-index.sh`](../../scripts/memory/cli-index.sh)) at the default heap.

Heap and RSS figures are observations; counts and row digests are
deterministic.
