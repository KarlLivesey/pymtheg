# C-4 evidence

Items `go-container` and `go-fields`. Change note: `docs/changes/C-4.md`.

All runs used the sweep runner (`scripts/sweep/run.mjs --local-build`) on
the 20 Go repositories of `sweep/repos.json`, at their pinned commits, once
with a build of `main` before this chunk (**base**) and once with the
final build of this branch (**candidate**). The coverage export and
scoreboard are `coverage-export.mjs` and
`coverage.mjs --base evidence/sw-3/breakdown.json.gz`.

Files:

- `scoreboard-base.md`, `scoreboard-candidate.md`: the scoreboards.
- `coverage-base.json.gz`, `coverage-candidate.json.gz`: the exports.
- `site-comparison.json`: per-repository site comparison and the seeded
  sample, from `compare.mjs` (sites keyed by file, kind, range and name).
- `toolchain-agreement-restic.json`, from `toolchain-agreement.mjs`.

## Level 2, Go

| Repository | Links before | Links after | Level 2 before | Level 2 after |
| --- | ---: | ---: | ---: | ---: |
| charmbracelet/bubbletea | 12,498 | 12,590 | 71.39% | 71.97% |
| cilium/ebpf | 49,614 | 50,300 | 76.24% | 77.65% |
| cli/cli | 207,303 | 218,250 | 68.55% | 74.94% |
| cockroachdb/pebble | 210,500 | 211,884 | 71.58% | 74.73% |
| etcd-io/bbolt | 16,741 | 16,939 | 73.35% | 75.84% |
| evanw/esbuild | 116,564 | 116,661 | 86.52% | 86.86% |
| gin-gonic/gin | 20,364 | 21,086 | 67.58% | 69.71% |
| go-task/task | 18,445 | 19,003 | 72.31% | 74.66% |
| gofiber/fiber | 139,671 | 143,978 | 62.05% | 66.23% |
| golang/tools | 251,402 | 253,583 | 72.76% | 74.06% |
| junegunn/fzf | 25,820 | 25,970 | 76.70% | 77.88% |
| labstack/echo | 30,180 | 31,900 | 67.84% | 74.76% |
| mattn/go-sqlite3 | 9,598 | 9,664 | 53.55% | 55.16% |
| pocketbase/pocketbase | 180,199 | 182,609 | 32.12% | 34.38% |
| protocolbuffers/protobuf-go | 216,552 | 217,137 | 81.56% | 82.16% |
| restic/restic | 63,408 | 64,359 | 76.54% | 79.18% |
| samber/lo | 27,801 | 29,761 | 54.62% | 62.81% |
| spf13/cobra | 8,792 | 8,888 | 76.94% | 78.45% |
| stretchr/testify | 19,521 | 19,919 | 76.67% | 79.28% |
| wagoodman/dive | 14,691 | 14,913 | 67.40% | 69.12% |
| **Go (all finished graphs)** | | | **74.16%** | **76.99%** |

Links are all stored links of the repository, as in the scoreboard. The
base Go figure is 74.16% against the plan's 74.17% for the release.

**How much is new links.** Every anonymous struct is now a symbol, so the
graph gains `contains` links (always definite) and links for selectors
that had no link before (`z.A` on a `struct{…}` value). Both add to the
numerator and the denominator. In the 20 repositories, Go links went from
1,484,614 to 1,514,344, and checkout-definite Go links from 947,354 to
1,012,273 (63.81% → 66.85%). Of the 64,919 newly definite links:

- 35,217 at sites that already had a link (32,921 references, 2,296 calls);
- 26,802 new `contains` links;
- 3,251 new references at new sites.

Counting only the existing sites, the checkout-definite share would be
66.18%.

## Sites that changed

No definite reference or call lost its target or changed target. 351 sites
changed: all are `contains` links to anonymous structs that already had
symbols (those that embed something) and were renumbered (`struct#n`)
because every anonymous struct now counts.

An earlier candidate build (before the ordering fix) lost 28 links, all
explained by the resolver's order dependence described in the change note:
fiber's `app.skip.*` (21), cli/cli `pr/checks/checks.go` `pr.ID` and
`pr.HeadRefName` (3), golang/tools `modernize/reflecttypeassert.go`
`index.Selection`/`index.Calls` (2) and protobuf-go
`internal/filedesc/build_test.go` (2). The same build gave 58,163, 58,163
and 58,184 unresolved links in three cold indexes of fiber; the final build
gave 58,163 every time (four runs).

## Reference sites of the items

The plan's rows now read `go-container` 29/33 reference sites settled,
`go-fields` 12/21. The 13 left:

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
| protobuf-go `…/test.hybrid.pb.go:2404`, `…/test.hybrid_protoopaque.pb.go:5313` | candidate sets of build-variant declarations (existing rule) |

## Hand-check: 20 newly definite links

Drawn from the 38,468 newly definite calls and references with the fixed
seed `c-4` (lowest SHA-256 of seed, repository, file, offset, kind), read
against the pinned source. All 20 are true.

