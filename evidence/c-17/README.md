# C-17 evidence

Go members of standard-library types, source-only, from a shipped table.
Change note: `docs/changes/C-17.md`.

All runs used the sweep runner (`scripts/sweep/run.mjs --local-build`) on
the 20 Go repositories of `sweep/repos.json` at their pinned commits, once
with a build of `main` at `981b20d` (C-14 merged; **base**) and once with
this branch (**candidate**), in one scratch folder on the same storage, six
workers each. Every repository finished in both. Coverage exports use the
base build's readers for both; scoreboards are `coverage.mjs` over those
exports alone (`scoreboard-base.md`, `scoreboard-candidate.md`).

## Level 2, Go

| Repository | Links | New member links | Level 2 before | Level 2 after |
| --- | ---: | ---: | ---: | ---: |
| charmbracelet/bubbletea | 12,533 | 674 | 81.33% | 86.71% |
| cilium/ebpf | 50,239 | 2,619 | 87.15% | 92.36% |
| cli/cli | 218,286 | 9,606 | 85.68% | 90.08% |
| cockroachdb/pebble | 214,346 | 7,959 | 86.11% | 89.82% |
| etcd-io/bbolt | 16,898 | 1,410 | 84.75% | 93.09% |
| evanw/esbuild | 118,250 | 1,018 | 94.98% | 95.84% |
| gin-gonic/gin | 21,081 | 2,209 | 83.01% | 93.49% |
| go-task/task | 18,984 | 1,407 | 84.16% | 91.57% |
| gofiber/fiber | 143,673 | 13,189 | 78.12% | 87.30% |
| golang/tools | 253,517 | 27,740 | 81.29% | 92.23% |
| junegunn/fzf | 25,947 | 986 | 85.74% | 89.54% |
| labstack/echo | 31,880 | 3,341 | 84.69% | 95.17% |
| mattn/go-sqlite3 | 9,650 | 2,366 | 59.58% | 84.09% |
| pocketbase/pocketbase | 197,148 | 6,674 | 62.94% | 66.33% |
| protocolbuffers/protobuf-go | 217,087 | 3,752 | 86.83% | 88.56% |
| restic/restic | 64,165 | 4,018 | 84.42% | 90.68% |
| samber/lo | 29,697 | 3,585 | 73.84% | 85.91% |
| spf13/cobra | 8,886 | 889 | 82.20% | 92.20% |
| stretchr/testify | 19,868 | 1,760 | 84.44% | 93.30% |
| wagoodman/dive | 14,901 | 755 | 81.91% | 86.98% |
| **Go module, 20 pins** | 1,512,998 Go links | **95,957** | **84.87%** | **91.22%** |

Repository rows count every module of the checkout (pocketbase, esbuild and
cli/cli also hold JavaScript or TypeScript, unchanged here; their base rows
include C-11's TypeScript changes, so some differ from C-14's table). The
Go module row counts Go links only. **All sites and like-for-like are the
same figure**: no site or row was added or removed (1,512,998 stored Go
links at 1,512,591 sites in both runs).

The 95,957 new links all carry `declaring-owner` evidence, ecosystem
`go-std`. Of them about 7,900 are methods of a standard-library interface
(`io.Reader.Read`, `io.Closer.Close`), 1,649 are `builtin` `error.Error`,
and about 20,500 have an unexported declaring owner (almost all
`testing` `common.*`: `t.Fatal`, `t.Errorf`). The most frequent:
`testing` `T.Parallel` 7,437, `T.Run` 6,486, `common.Errorf` 5,145,
`common.Fatalf` 4,541, `common.Fatal` 4,528, `bytes` `Buffer.String` 1,937,
`builtin` `error.Error` 1,649, `sync` `Mutex.Unlock` 1,614 and
`Mutex.Lock` 1,516.

Links with `library-member-unproven`: 111,406 → **20,158**.

## Nothing lost

