# C-4 evidence

Items `go-container` and `go-fields`. Change note: `docs/changes/C-4.md`.
These figures are for the head after the first review round (owner-anchored
identities, per-variant selection with build constraints).

All runs used the sweep runner (`scripts/sweep/run.mjs --local-build`) on
the 20 Go repositories of `sweep/repos.json`, at their pinned commits, once
with a build of `main` (after C-2) (**base**) and once with this branch,
which has `main` merged (**candidate**). The coverage export and scoreboard
are `coverage-export.mjs` and
`coverage.mjs --base evidence/sw-3/breakdown.json.gz`.

Files:

- `scoreboard-base.md`, `scoreboard-candidate.md`: the scoreboards (the 20
  Go repositories over the SW-3 base).
- `coverage-base.json.gz`, `coverage-candidate.json.gz`: the exports.
- `site-comparison.json`: per-repository site comparison, symbol identity
  check and the seeded sample, from `compare.mjs` (sites keyed by file,
  kind, range and target name; symbols by file, kind and identity).
- `toolchain-agreement-restic.json`, from `toolchain-agreement.mjs`.
- `coverage-plan-input.json.gz`, `scoreboard-plan-input.md`: the export the
  plan's generated block was regenerated from (see below).

## The coverage plan block

`main` had moved on (C-2 and C-3 merged) and their exports were not
kept, so the block was regenerated from a build of this branch with `main`
merged, run on 40 pins: the 20 Go repositories and all 20 TypeScript pins
(including microsoft/TypeScript, whose checkout has Go code, and
vercel/turborepo), over the SW-3 base. The generated block then reads Go
76.81% → 79.11% (the 55 finished graphs, with the Go code of
microsoft/TypeScript), TypeScript / JS 52.90% → 56.43% and Rust unchanged
at 31.47%. The TypeScript change is not this chunk's: C-3 had rerun 13 of
the 20 TypeScript pins, and this run applies the same merged code to all 20.

## Level 2, Go

| Repository | Links before | Links after | Level 2 before | Level 2 after |
| --- | ---: | ---: | ---: | ---: |
| charmbracelet/bubbletea | 12,498 | 12,533 | 71.39% | 71.84% |
| cilium/ebpf | 49,614 | 50,239 | 76.24% | 77.95% |
| cli/cli | 207,303 | 218,062 | 68.55% | 74.92% |
| cockroachdb/pebble | 210,500 | 211,537 | 71.58% | 74.70% |
| etcd-io/bbolt | 16,741 | 16,898 | 73.35% | 75.78% |
| evanw/esbuild | 116,564 | 116,628 | 86.52% | 86.85% |
| gin-gonic/gin | 20,364 | 21,081 | 67.58% | 69.70% |
| go-task/task | 18,445 | 18,983 | 72.31% | 74.64% |
| gofiber/fiber | 139,671 | 143,673 | 62.05% | 66.15% |
| golang/tools | 251,402 | 253,389 | 72.76% | 74.06% |
| junegunn/fzf | 25,820 | 25,947 | 76.70% | 77.94% |
| labstack/echo | 30,180 | 31,880 | 67.84% | 74.74% |
| mattn/go-sqlite3 | 9,598 | 9,650 | 53.55% | 55.95% |
| pocketbase/pocketbase | 180,199 | 182,541 | 32.04% | 34.35% |
| protocolbuffers/protobuf-go | 216,552 | 217,087 | 81.63% | 82.98% |
| restic/restic | 63,408 | 64,165 | 76.54% | 79.12% |
| samber/lo | 27,801 | 29,693 | 54.62% | 62.73% |
| spf13/cobra | 8,792 | 8,886 | 76.94% | 78.45% |
| stretchr/testify | 19,521 | 19,868 | 76.67% | 79.22% |
| wagoodman/dive | 14,691 | 14,901 | 67.40% | 69.10% |
| **Go (finished graphs)** | 1,485,222 | 1,513,199 | **74.16%** | **77.10%** |

Links are all stored links of the repository, as in the scoreboard; the Go
total is the Go module's links. The base build's own runs differ slightly
from the SW-3 release figures (pocketbase 32.04% here, protobuf-go 81.63%):
`main` still resolved in an order that depended on the store (see the
change note).

**Both ways.** Every anonymous struct with a field is now a symbol, so the
graph gains `contains` links (always definite) and links for selectors that
had no link before (`z.A` on a `struct{…}` value). Counting all links,
Go level 2 is **77.10%**. Removing the 27,977 links at new sites from both
sides (27,949 of them definite), it is **76.67%**.

**Gross, replaced, net.** In the 20 repositories, checkout-definite Go links
went from 947,355 to 1,012,652:

| | Links |
| --- | ---: |
| Newly definite at sites that already had a link | 37,348 (34,858 references, 2,490 calls) |
| New `contains` links (new symbols) | 24,698 |
| New references at new sites | 3,251 |
| **Gross additions** | **65,297** |
| Replaced keys (a site whose target name changed) | 0 |
| Definite links lost or retargeted | 0 |
| **Net** | **65,297** |

The previous head reported 64,919 net (65,270 gross less 351 replaced
`contains` keys); those 351 were anonymous-struct identities that had been
re-scoped, which this head no longer does.

## Identities

`compare.mjs` checks every Go symbol of the base graph (file, kind,
identity) against the candidate: **176,250 symbols, 0 missing**. Every
anonymous struct that was a symbol before (one that embeds something) keeps
its 0.1.0 identity, including those nested inside field-only anonymous
structs (cli/cli `queries_repo.go:LastCommit.struct#1`) and those owned by a
field (restic `checker.go:Checker.blobRefs.struct#1`). New field-only ones
are `<owner>.anon#n`. `struct{}` is not a symbol.

## Sites that changed

No definite reference or call lost its target or changed target, and no
site was removed.

## Reference sites of the items

The plan's rows read `go-container` 29/33 reference sites settled,
`go-fields` 14/21. The 11 left:

| Site | Why it stays |
| --- | --- |
| bubbletea `examples/spinners/main.go:85` | `m.spinner.Spinner`: a field of an external type (bubbles) |
| cli/cli `.github/skills/cli-exercise/tool/…/raster.go:150`, `session_media.go:271`, `preflight/check.go:252` | a nested module; its types come through a cross-module import (item `go-typed-reference`) |
| fiber `middleware/cache/cache.go:1374` | ranges over `slices.Backward(…)`, an external iterator |
| golang/tools `cmd/html2article/conv.go:302` | `node.Attr` of `x/net/html` (external) |
| golang/tools `cmd/splitdwarf/internal/macho/file.go:166` | `s.Maxprot` at depth 1 beside an embedded `io.ReaderAt` (external), which could also supply an exported name there |
| golang/tools `go/ssa/interp/testdata/fieldprom.go:38` | `B` and `C` are declared twice in that directory (`fieldprom.go`, `methprom.go`) |
| golang/tools `gopls/internal/mcp/workspace.go:127`, `gopls/internal/work/hover.go:79` | fields of `modfile` types (external) |
| golang/tools `gopls/internal/test/marker/marker_test.go:985` | `file.Name` of a txtar file (external) |

The two protobuf-go hybrid sites (`test.hybrid.pb.go:2404`,
`test.hybrid_protoopaque.pb.go:5313`) are now settled: each file's own
variant is the declaration.

## Hand-check: 20 newly definite links

Drawn from the 40,599 newly definite calls and references with the fixed
seed `c-4` (lowest SHA-256 of seed, repository, file, offset, kind), read
against the pinned source. All 20 are true.

