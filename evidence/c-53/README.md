# C-53 evidence

Pins: restic (the server's pinned corpus), cli/cli 42d52b4c, helix-editor/helix and DioxusLabs/dioxus at their sweep pins.

- `<pin>.diagnosis.{main,head}.json`: one cold index per build with every graph write statement counted by phase, and every link body written (`scripts/link-writes/diagnose.mjs`). On cli/cli the main diagnosis recorded no TypeScript link writes, although the store holds them; the cause was not traced, and the cold comparison below uses `measure.mjs` instead, which counts every statement.
- `cold-on-disk.md`: cold indexes on disk, main and head at the same time (`scripts/store-cost/disk-batch.sh`, table by `scripts/link-writes/cold-table.mjs`), and the row comparisons: the timed head build, then the final build.
- `{restic,helix}.seeded-edits.{main,head}.json`: 30 seeded edits each (`random-edits.mjs`, seeds 5301 and 5302), each compared with a cold index.
- `{restic,helix}.edit-writes.json`: what those edits wrote, main against head, by store counter (`scripts/link-writes/edit-writes.mjs`).
