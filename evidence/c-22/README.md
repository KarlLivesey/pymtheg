# C-22 evidence

Measurements for [the change note](../../docs/changes/C-22.md). Produced on
the dev server with the scripts in `scripts/reindex/`; no checkouts or
stores are kept here.

| path | what |
|---|---|
| `before/<pin>.summary.json` | merged main plus the counters only: cold, warm and the three edits, each with its reverted re-index, per-index counts, stage times, CPU, peak memory and report; `equality` lists differences from the cold store after each revert (all empty) |
| `after/<pin>.summary.json` | the same with this change |
| `main-1/`, `main-2/` | main itself (no counters), run twice on restic and hono: times and reports only |
| `random-ripgrep.json`, `random-restic.json` | 20 seeded single-file edits each, incremental store against a cold store of the same tree after every edit |
| `same-cold/<pin>.json` | a cold index of each pin by the before and the after build into stores with the same project id: row counts and differences (none) |
| `no-edit/<case>.json` | re-index with no edit: two warm stores and a second cold store, each compared with the first cold store (trpc bare and installed, before and after the fix; hono installed; restic and ripgrep bare) |
| `installed-race/churn-main-code.json`, `churn-fixed.json` | trpc installed: a warm re-index while another hard link to each `expect-type` declaration is added and removed (inode metadata only), compared with the cold store, on main's `dependency-inputs` code and with the fix |
| `cold-cost.json` | cold-index time and peak memory, main and after alternating, one run at a time |
| `profiles/body-edit.*.txt` | CPU profile summaries (main thread) of the two slowest edits, trpc and cli/cli body edits, before and after |

Pins (`sweep/repos.json`): restic/restic `74f0028`, cli/cli `42d52b4`,
honojs/hono `676c8f8`, trpc/trpc `1abda6c`, BurntSushi/ripgrep `178cc02`,
helix-editor/helix `872b240`.

## Stage breakdowns for the other edits (CPU seconds, before → after)

The body edit is in the change note.

| stage (CPU s, comment edit, before → after) | ripgrep | cli/cli | helix | hono | restic | trpc |
|---|--:|--:|--:|--:|--:|--:|
| hash every source (inventory ×2, capture) | 0.3 → 0.3 | 2.2 → 2.3 | 1.1 → 1.1 | 1.1 → 1.3 | 1.1 → 1.2 | 2.6 → 2.6 |
| decode each stored record for its hash | 0.3 → 0.3 | 1.4 → 1.5 | 0.6 → 0.7 | 0.4 → 0.3 | 0.4 → 0.5 | 0.5 → 0.5 |
| parse changed files | 1.0 → 1.0 | 0.2 → 0.2 | 0.6 → 0.6 | 0.0 → 0.0 | 0.2 → 0.2 | 0.0 → 0.0 |
| write parsed files | 0.4 → 0.7 | 0.1 → 0.1 | 0.2 → 0.1 | 0.1 → 0.2 | 0.1 → 0.1 | 0.2 → 0.2 |
| read analysis input | 1.1 → 0.5 | 5.3 → 2.4 | 2.0 → 1.2 | 1.0 → 0.6 | 0.8 → 0.7 | 1.7 → 0.9 |
| language analysis | 5.5 → 5.6 | 10.7 → 12.1 | 18.0 → 20.2 | 59.3 → 61.9 | 4.3 → 4.4 | 48.3 → 49.0 |
| write changed analysis results | 0.7 → 0.7 | 0.0 → 0.0 | 0.6 → 0.6 | 0.4 → 0.3 | 0.0 → 0.0 | 0.3 → 0.3 |
| read resolver input | 2.0 → 1.1 | 12.0 → 9.6 | 4.5 → 4.0 | 3.3 → 1.8 | 3.3 → 1.9 | 5.1 → 2.5 |
| language resolution | 6.2 → 5.9 | 7.8 → 10.8 | 21.7 → 23.4 | 0.4 → 0.3 | 2.6 → 2.7 | 0.6 → 1.1 |
| validate resolution | 0.5 → 0.4 | 2.5 → 2.9 | 0.9 → 0.5 | 0.7 → 0.6 | 0.9 → 1.2 | 1.5 → 1.0 |
| compare and write links | 2.0 → 0.6 | 13.7 → 1.5 | 3.6 → 0.5 | 3.1 → 0.6 | 3.7 → 0.3 | 5.5 → 0.6 |
| report and metadata | 0.2 → 0.2 | 0.7 → 0.7 | 0.3 → 0.3 | 0.2 → 0.2 | 0.2 → 0.2 | 0.2 → 0.2 |
| other: validation reads (unstaged), process start, store open, checkpoint | 1.6 → 2.1 | 8.6 → 11.2 | 3.6 → 4.0 | 3.0 → 3.3 | 3.5 → 3.1 | 5.0 → 4.8 |
| **total** | 21.8 → 19.5 | 65.0 → 55.3 | 57.8 → 57.2 | 73.0 → 71.4 | 21.1 → 16.3 | 71.5 → 63.7 |