`compare.mjs` (C-14's comparison, extended to report any library row that
changes) compares every stored Go row and every Go symbol of all 20 pins. A
row is identified by its site (file, kind, range, target name) and its
relation (checkout target, the candidate set's members, or the library
targets); rows at one site are matched as a multiset
(`site-comparison.json`).

| | |
| --- | ---: |
| Checkout-definite links before → after | 1,023,393 → 1,023,393 |
| Lost or retargeted | 0 |
| Candidate sets changed | 0 |
| Library targets changed | 0 |
| Sites added or removed | 0 |
| Symbols missing | 0 of 200,941 |
| Stored Go rows before → after | 1,512,998 → 1,512,998 |

The chunk adds no symbols and no sites, so symbol keys are unchanged on all
20 pins and no requirement link can change anchor. (The comparison's
`reconstructed*` fields count main's 0.1.0 coverage reconstruction, which
neither build uses for Go from module 30; they are the same 119 sites C-14
explained.)

**Unresolved Go links after, by recorded reason:** 43,180 with none recorded
(mostly receivers whose type the source does not show), 20,158
`library-member-unproven` (third-party types, and standard-library members
the table does not settle), 196 `declarations-may-be-unseen`, 149 failed
(invalid code).

## Toolchain agreement

`toolchain-agree.mjs` indexes writable copies of the pinned checkouts with
this branch's build source-only and with `graph.toolchain.go` on, and
compares EVERY link the source-only route resolves from the table with the
toolchain run's link at the same site (`toolchain-*.json`):

| Pin | Table-resolved | Decided by go/types | Agree | Disagree | No go/types fact |
| --- | ---: | ---: | ---: | ---: | ---: |
| etcd-io/bbolt | 1,410 | 1,394 | 1,394 | 0 | 16 |
| spf13/cobra | 889 | 758 | 758 | 0 | 131 |
| restic/restic | 4,018 | 1,261 | 1,261 | 0 | 2,757 |
| stretchr/testify | 1,760 | 1,445 | 1,445 | 0 | 315 |
| **All four** | **8,077** | **4,858** | **4,858** | **0** | 3,219 |

"Decided by go/types" means the toolchain run's link records toolchain
provenance with a library target; every one names the same unit and
symbol. Where go/types has no fact (a package whose import closure was not
clean in the toolchain's one configuration, linux/amd64 without cgo; on
restic 70 of 142 packages were clean because dependencies were missing
from the offline module cache, and files of other platforms), the toolchain
run keeps the table's answer, so those are not counted as agreement. The
toolchain named a standard-library owner where the table resolved nothing
on 17 (bbolt) and 78 (restic) links.

## Hand-check: 40 new links

Seed `c-17`, drawn from the newly stored `declaring-owner` links of restic,
cli/cli, pebble, gin and samber/lo (`site-comparison.json` `sample`).
`verify-sample.mjs` printed, from each pinned checkout, the source line, the
lines declaring the receiver, the imports, and `go doc` (Go 1.27.4) for the
recorded owner and member (`verify-sample.txt`). Receivers that come
through checkout code were checked in the pinned source: cli/cli
`iostreams.Test()` returns `*bytes.Buffer` streams; pebble
`failoverWriter.mu`, `DB.mu` and `shard.mu` are structs embedding
`sync.Mutex` with no other `Lock`/`Unlock`; pebble
`syncFileWithError` embeds the checkout `syncFile`, whose `syncPos` is an
`atomic.Int64`; restic `rateEstimator.buckets` is a `*list.List`,
`locker.refreshabilityTimeout` a `time.Duration`; gin
`CreateTestContext` returns a `*Context` whose `Request` is an
`*http.Request`; `errorfs.ParseDSL`, pebble's `Open`, `CheckOrdering` and
cli/cli's `newAsset` return `error`; restic (go 1.26) and pebble (go 1.25)
are new enough for `t.Context` (Go 1.24).

**All 40 are true.**

