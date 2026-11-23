# C-45 evidence

One-file edits on main `60d4f2b`, bare checkouts of the pins in
[`sweep/repos.json`](../../sweep/repos.json), store on disk, on the shared
dev server, by [`scripts/reindex/measure.mjs`](../../scripts/reindex/measure.mjs)
with `--edits body,export` (the cases are in
[`cases.json`](../../scripts/reindex/cases.json); this chunk adds Vitest and
dioxus). Each step is `graph index` in a fresh process; each edit is
reverted, and every revert equalled the cold store row for row.

- `stages.md`: CPU seconds by stage group, the counted work, and the
  achievable estimates, from
  [`scripts/resident/stages.mjs`](../../scripts/resident/stages.mjs)
  (`--achievable`).
- `stages.json`: the same per step (cold, no edit, each edit and revert),
  with the counters.

CPU and wall times are observations on a shared machine; the counters are
deterministic.
