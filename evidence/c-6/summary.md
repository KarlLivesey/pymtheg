# C-6 evidence

All runs used the dev server's NVMe scratch disk (Btrfs). Other builders'
jobs shared the server, and its load varied from about 8 to 46 during these
runs, so timings are observations. Compare them only within one table. Main is
`62d071d` (before PR 13 merged). The branch is the C-6 change on that main;
the merge of main after PR 13 changes no store write path.

Files:

- `measure.mjs` runs the real `graph index` command (`executeGraph`) of a
  build from an empty graph with a fixed project id. It prints wall time, CPU,
  peak RSS, the time inside store write transactions and inside `COMMIT`, and
  a digest of every stored row (`digest.mjs`).
- `split.sh`, `compare.sh`, `evaluate.sh`, `concurrency.sh` and `large.sh`
  run it on the server.
- The raw lines are in `compare.jsonl`, `evaluate.jsonl`, `concurrency.jsonl`
  and `large.jsonl`; `summarize.mjs` makes the tables below from them.
- `concurrency.mjs` and `probe-child.mjs` make the concurrency probes.
- `compat.sh` runs the version steps; its output is `compat.log`.
- `stress.mjs` is a journal-switch stress run: two writers in short
  sessions, three read-only readers and two writable no-write queries, 300
  rounds each, on one file. The branch had no errors. (It was added after a
  first version, which switched at open rather than at the first write, failed
  an existing concurrent-writers test.)
- `sqlite-versions.sh` reads the SQLite bundled with each Node image; the
  table and the write-ahead-log reset bug are in `sqlite-versions.md`.
- `fetch-all.sh`, `detach.sh` and `queue.sh` are helpers.

The section 1 repositories are at their sweep commits (`sweep/repos.json`).
The section 2 restic runs used the server's pinned restic corpus (`c734245`),
and Vector is the pinned server corpus (`515e87d9`).

## 1. Where cold time goes, and main against the branch

One session. For each repository: main, the branch, then main again. Each run
is a cold index of a fresh copy at the sweep commit; Vector is the pinned
server corpus.

| Repository | Main, run 1 | Main, run 2 | Branch | Peak RSS MiB (main 1 / main 2 → branch) | Commits |
| --- | --- | --- | --- | --- | --- |
| restic/restic | 74.6 s (39% / 82%) | 106.2 s (43% / 85%) | 60.1 s (18% / 77%) | 777 / 766 → 768 | 931 |
| cli/cli | 353 s (32% / 83%) | 286.7 s (37% / 83%) | 253.3 s (26% / 80%) | 2224 / 1807 → 1993 | 2018 |
| honojs/hono | 61.5 s (26% / 51%) | 68.4 s (24% / 52%) | 55.6 s (12% / 47%) | 1631 / 1530 → 1543 | 924 |
| excalidraw/excalidraw | 199.6 s (43% / 80%) | 287.5 s (52% / 84%) | 105.9 s (14% / 55%) | 1785 / 1639 → 2226 | 1470 |
| helix-editor/helix | 183.6 s (23% / 68%) | 222.3 s (30% / 75%) | 157.8 s (20% / 63%) | 1156 / 914 → 1129 | 542 |
| ratatui/ratatui | 161.1 s (35% / 73%) | 99.5 s (23% / 54%) | 74.9 s (12% / 48%) | 865 / 895 → 848 | 504 |
| vector | 3237.5 s (40% / 90%) | 1825.2 s (34% / 82%) | 938.8 s (30% / 66%) | 2942 / 2908 → 3067 | 3173 |

Cells: cold wall time (share of it in COMMIT / inside store write transactions).

Every stored row of every table is equal between main and the branch, and
between main's two runs. That covers files, symbols, links, candidates,
library targets, parse-failure markers, contexts, `graph_meta` including the
completion record, and the schema objects:

| Repository | Main 1 = main 2 | Main 1 = branch | Rows (branch) |
| --- | --- | --- | --- |
| restic/restic | equal | equal | candidates 9336, contexts 1, files 559, library_targets 0, links 64165, meta 3, parse_failures 0, symbols 8092 |
| cli/cli | equal | equal | candidates 8479, contexts 7, files 1191, library_targets 0, links 218286, meta 3, parse_failures 0, symbols 28058 |
| honojs/hono | equal | equal | candidates 25, contexts 39, files 460, library_targets 0, links 72340, meta 3, parse_failures 0, symbols 4638 |
| excalidraw/excalidraw | equal | equal | candidates 0, contexts 24, files 733, library_targets 0, links 104519, meta 3, parse_failures 0, symbols 8245 |
| helix-editor/helix | equal | equal | candidates 60, contexts 16, files 269, library_targets 0, links 86285, meta 3, parse_failures 0, symbols 8453 |
| ratatui/ratatui | equal | equal | candidates 8, contexts 46, files 250, library_targets 0, links 57390, meta 3, parse_failures 0, symbols 5802 |
| vector | equal | equal | candidates 200, contexts 47, files 1585, library_targets 0, links 393725, meta 3, parse_failures 5, symbols 35910 |

On main, `COMMIT` alone is 23–52 % of cold time. With the branch it is 12–30 %,
and that remainder is no longer syncs. In the option evaluation (section 2),
syncing nothing at all gives the same times as the branch. What remains is the
log write volume and statement work.

Vector's three runs overlapped the Embassy runs of section 6 (load about 43),
so they are the noisiest rows. The other six ran before those started.

Peak RSS varies by a few hundred MiB between runs of the same build (main
against main). The branch keeps the same rows and statements, so memory is not
expected to change.

## 2. Options, measured on main's build

Only the connection settings changed (`measure.mjs` variants). The first three
restic rows ran in a busy period; on main's own settings, restic took 692 s
then (671 s in write transactions, 428 s in `COMMIT`, 32 s of user CPU). The
other rows ran in quieter periods. Compare within a repository and a period.

Variants:

- `asis`: main's settings (rollback journal, full sync).
- `wal-normal` and `wal-full`: a write-ahead log with `synchronous=NORMAL` or
  `FULL`.
- `-ck<N>`: a checkpoint every N pages; SQLite's default is 1,000.
- `wal-off` and `sync-off`: no sync at all, with and without the log.
  These are lower bounds, not candidates.
- `batch-<B>`: B file writes per commit.
- `-cache<M>`: an M MiB page cache.