| # | Repository | File:line | Link | Recorded |
| ---: | --- | --- | --- | --- |
| 1 | cockroachdb/pebble | wal/failover_writer_test.go:317 | `err.Error` | builtin `error.Error` |
| 2 | cli/cli | pkg/cmd/pr/shared/survey_test.go:78 | `stderr.String` | bytes `Buffer.String` |
| 3 | cli/cli | pkg/cmd/skills/publish/publish_test.go:36 | `remoteLines.String` | strings `Builder.String` |
| 4 | cockroachdb/pebble | wal/failover_writer.go:783 | `ww.mu.Lock` | sync `Mutex.Lock` |
| 5 | cockroachdb/pebble | version_set_test.go:313 | `t.Logf` | testing `common.Logf` |
| 6 | gin-gonic/gin | context.go:1350 | `c.Request.URL.Path` | net/url `URL.Path` |
| 7 | gin-gonic/gin | context.go:1350 | `c.Request.URL` | net/http `Request.URL` |
| 8 | cockroachdb/pebble | sstable/tablefilters/bloom/bloom_test.go:123 | `t.Errorf` | testing `common.Errorf` |
| 9 | cli/cli | script/ghmock/gittransport.go:105 | `r.Body` | net/http `Request.Body` |
| 10 | cli/cli | pkg/cmd/pr/shared/finder.go:89 | `t.Cleanup` | testing `common.Cleanup` |
| 11 | cockroachdb/pebble | compaction_test.go:2082 | `d.mu.Unlock` | sync `Mutex.Unlock` |
| 12 | cockroachdb/pebble | db_test.go:1985 | `rng.Int` | math/rand/v2 `Rand.Int` |
| 13 | restic/restic | internal/backend/rest/rest.go:99 | `url.Query` | net/url `URL.Query` |
| 14 | restic/restic | internal/ui/termstatus/stdio_wrapper_test.go:69 | `t.Fatal` | testing `common.Fatal` |
| 15 | restic/restic | internal/repository/lock.go:221 | `l.refreshabilityTimeout.Nanoseconds` | time `Duration.Nanoseconds` |
| 16 | gin-gonic/gin | binding/form_mapping.go:435 | `structField.Tag.Get` | reflect `StructTag.Get` |
| 17 | cockroachdb/pebble | open_test.go:79 | `err.Error` | builtin `error.Error` |
| 18 | cockroachdb/pebble | objstorage/objstorageprovider/sharedcache/shared_cache.go:746 | `s.mu.Unlock` | sync `Mutex.Unlock` |
| 19 | restic/restic | internal/archiver/archiver_test.go:352 | `b.StopTimer` | testing `B.StopTimer` |
| 20 | cli/cli | pkg/cmd/repo/clone/clone.go:144 | `repoURL.Scheme` | net/url `URL.Scheme` |
| 21 | samber/lo | it/math_test.go:184 | `t.Parallel` | testing `T.Parallel` |
| 22 | cli/cli | internal/attachments/userasset_test.go:266 | `err.Error` | builtin `error.Error` |
| 23 | gin-gonic/gin | context_test.go:2011 | `c.Request.Header.Add` | net/http `Header.Add` |
| 24 | restic/restic | internal/backend/azure/azure_test.go:144 | `t.Context` | testing `common.Context` |
| 25 | restic/restic | internal/backend/azure/azure_test.go:194 | `t.Fatal` | testing `common.Fatal` |
| 26 | samber/lo | map_test.go:880 | `t.Run` | testing `T.Run` |
| 27 | cli/cli | script/ghmock/set_test.go:631 | `t.TempDir` | testing `common.TempDir` |
| 28 | restic/restic | internal/repository/upgrade_repo_test.go:64 | `t.TempDir` | testing `common.TempDir` |
| 29 | cli/cli | .github/skills/cli-exercise/tool/internal/execution/cli.go:199 | `entry.Name` | io/fs `DirEntry.Name` |
| 30 | restic/restic | internal/dump/zip_test.go:86 | `f.Name` | archive/zip `FileHeader.Name` |
| 31 | gin-gonic/gin | routes_test.go:541 | `w.Body` | net/http/httptest `ResponseRecorder.Body` |
| 32 | cockroachdb/pebble | internal/rangekeystack/user_iterator_test.go:35 | `buf.Reset` | bytes `Buffer.Reset` |
| 33 | cli/cli | script/api-host-gateway/gateway/main.go:302 | `r.file.Write` | os `File.Write` |
| 34 | restic/restic | internal/ui/backup/rate_estimator.go:49 | `r.buckets.Front` | container/list `List.Front` |
| 35 | cockroachdb/pebble | checkpoint_test.go:303 | `t.Context` | testing `common.Context` |
| 36 | cockroachdb/pebble | internal/manifest/l0_sublevels_test.go:463 | `err.Error` | builtin `error.Error` |
| 37 | cockroachdb/pebble | record/log_writer_test.go:726 | `f.syncPos.Load` | sync/atomic `Int64.Load` |
| 38 | samber/lo | find_test.go:716 | `t.Run` | testing `T.Run` |
| 39 | samber/lo | type_manipulation_test.go:183 | `t.Parallel` | testing `T.Parallel` |
| 40 | cockroachdb/pebble | internal/lint/lint_test.go:250 | `t.Error` | testing `common.Error` |

