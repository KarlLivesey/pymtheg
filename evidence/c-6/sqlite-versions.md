# SQLite bundled with Node, and the write-ahead-log reset bug

**The bug** ([SQLite WAL documentation, "The WAL-Reset Bug"](https://sqlite.org/wal.html)):

- **What happens.** A database in write-ahead-log mode can be corrupted when
  two or more connections on the same file, in separate threads or processes,
  write or checkpoint at the same instant.
- **Affected:** SQLite 3.7.0 through 3.51.2. 3.52.0 (2026-03-06) is affected
  too: it predates the fix and was withdrawn.
- **Fixed:** 3.51.3 (2026-03-13), 3.53.0 and later, and the backports 3.50.7
  and 3.44.6.

Read with `evidence/c-6/sqlite-versions.sh` from the official
`node:<tag>-bookworm-slim` images on the dev server, 19 November 2026.
"Gate" marks the images the acceptance gate runs (`scripts/acceptance/run.mjs`).

| Node | SQLite | Write-ahead-log reset bug | Gate |
| --- | --- | --- | --- |
| 24.0.0 | 3.49.1 | affected | yes (lowest allowed by engines `>=24`) |
| 24.4.0 | 3.50.2 | affected | |
| 24.8.0 | 3.50.4 | affected | |
| 24.12.0 | 3.50.4 | affected | |
| 24.13.0 | 3.50.4 | affected | |
| 24.14.0, 24.14.1 | 3.51.2 | affected | |
| **24.15.0** | **3.51.3** | **fixed (first fixed 24.x)** | |
| 24.16.0, 24.17.0 | 3.53.0 | fixed | |
| 24.18.0 | 3.53.1 | fixed | |
| 24.19.0 | 3.53.3 | fixed | |
| 24.20.0 | 3.53.4 | fixed | |
| 24.21.0 | 3.53.4 | fixed | yes (build image) |
| 24.22.3 (`node:24`) | 3.54.1 | fixed | yes (current 24.x) |
| 25.0.0 | 3.50.4 | affected | |
| 25.4.0 | 3.51.1 | affected | |
| 25.6.0 to 25.8.0 | 3.51.2 | affected | |
| 25.8.1, 25.8.2 | 3.52.0 | affected (withdrawn release) | |
| **25.9.0** (`node:25`) | **3.51.3** | **fixed (first fixed 25.x)** | yes |
| 26.0.0 | 3.51.3 | fixed | |
| 26.1.0 | 3.53.0 | fixed | |
| 26.13.1 (`node:26`) | 3.54.1 | fixed | yes |

**Who gets the fast path.** Node 24.15.0 and later 24.x, Node 25.9.0 and
later, and every Node 26 release read here. Every other version keeps main's
rollback journal with a full sync per commit.

**The gate's `e-node-24.0.0` scenario takes the fallback.** In the
`node:24.0.0-bookworm-slim` image, `/tmp` is overlayfs (statfs type
`0x794c7630`, an allowed local type), and `writeAheadLogSafe("/tmp")` returns
`false` because SQLite 3.49.1 lacks the fix. `test/graph-write-ahead-log.test.mjs`
run in that image: 12 pass, 0 fail, and the 2 power-loss tests skip for lack of a log.