| Repository | Variant (main's build) | Wall s | In transactions s | In COMMIT s | Commits | Sys CPU s |
| --- | --- | --- | --- | --- | --- | --- |
| restic | asis | 692.3 | 671.1 | 427.5 | 931 | 100.8 |
| restic | wal-normal | 344.2 | 320.6 | 205.8 | 931 | 75.7 |
| restic | wal-full | 530.7 | 506.2 | 368.7 | 931 | 97.3 |
| restic | sync-off | 79.8 | 59.7 | 8.9 | 931 | 30.6 |
| restic | wal-normal | 72.8 | 59.7 | 26.5 | 931 | 47.6 |
| restic | wal-normal-ck10000 | 52.3 | 39.5 | 10.4 | 931 | 32.6 |
| restic | wal-normal-ck100000 | 52.2 | 39.1 | 7 | 931 | 31.9 |
| restic | wal-off | 53.3 | 41 | 6.2 | 931 | 33 |
| restic | batch-64 | 108.9 | 96.1 | 13.4 | 17 | 49.5 |
| cli/cli | wal-normal-ck10000 | 235.9 | 186.8 | 58.7 | 2018 | 145.4 |
| cli/cli | wal-normal-ck100000 | 241.8 | 189.1 | 27.7 | 2018 | 134.7 |
| cli/cli | wal-off | 247.4 | 191 | 37.1 | 2018 | 132.9 |
| cli/cli | batch-16-ck10000 | 342.3 | 283.5 | 52.2 | 128 | 199.3 |
| cli/cli | wal-normal-ck10000-cache64 | 268 | 215.4 | 102.6 | 2018 | 126.6 |
| cli/cli | wal-normal-ck10000 | 251.5 | 202.2 | 65.5 | 2018 | 140.5 |

## 3. Readers and second writers during a cold Vector index

`concurrency.mjs` (after W3-P1's) cold-indexes Vector. Every 100 file writes
(counted, not timed) it starts four separate processes, each with the normal
30-second writer wait:

- the real `graph status`;
- the real `graph search Event --no-sync`;
- a writable store open and close;
- a writable open that makes one graph write and closes.

| Build | Index wall | Writes | `status` failed | `search --no-sync` failed | Writable open failed | Open + write failed |
| --- | --- | --- | --- | --- | --- | --- |
| main | 2497 s | 3123 | 0/32 (slowest 19.5 s) | 0/32 (slowest 22.4 s) | 7/32 (slowest 44.2 s) | 6/32 (slowest 32.1 s) |
| branch | 916 s | 3123 | 0/32 (slowest 3.9 s) | 0/32 (slowest 4.3 s) | 0/32 (slowest 3.1 s) | 0/32 (slowest 3.1 s) |

Both runs shared the server with the swc runs of section 6 (load about 35).
Every main failure is `database is locked` after the full 30-second wait.

- **Main.** Readers kept working, but 13 of 64 second writers ran out of
  their 30-second wait on this loaded disk. W3-P1 measured 0 of 32 on a
  quieter server.
- **Branch.** Every probe succeeded, and the slowest took 4.3 s. With one
  commit per file, a writer holds the lock for the same writes as on main,
  but each commit no longer waits for the disk.

## 4. Kill and recover

Deterministic, in `test/graph-write-ahead-log.test.mjs`:

- **Four kill points** (SIGKILL in a child process at a store call): after the
  writable open, inside a file's write transaction, after resolution is
  written, after the completion record is committed. The next index makes
  every stored row equal to a clean index of the same files.
- **Two power-loss cases.** In the cold case the unsynced log is cut
  mid-frame; in the case after an edit the whole log is lost. The test first
  shows that nothing of the run reached the database file, so any cut of the
  log is a state a power loss can leave.

A real index killed with its log in place is also in `compat.log`.

## 5. Builds and versions

`compat.sh` runs on a copy of restic's `internal/restic` package, with
`pymtheg@0.1.0` from npm, main and the branch. The steps are in `compat.log`.

- 0.1.0's schema-3 store is read by the branch and upgraded in place.
- Main and the branch each read and update the other's store; at rest the
  format is the rollback journal.
- 0.1.0 refuses a schema-4 store with the same message for main's and the
  branch's, including one killed mid-index with its log in place.
- Main and the branch read a killed store as incomplete and repair it.

The branch here is the merged head, which includes PR 13. Its language-module
versions differ from main `62d071d`'s, so each build reads the other's
completed store as incomplete (not current for its own modules) and re-indexes
it, as it would for any module version change.

## 6. Embassy and swc with PR 13

PR 13 (Rust workers; head `acc7fa48`, since merged into main) merged into
main `62d071d` (base), and into this branch (C-6). Each is a cold index under
the sweep's 60-minute allowance, run while other measurements shared the
server.

| Repository | Build | Outcome | Wall s | In COMMIT s | In transactions s | Peak RSS MiB | Stored: files / links (or file rows:digest) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| embassy-rs/embassy | c6 | complete | 1917.6 | 520.6 | 1049.6 | 3437 | 2514 / 500862 |
| embassy-rs/embassy | base | complete | 2899.7 | 805.4 | 1989.3 | 3815 | 2514 / 500862 |
| swc-project/swc | c6 | JavaScript heap out of memory (exit 134) | 2763 | – | – | – | 51681:ec562c5e0b011bba |
| swc-project/swc | base | not finished in 60 min | 3600 | – | – | – | unreadable |

- **Embassy** completes with both builds; the time is the cold `graph index`
  alone. Both stores are equal row for row. Exit 2 is the one failed source
  file, the same as in C-1's evidence.
  - With C-6: 1,918 s.
  - Base: 2,900 s.

  The sweep's 60 minutes also covers `init`, a warm index and the queries, so
  the margin matters.
- **swc with C-6** gets through the phase that stopped PR 13's own runs (C-1
  evidence: wall limit while writing analysed Rust facts). All 51,681 files
  and the 394,584 Rust links are stored. At 2,709 s the process then runs out
  of Node's default JavaScript heap (about 4 GB, `FATAL ERROR: Ineffective
  mark-compacts near heap limit`). That happens in a later phase, most likely
  the TypeScript analysis of swc's 50,158 TypeScript and JavaScript files,
  which runs next.
- **The base swc run** was still writing at the 60-minute limit: 90 MB of
  graph after 30 minutes, against 1.1 GB stored by the C-6 run. Its store was
  left with a hot rollback journal, which a read-only open cannot replay
  ("unreadable" above); the next writable open repairs it.