| # | Site | Link | Target | Check |
| ---: | --- | --- | --- | --- |
| 1 | gin `binding/multipart_form_mapping_test.go:66` | `s.SlicePtrs` | `…TestFormMultipartBindingBindTwoFiles.anon#1.SlicePtrs` | `var s struct{ … SlicePtrs … }` at line 44 |
| 2 | cli/cli `acceptance/fixture_repository_test.go:255` | `tt.name` | `…TestRegisterFixtureRepositoryCleanup.anon#1.name` | `tests := []struct{ name string … }`, ranged as `tt` |
| 3 | cli/cli `pkg/cmd/pr/shared/templates_test.go:214` | `tt.wantErr` | `…TestTemplateManagerSelect.anon#1.wantErr` | struct at line 120, `wantErr bool`, range at 196 |
| 4 | pocketbase `apis/record_crud.go:474` | `e.App` | `core/event_request.go` `RequestEvent.App` | `func(e *core.RequestEvent)`; `App App` at depth 0 |
| 5 | gin `binding/form_mapping_test.go:63` | `tt.form` | `…TestMappingBaseTypes.anon#1.form` | `for _, tt := range []struct{ … form string … }` |
| 6 | pebble `version_set.go:791` | `vs.metrics.Compact.ElisionOnlyCount` | `metrics.go` `CompactMetrics.ElisionOnlyCount` | `metrics struct{ … Compact CompactMetrics }` in `versionSet` |
| 7 | pebble `version_set.go:791` | `vs.metrics.Compact` | `version_set.go` `versionSet.metrics.anon#1.Compact` | as above |
| 8 | pocketbase `core/log_query_test.go:34` | `s.id` | `…TestFindLogById.anon#1.id` | `scenarios := []struct{ id string … }`, range at 33 |
| 9 | golang/tools `cmd/digraph/digraph_test.go:275` | `test.line` | `…TestSplit.anon#1.line` | `range []struct{ line string; want []string }` |
| 10 | fiber `middleware/hostauthorization/hostauthorization_test.go:568` | `tc.want` | `…Test_IsAllowed_Allocations.anon#1.want` | the function's first table, `want bool` |
| 11 | cli/cli `pkg/cmd/variable/shared/shared_test.go:45` | `tt.want` | `…TestGetVariableEntity.anon#1.want` | `want VariableEntity` |
| 12 | restic `helpers/prepare-release/main.go:37` | `opts.IgnoreChangelogReleaseDate` | `main.go:opts.anon#1.IgnoreChangelogReleaseDate` | package-level `var opts = struct{ … }{}` |
| 13 | golang/tools `go/packages/overlay_test.go:73` | `test.dir` | `…TestOverlayModulePath.anon#1.dir` | `range []struct{ … dir string … }` at 48 |
| 14 | cobra `completions_test.go:3145` | `tc.args` | `…TestCompletionForGroupedFlags.anon#1.args` | `testcases := []struct{ … args []string … }` |
| 15 | pebble `data_test.go:901` | `d.mu.snapshots.pushBack` | `snapshot.go` `(*snapshotList).pushBack` | `d` from `Open`; `snapshots struct{ snapshotList; … }` in `DB.mu`: promoted |
| 16 | pebble `compaction.go:1699` | `d.mu.mem.queue[n].flushable` | `flushable.go` `flushableEntry.flushable` | `queue flushableList`, `type flushableList []*flushableEntry` |
| 17 | pebble `compaction.go:1699` | `d.mu.mem.queue` | `db.go` `DB.mu.struct#1.mem.anon#1.queue` | `mu struct{ sync.Mutex; … mem struct{ … queue … } }` (`db.go:340`, `:389`) |
| 18 | pebble `compaction.go:1699` | `d.mu.mem` | `db.go` `DB.mu.struct#1.mem` | as above |
| 19 | pocketbase `core/record_query_test.go:1021` | `s.expectError` | `…TestFindAuthRecordByEmail.anon#1.expectError` | function at 974, `expectError bool` |
| 20 | samber/lo `it/string_test.go:65` | `tt.input` | `…TestChunkString.anon#1.input` | `input string`, range at 59 |

## Toolchain agreement (restic, opt-in route)

`toolchain-agreement.mjs` indexes a writable copy of restic `c734245`
with `graph.toolchain.go` on. Every package loaded (507 files in the
configuration, 52 outside it).

| | Base | Candidate |
| --- | ---: | ---: |
| Go links | 63,054 | 63,802 |
| Decided by the toolchain | 31,949 | 32,986 |
| Source-only definite, confirmed | 31,115 | 32,525 |
| Upgraded (only the toolchain decides) | 834 | 461 |
| Disagreements | 0 | 0 |
| Source-only definite withdrawn | 0 | 0 |

The toolchain decides 1,410 more of the source route's definite links, all
with the same target.

## Time and memory (observations)

One cold `graph index` each, base build then the final build (this branch
with `main` merged), one after the other on a quiet machine (load average
under 3.5). Both builds include C-2's memory changes.

| Repository | Build | Wall | Peak RSS | Symbols |
| --- | --- | ---: | ---: | ---: |
| cockroachdb/pebble | base | 205.6 s | 1.83 GiB | 19,372 |
| cockroachdb/pebble | final | 213.8 s | 1.91 GiB | 21,727 |
| restic/restic | base | 62.4 s | 0.69 GiB | 7,369 |
| restic/restic | final | 63.9 s | 0.70 GiB | 8,092 |

vercel/turborepo (no Go files) took 1,468 s with the base build and 1,204 s
with the candidate; it and microsoft/TypeScript exceeded the sweep's
60-minute limit when run two at a time and finished with a 120-minute limit.

## Review round 2 (build constraints)

After the second round's fixes (every legacy `+build` line followed by a
blank line, methods excluded by the caller's constraint, cumulative release
tags, Go's full GOARCH list; Go module version 28), the comparison against
a build of `main` was rerun on the two repositories with the most build
tags:

| Repository | Definite before | Definite after | Lost | Retargeted | Sites removed | Base symbols missing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| cilium/ebpf | 32,029 | 33,366 | 0 | 0 | 0 | 0 |
| mattn/go-sqlite3 | 3,379 | 3,642 | 0 | 0 | 0 | 0 |

Full `npm test`: 2,970 of 2,970 pass.