## The table

`scripts/go-stdlib/generate.go`, run on the dev server with Go 1.27.4:
47 platforms (`go tool dist list`, cgo off), 179 importable packages plus
`builtin`'s `error`; 1,102 exported named types, 14 aliases, 3,569 methods
and 2,473 fields in method sets (promoted ones included), 40 members
uncertain (not the same on every platform, or ambiguous at their depth),
1,826 functions and 2,813 variables and typed constants. 401,513 bytes of
text, **70,210 bytes gzip-compressed** as shipped. The generator is
deterministic (sorted output); a re-run changed only the line it was fixed
for.

**Load time** (dev server, fresh process, three runs): import of the module
8–12 ms, reading, decompressing and parsing the table 39–47 ms, once per
process and only when a Go project is resolved (or `graph uses` asks for a
`Type.Member` of a standard package). Heap after loading about 10 MB.

## Cost

`timing.sh` (C-14's): cold index, builds interleaved in one session, project
and store in memory-backed storage, `main` twice (`timing.txt`).
Observations:

| Repository | main user CPU (s) | branch user CPU (s) | main wall (s) | branch wall (s) | Peak RSS (MB) main / branch |
| --- | ---: | ---: | ---: | ---: | --- |
| restic/restic | 26.96, 28.68 | 27.24, 29.10 | 51.3, 48.6 | 50.1, 52.3 | 753, 716 / 713, 713 |
| etcd-io/bbolt | 8.08, 7.78 | 8.58, 8.16 | 16.9, 12.8 | 15.1, 13.2 | 386, 380 / 369, 372 |

User CPU about +1% (restic) and +5% (bbolt), within main's own spread of
6%; wall time and peak memory unchanged. The extra time was not profiled
separately: the new work is the table load (about 50 ms) and about 96,000
more library rows written (C-14's profile put its +8–16% in writing about
293,000 such rows, so a third of that is the expected share here).

## Files

- `compare.mjs`, `site-comparison.json`: every link and symbol, both runs.
- `scoreboard-base.md`, `scoreboard-candidate.md`.
- `toolchain-agree.mjs`, `toolchain-*.json`: the agreement runs.
- `verify-sample.mjs`, `verify-sample.txt`: the hand-check.
- `timing.sh`, `timing.txt`.
- `coverage-plan-input.json.gz`: C-14's plan input
  (`evidence/c-14/coverage-plan-input.json.gz`) with these 20 Go pins laid
  over it (`evidence/c-8/plan-base.mjs`). Regenerating with it and the SW-3
  base gives the Go section committed in `docs/coverage-plan.md` (89.79%);
  main's other sections were made from inputs that are not all archived, so
  only the Go section was replaced.