| stage (CPU s, export edit, before → after) | ripgrep | cli/cli | helix | hono | restic | trpc |
|---|--:|--:|--:|--:|--:|--:|
| hash every source (inventory ×2, capture) | 0.3 → 0.4 | 2.4 → 2.3 | 1.2 → 1.2 | 1.3 → 1.4 | 1.2 → 1.3 | 3.0 → 3.1 |
| decode each stored record for its hash | 0.3 → 0.3 | 1.5 → 1.5 | 0.7 → 0.7 | 0.5 → 0.3 | 0.4 → 0.4 | 0.6 → 0.5 |
| parse changed files | 1.0 → 1.1 | 0.2 → 0.2 | 0.5 → 0.6 | 0.0 → 0.0 | 0.2 → 0.2 | 0.0 → 0.0 |
| write parsed files | 0.5 → 0.4 | 0.1 → 0.1 | 0.1 → 0.4 | 0.1 → 0.1 | 0.1 → 0.1 | 0.1 → 0.2 |
| read analysis input | 0.8 → 0.5 | 4.9 → 2.7 | 2.4 → 1.2 | 1.4 → 0.6 | 0.9 → 0.6 | 1.9 → 1.0 |
| language analysis | 6.1 → 6.4 | 12.0 → 12.2 | 24.2 → 24.0 | 66.8 → 62.6 | 4.9 → 4.7 | 57.7 → 55.6 |
| write changed analysis results | 0.7 → 0.5 | 0.0 → 0.0 | 0.7 → 0.6 | 0.2 → 0.3 | 0.0 → 0.0 | 0.4 → 0.5 |
| read resolver input | 2.0 → 1.5 | 15.1 → 8.6 | 5.2 → 4.4 | 3.0 → 1.7 | 3.4 → 1.9 | 5.3 → 3.5 |
| language resolution | 6.8 → 6.8 | 10.9 → 10.0 | 26.6 → 25.5 | 0.5 → 0.4 | 2.8 → 3.0 | 0.8 → 0.7 |
| validate resolution | 0.6 → 0.4 | 2.5 → 2.2 | 1.0 → 0.9 | 0.9 → 0.8 | 0.9 → 0.7 | 1.5 → 1.1 |
| compare and write links | 2.0 → 0.5 | 15.3 → 1.3 | 4.0 → 0.5 | 3.6 → 0.5 | 4.5 → 0.5 | 6.1 → 0.9 |
| report and metadata | 0.2 → 0.2 | 0.7 → 0.6 | 0.4 → 0.3 | 0.2 → 0.5 | 0.2 → 0.2 | 0.3 → 0.4 |
| other: validation reads (unstaged), process start, store open, checkpoint | 1.7 → 2.0 | 12.0 → 9.9 | 3.7 → 4.3 | 2.8 → 2.8 | 3.6 → 3.1 | 6.0 → 7.4 |
| **total** | 22.9 → 21.0 | 77.7 → 51.7 | 70.6 → 64.5 | 81.1 → 72.0 | 23.2 → 16.8 | 83.5 → 74.8 |

| stage (CPU s, warm edit, before → after) | ripgrep | cli/cli | helix | hono | restic | trpc |
|---|--:|--:|--:|--:|--:|--:|
| hash every source (inventory ×2, capture) | 0.3 → 0.3 | 2.1 → 2.2 | 1.1 → 1.1 | 0.8 → 0.9 | 1.1 → 1.2 | 3.3 → 3.0 |
| decode each stored record for its hash | 0.3 → 0.3 | 1.4 → 1.4 | 0.7 → 0.7 | 0.4 → 0.4 | 0.4 → 0.4 | 0.6 → 0.5 |
| parse changed files | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| write parsed files | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| read analysis input | 1.1 → 0.5 | 4.6 → 2.5 | 1.8 → 1.3 | 1.2 → 0.6 | 0.8 → 0.7 | 1.7 → 0.8 |
| language analysis | 5.6 → 5.8 | 11.8 → 13.2 | 19.4 → 18.6 | 0.0 → 0.0 | 4.5 → 4.8 | 49.3 → 49.6 |
| write changed analysis results | 0.3 → 0.2 | 0.0 → 0.0 | 0.4 → 0.5 | 0.2 → 0.4 | 0.0 → 0.0 | 0.3 → 0.3 |
| read resolver input | 1.9 → 1.3 | 11.8 → 8.5 | 4.3 → 4.0 | 2.9 → 2.0 | 3.4 → 1.8 | 5.2 → 2.8 |
| language resolution | 6.2 → 6.1 | 8.3 → 9.3 | 20.1 → 20.3 | 0.4 → 0.5 | 2.6 → 3.2 | 0.6 → 0.5 |
| validate resolution | 0.5 → 0.4 | 2.0 → 2.2 | 0.5 → 0.5 | 0.8 → 0.7 | 0.7 → 1.2 | 1.0 → 0.9 |
| compare and write links | 2.0 → 0.5 | 13.4 → 1.8 | 4.5 → 1.1 | 3.5 → 0.8 | 3.6 → 0.6 | 5.4 → 0.7 |
| report and metadata | 0.2 → 0.2 | 0.7 → 0.7 | 0.3 → 0.3 | 0.2 → 0.2 | 0.2 → 0.2 | 0.2 → 0.2 |
| other: validation reads (unstaged), process start, store open, checkpoint | 1.9 → 1.8 | 8.1 → 10.0 | 4.0 → 4.0 | 2.9 → 3.2 | 2.9 → 3.5 | 5.4 → 5.6 |
| **total** | 20.3 → 17.4 | 64.2 → 51.9 | 57.2 → 52.3 | 13.4 → 9.6 | 20.2 → 17.6 | 73.0 → 65.1 |