| # | Site | Link | Target | Check |
| ---: | --- | --- | --- | --- |
| 1 | gin `binding/multipart_form_mapping_test.go:66` | `s.SlicePtrs` | `…TestFormMultipartBindingBindTwoFiles.struct#1.SlicePtrs` | `var s struct{ … SlicePtrs … }` at line 44 |
| 2 | cli/cli `acceptance/fixture_repository_test.go:255` | `tt.name` | `…TestRegisterFixtureRepositoryCleanup.struct#1.name` | `tests := []struct{ name string … }`, ranged as `tt` |
| 3 | cli/cli `pkg/cmd/pr/shared/templates_test.go:214` | `tt.wantErr` | `…TestTemplateManagerSelect.struct#1.wantErr` | struct at line 120, `wantErr bool`, range at 196 |
| 4 | gin `binding/form_mapping_test.go:63` | `tt.form` | `…TestMappingBaseTypes.struct#1.form` | `for _, tt := range []struct{ … form string … }` |
| 5 | pebble `version_set.go:791` | `vs.metrics.Compact.ElisionOnlyCount` | `metrics.go` `CompactMetrics.ElisionOnlyCount` | `metrics struct{ … Compact CompactMetrics }` in `versionSet` |
| 6 | pebble `version_set.go:791` | `vs.metrics.Compact` | `version_set.go` `versionSet.struct#1.Compact` | as above |
| 7 | pocketbase `core/log_query_test.go:34` | `s.id` | `…TestFindLogById.struct#1.id` | `scenarios := []struct{ id string … }`, range at 33 |
| 8 | golang/tools `cmd/digraph/digraph_test.go:275` | `test.line` | `…TestSplit.struct#1.line` | `range []struct{ line string; want []string }` |
| 9 | fiber `middleware/hostauthorization/hostauthorization_test.go:568` | `tc.want` | `…Test_IsAllowed_Allocations.struct#1.want` | the function's first table, `want bool` |
| 10 | cli/cli `pkg/cmd/variable/shared/shared_test.go:45` | `tt.want` | `…TestGetVariableEntity.struct#1.want` | `want VariableEntity` |
| 11 | restic `helpers/prepare-release/main.go:37` | `opts.IgnoreChangelogReleaseDate` | `main.go:file.struct#1.IgnoreChangelogReleaseDate` | package-level `var opts = struct{ … }{}` |
| 12 | golang/tools `go/packages/overlay_test.go:73` | `test.dir` | `…TestOverlayModulePath.struct#1.dir` | `range []struct{ … dir string … }` at 48 |
| 13 | cobra `completions_test.go:3145` | `tc.args` | `…TestCompletionForGroupedFlags.struct#1.args` | `testcases := []struct{ … args []string … }` |
| 14 | pebble `data_test.go:901` | `d.mu.snapshots.pushBack` | `snapshot.go` `(*snapshotList).pushBack` | `d` from `Open`; `snapshots struct{ snapshotList; … }` in `DB.mu`: promoted |
| 15 | pebble `compaction.go:1699` | `d.mu.mem.queue[n].flushable` | `flushable.go` `flushableEntry.flushable` | `queue flushableList`, `type flushableList []*flushableEntry` |
| 16 | pebble `compaction.go:1699` | `d.mu.mem.queue` | `db.go` `DB.struct#6.queue` | `struct#6` is `mem struct{…}` at `db.go:389` |
| 17 | pebble `compaction.go:1699` | `d.mu.mem` | `db.go` `DB.struct#3.mem` | `struct#3` is `mu struct{…}` at `db.go:340` |
| 18 | pocketbase `core/record_query_test.go:1021` | `s.expectError` | `…TestFindAuthRecordByEmail.struct#1.expectError` | function at 974, `expectError bool` |
| 19 | samber/lo `it/string_test.go:65` | `tt.input` | `…TestChunkString.struct#1.input` | `input string`, range at 59 |
| 20 | golang/tools `internal/graph/graphfmt/dot.go:97` | `clusters[id].nodes` | `dot.go` `(Dot).Sprint.cluster.nodes` | local `type cluster struct{ c; nodes []NodeID }`, `var clusters []cluster` |

## Toolchain agreement (restic, opt-in route)

`toolchain-agreement.mjs` indexes a writable copy of restic `c734245`
with `graph.toolchain.go` on. Every package loaded (507 files in the
configuration, 52 outside it).

| | Base | Candidate |
| --- | ---: | ---: |
| Go links | 63,054 | 63,996 |
| Decided by the toolchain | 31,949 | 32,986 |
| Source-only definite, confirmed | 31,115 | 32,525 |
| Upgraded (only the toolchain decides) | 834 | 461 |
| Disagreements | 0 | 0 |
| Source-only definite withdrawn | 0 | 0 |

Each of the source route's new definite links that the toolchain decides
has the same target.

## Time and memory (observations)

One cold `graph index` each, run one after another on an otherwise quiet
machine (load average under 3).

| Repository | Build | Wall | Peak RSS | Symbols |
| --- | --- | ---: | ---: | ---: |
| cockroachdb/pebble | base | 243.2 s | 5.29 GiB | 19,372 |
| cockroachdb/pebble | candidate | 252.4 s | 4.98 GiB | 20,511 |
| restic/restic | base | 74.1 s | 1.74 GiB | 7,369 |
| restic/restic | candidate | 77.3 s | 2.06 GiB | 8,286 |
