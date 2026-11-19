# C-8 evidence

Items `go-factory`, `go-local-method`, `go-typed-reference` and
`go-pointer-conversion`. Change note: `docs/changes/C-8.md`.

## Review round 2: one build model, and what it moved

The second review's fixes (cgo enablement apart from the `cgo` tag; member
selection on build variants by the same free-tag model as variant calls;
see the change note) were checked with Go (`go-variant-configs.sh` cases
(c) and (d), output in `go-variant-configs.txt`). Every Go link and symbol
of five pins compared with a build of main (`compare-builds-round3.json`):

| Pin | Definite before → after | Newly definite | Definite → candidate set | Sites added/removed | Symbols missing |
| --- | ---: | ---: | ---: | ---: | ---: |
| mattn/go-sqlite3 | 3,642 → 3,643 | 1 | 0 | 0 | 0 |
| cilium/ebpf | 33,366 → 33,456 | 95 | 5 | 0 | 0 |
| etcd-io/bbolt | 10,692 → 10,750 | 58 | 0 | 0 | 0 |
| restic/restic | 42,347 → 42,379 | 32 | 0 | 0 | 0 |
| cockroachdb/pebble | 144,642 → 144,830 | 193 | 5 | 0 | 0 |

**10 links move from definite to a candidate set**, none is lost outright or
retargeted. Each is a correction:

- cilium (5): `fd.Close`, `fd.File`, `fd.Dup` on `*sys.FD` from Linux files
  (`rlimit/rlimit_linux.go:75`, `internal/sys/fd_linux_test.go:45, 56, 62,
  65`). `FD` is declared in `fd_other.go` (`!windows`) and `fd_windows.go`;
  a Linux build with `-tags=windows` selects the Windows `FD` and its methods.
- pebble (5): `b.Data()` and `b.Slice()` on `manual.New` results
  (`internal/cache/block_map.go:32`, `entry.go:255`, `value.go:64, 82, 83`).
  `New` is declared in `manual_cgo.go` (`import "C"`) and
  `manual_nocgo.go` (`!cgo`); with `-tags=cgo` and cgo disabled neither is
  built, so those builds have no `New` (the coverage rule of the first
  review). Both variants return the same `Buf`.

## Review round 1: what changed and the final figures

The first review (six points) changed how imports, pointer conversions and
build-variant calls are resolved; see the change note. Everything below this
section is the first head's evidence, kept as it was; this section is the
final head's.

**Go command checks.** `go-import-rules.sh` (output `go-import-rules.txt`)
and `go-variant-configs.sh` (`go-variant-configs.txt`) build each import and
build-variant shape with Go 1.27.4 in read-only module mode: a replace
without a `require` is not used, an unrequired replace of a path the main
module provides does nothing and with the `require` added the import is
ambiguous, `=> ..` without a parent go.mod fails, a package whose only file
is `//go:build ignore` fails, a go.mod declaring another path still builds;
the darwin build of a `linux || darwin` caller has no Linux/Windows-only
`New`, and `-tags=freebsd` on Linux selects `//go:build linux && freebsd`.

**All links of all 20 Go pins against main.** Sweeps of the 20 pins with a
build of main at `efa0e9e` (the four largest re-run with a 120-minute limit
on a loaded machine) and with the final build; `compare.mjs` over every Go
link and symbol (`site-comparison-round2-base4.json`, 16 pins;
`-base5.json`, the four largest):

| | 16 pins | 4 largest |
| --- | ---: | ---: |
| Definite before → after | 409,925 → 410,375 | 602,731 → 613,022 |
| Lost or retargeted | 0 | 0 |
| Sites added or removed | 0 | 0 |
| Symbols missing | 0 of 76,810 | 0 of 124,131 |

Net +10,741 definite links, as at the first head. Two intermediate builds
lost links and were fixed before this one: a replacement written `../` to
the checkout root (bubbletea 1,255 links, samber/lo 81), and the free-tag
build test giving up above 14 names (cilium's bpf2go loaders, 38).

**Level 2.** Go module (scoreboard over SW-3, `scoreboard-candidate-round2.md`):
77.10% → **77.81%**. The per-repository figures are those of the table below
except cli/cli 75.60%, evanw/esbuild 87.96% and pocketbase 56.88%: those
totals count every module of the checkout, and their TypeScript changed with
C-7, merged into this build; their Go links are the first head's.
Plan Go section, the same script over C-7's input with these Go pins laid on
(`coverage-plan-input-round2.json.gz`, `plan-base.mjs`): 79.11% →
**79.65%**. The committed block is main's own: main has since merged C-9,
whose Rust input was not archived, so the block cannot be regenerated with
it; laying these pins over C-7's input alone would take C-9's Rust figures
out.

**Hand-check.** 20 newly definite links at the seed `c-8-r2`
(`site-comparison-round2-*.json`, `sample`), read against the pinned
source (`verify-round2.sh` for the ones that depend on context): all true.
Thirteen are pointer conversions (`var _ X = (*T)(nil)`, bbolt's
`(*common.Page)(unsafe.Pointer(…))`, protobuf-go's `(*M)(nil)` tables); the
others are gin's `testdata.Test` (an import of `…/testdata/protoexample`),
cli/cli's `state.Data.Rows` and `raster.fonts.Styles` in the `.github`
module (`states []state`, `Data recording.TerminalData`,
`fonts *fontutil.Set`), gopls's `pass.Pkg` (`pass *analysis.Pass`) and
`set.Set` through `replace golang.org/x/tools => ..`, protobuf-go's
`sub.E_value` and `m7.GetBar` (packages under `cmd/protoc-gen-go/testdata`).

**Toolchain agreement** (restic, `toolchain-agreement-restic.json`): 32
newly definite, 10 confirmed, **0 disagreements**, 22 with no decision, all in
`internal/fs/vss_windows.go` (`//go:build windows`, outside the linux
configuration).

**Determinism.** Three cold indexes of cilium/ebpf with the final build:
identical rows (`determinism-cilium.json`).

**Cost** (`timing-round2.txt`). The reviewer's bbolt 196.0/184.9 s → 241.6 s
was wall time on a shared machine. Interleaved base/candidate runs: user CPU
time bbolt 8.19–8.64 s (main) and 8.17–8.75 s (this branch), pebble
104.1–110.5 s and 107.7–109.5 s; wall time swung 50–96 s on bbolt across both
builds with the machine's storage contention. Peak memory unchanged.

All runs used the sweep runner (`scripts/sweep/run.mjs --local-build`) on the
20 Go repositories of `sweep/repos.json` at their pinned commits, once with a
build of `main` at `e5f86db` (after C-4) (**base**) and once with this branch
(**candidate**), in one scratch folder on the same storage. The coverage
exports are `coverage-export.mjs` (with the base build's readers for both, so
the outside classification is the same) and the scoreboards
`coverage.mjs --base evidence/sw-3/breakdown.json.gz`.

Files:

- `scoreboard-base.md`, `scoreboard-candidate.md`, and the exports
  `coverage-base.json.gz`, `coverage-candidate.json.gz`.
- `site-comparison.json`, from `compare.mjs` (C-4's script with separate
  scratch folders): every Go link of both runs keyed by file, kind, range and
  target name; every Go symbol by file, kind and identity; the seeded sample.
- `toolchain-agreement-restic.json`, from `toolchain-agreement.mjs`.
- `determinism-cilium.json`, from `determinism.mjs`.
- `timing.sh`: the time and memory observations below.
- `plan-base.mjs`, `coverage-plan-input.json.gz`, `scoreboard-plan-input.md`:
  how the plan's generated block was regenerated (below).

## Level 2, Go

| Repository | Links | Level 2 before | Level 2 after |
| --- | ---: | ---: | ---: |
| charmbracelet/bubbletea | 12,533 | 71.84% | 71.84% |
| cilium/ebpf | 50,239 | 77.95% | 78.14% |
| cli/cli | 218,286 | 75.18% | 75.59% |
| cockroachdb/pebble | 214,346 | 76.32% | 76.41% |
| etcd-io/bbolt | 16,898 | 75.78% | 76.12% |
| evanw/esbuild | 118,250 | 87.91% | 87.91% |
| gin-gonic/gin | 21,081 | 69.70% | 69.92% |
| go-task/task | 18,984 | 74.65% | 74.65% |
| gofiber/fiber | 143,673 | 66.15% | 66.17% |
| golang/tools | 253,517 | 74.14% | 76.15% |
| junegunn/fzf | 25,947 | 77.94% | 77.94% |
| labstack/echo | 31,880 | 74.74% | 74.75% |
| mattn/go-sqlite3 | 9,650 | 55.99% | 56.00% |
| pocketbase/pocketbase | 197,148 | 56.18% | 56.26% |
| protocolbuffers/protobuf-go | 217,087 | 82.98% | 84.87% |
| restic/restic | 64,165 | 79.12% | 79.17% |
| samber/lo | 29,697 | 62.74% | 62.74% |
| spf13/cobra | 8,886 | 78.45% | 78.46% |
| stretchr/testify | 19,868 | 79.22% | 79.38% |
| wagoodman/dive | 14,901 | 69.10% | 69.23% |
| **Go module (scoreboard, 23 graphs with Go code)** | | **77.10%** | **77.81%** |

Per repository, links and level 2 are the scoreboard's repository rows (every
module of the checkout). The Go module row is the scoreboard's: the 20
candidate pins laid over the SW-3 base, which adds the Go code of three other
pins.

**Both ways.** The chunk adds no symbols and no link sites: both runs store
1,512,591 Go links at the same sites. Counting all sites and like-for-like
on the sites that exist on `main` are the same figure, 77.81%.

**Gross, replaced, net.** Checkout-definite Go links in the 20 repositories
went from 1,012,656 to 1,023,397:

| | Links |
| --- | ---: |
| Newly definite: calls | 6,640 |
| Newly definite: references | 3,185 |
| Newly definite: imports | 914 |
| Newly definite: embeds | 2 |
| **Gross additions** | **10,741** |
| Definite links lost or retargeted | 0 |
| Sites removed or added | 0 |
| **Net** | **10,741** |

Most of it is golang/tools (5,092: gopls through `replace … => ..`; all 777
gopls imports of golang/tools packages now resolve, the 3,027 still
unresolved are library imports) and protobuf-go (4,095: pointer conversions
in generated code, and imports of the generated test packages under
`cmd/protoc-gen-go/testdata/`).

## Identities and links of `main`

`compare.mjs` checks every Go symbol of the base graph (file, kind,
identity) against the candidate in all 20 repositories: **200,941 symbols,
0 missing**. It compares every link of every repository, not a sample: **no
definite link lost or retargeted, no site removed**. The chunk creates no
symbols, so no requirement link can change anchor.

## Reference sites of the items

The plan's rows now read: pointer conversions all 4 settled; typed
references 10/22; call results 1/3; local method 0/3. The 20 left:

| Site | Why it stays |
| --- | --- |
| gin `binding/binding_test.go:1055`, cilium `prog_test.go:959` and `prog.go:195`, pebble `merging_iter_v2.go:1328` and `internal/invariants/off.go:57` | a package-level name declared in several build variants: a candidate set (item `go-generated`) |
| golang/tools `go/ssa/interp/testdata/minmax.go:36`, `rangefunc.go:188`, `:224`, `:949`, `deepequal.go:29` | test programs of one directory, each `package main`, declaring the same names: not one package |
| golang/tools `go/callgraph/vta/testdata/src/issue63146.go:5` | a testdata program whose `embedded` type is not declared in its package |
| dive `cmd/dive/cli/internal/command/run.go:58` | embeds the builtin `error` |
| golang/tools `gopls/internal/analysis/unusedfunc/unusedfunc.go:228` | ranges over `Preorder`, an `iter.Seq` (library) |
| restic `internal/archiver/scanner_test.go:87` | `defer back()`: a closure returned by `rtest.Chdir`; function literals are not symbols |
| protobuf-go `internal/reflection_test/reflection_hybrid_test.go:427` | `TestAllTypes` declared in build variants (hybrid/opaque): a candidate set |
| cli/cli `pkg/cmd/release/create/create_test.go:1394` | `RegisterConfirm` is promoted from an embedded library mock (`go-gh`) |
| go-task `taskfile/ast/matrix.go:76` | `om` is an `orderedmap.OrderedMap` (library) |

## Hand-check: 20 newly definite links

Drawn from the 9,825 newly definite calls and references with the fixed seed
`c-8` (lowest SHA-256 of seed, repository, file, offset, kind), read against
the pinned source. All 20 are true.

| # | Site | Link | Target | Check |
| ---: | --- | --- | --- | --- |
| 1 | protobuf-go `internal/testprotos/test3/test_extension.pb.go:20` | `*descriptorpb.MessageOptions` | `types/descriptorpb/descriptor.pb.go` `MessageOptions` | `(*descriptorpb.MessageOptions)(nil)`; import `…/types/descriptorpb`; struct at line 2697 |
| 2 | protobuf-go `cmd/protoc-gen-go/feature_resolution_test/feature_resolution_test.go:724` | `testfeaturespb.EnumFeature_VALUE5.Number` | `cmd/protoc-gen-go/testdata/features/test_features.pb.go` `(EnumFeature).Number` | import of the testdata package; `EnumFeature_VALUE5 EnumFeature = 5`; method at line 70 |
| 3 | protobuf-go `cmd/protoc-gen-go/testdata/comments/comments.pb.go:421` | `*Message1_Oneof1AField1` | same file, `Message1_Oneof1AField1` | `(*Message1_Oneof1AField1)(nil)`; struct at line 152 |
| 4 | golang/tools `gopls/internal/cache/typerefs/pkgrefs_test.go:242` | `gcexportdata.Write` | `go/gcexportdata/gcexportdata.go` `Write` | gopls `replace golang.org/x/tools => ..`; `func Write` at line 201 |
| 5 | cli/cli `.github/codeql/tests/unsanitized-response-to-terminal/hits_scanner_crossfunc.go:30` | `ios.Out` | that module's `pkg/iostreams/iostreams.go` `IOStreams.Out` | its own `go.mod` (module `github.com/cli/cli/v2`) under `.github`; `ios *iostreams.IOStreams` |
| 6 | golang/tools `gopls/internal/cache/typerefs/pkgrefs_test.go:337` | `packages.NeedImports` | `go/packages/packages.go` `NeedImports` | constant at line 80 |
| 7 | golang/tools `gopls/internal/analysis/infertypeargs/infertypeargs.go:52` | `inspector.Inspector` | `go/ast/inspector/inspector.go` `Inspector` | struct at line 55 |
| 8 | cli/cli `.github/skills/cli-exercise/tool/internal/evidence/session_media_test.go:359` | `receipt.Tools.FFmpeg.Path` | `…/internal/recording/models.go` `Executable.Path` | `var receipt recording.Receipt`; `FFmpeg *Executable`; `Path string` |
| 9 | same | `receipt.Tools.FFmpeg` | `…/recording/models.go` `Tools.FFmpeg` | `Tools Tools` in `Receipt`; `FFmpeg` at line 125 |
| 10 | same | `receipt.Tools` | `…/recording/models.go` `Receipt.Tools` | as above |
| 11 | golang/tools `gopls/internal/debug/serve.go:619` | `p.WriteEvent` | `internal/event/export/printer.go` `(*Printer).WriteEvent` | `var p export.Printer` in the enclosing function; addressable, pointer method |
| 12 | golang/tools `gopls/internal/golang/comment.go:169` | `partPos.EndPos` | `internal/astutil/util.go` `Range.EndPos` | `partPos := namePos`, `namePos := astutil.RangeOf(…)` returns `Range` |
| 13 | golang/tools `gopls/internal/debug/trace.go:194` | `span.Start().At` | `internal/event/core/event.go` `(Event).At` | `(*Span).Start() core.Event` |
| 14 | same | `span.Start` | `internal/event/export/trace.go` `(*Span).Start` | `span := export.GetSpan(ctx)`, which returns `*Span` |
| 15 | protobuf-go `cmd/protoc-gen-go/testdata/import_public/a.pb.go:55` | `sub.E_ExtensionField` | `…/import_public/sub/a.pb.go` `E_ExtensionField` | import of the testdata `sub` package; variable at line 406 |
| 16 | golang/tools `gopls/internal/server/type_hierarchy.go:34` | `event.Start` | `internal/event/event.go` `Start` | import `golang.org/x/tools/internal/event` (gopls is below `golang.org/x/tools`, so `internal` is allowed) |
| 17 | protobuf-go `internal/testprotos/test/test.pb.go:4169` | `*TestUnpackedExtensions` | same file, `TestUnpackedExtensions` | `(*TestUnpackedExtensions)(nil)`; struct at line 2981 |
| 18 | golang/tools `gopls/internal/analysis/writestring/writestring.go:107` | `analysis.SuggestedFix` | `go/analysis/diagnostic.go` `SuggestedFix` | struct at line 72 |
| 19 | golang/tools `txtar/fs.go:237` | `*openDir` | same file, `openDir` | `var _ fs.ReadDirFile = (*openDir)(nil)`; struct at line 231 |
| 20 | golang/tools `gopls/internal/golang/completion/format.go:308` | `event.Error` | `internal/event/event.go` `Error` | function at line 44 |

## Toolchain agreement (restic, opt-in route)

`toolchain-agreement.mjs` indexes writable copies of the pinned corpus copy
of restic (`c734245`): with the base build and the candidate build
source-only, and with the candidate build and `graph.toolchain.go` on. Of the
32 links the candidate newly makes definite (pointer conversions, and
member links reached through a conversion's result such as
`iVssBackupComponents.AbortBackup()` in `vss_windows.go`):

| | Links |
| --- | ---: |
| Confirmed by the toolchain (same target) | 10 |
| Disagreements | **0** |
| No toolchain decision | 22 |
| Base definite links lost | 0 |

All 22 without a decision are in `internal/fs/vss_windows.go`
(`//go:build windows`), outside the toolchain's linux/amd64 configuration.
Before this chunk's change to the helper, the toolchain recorded no
declaration for a `(*T)` conversion and decided none of the 32; it now names
`T`. `test/graph-go-toolchain.test.mjs` checks the same on a
compiler-checked fixture.

## Determinism

Three cold indexes of fresh copies of cilium/ebpf (the pin with the most
build-variant files) with the candidate build: identical symbol and link
rows (8,419 symbols, 50,239 links; symbol ids, which depend on where the copy
is, compared as file, kind and identity, also inside link data).

## Time and memory (observations)

One cold `graph index` each on a fresh copy, base, base again, candidate, one
after another in one session on the same storage (`timing.sh`). Load average
from a shared machine in the last column.

| Repository | Build | Wall | Peak RSS | Load |
| --- | --- | ---: | ---: | ---: |
| restic/restic | base | 104.6 s | 690 MiB | 14.7 |
| restic/restic | base again | 108.0 s | 672 MiB | 23.5 |
| restic/restic | candidate | 104.6 s | 677 MiB | 22.9 |
| cockroachdb/pebble | base | 336.3 s | 1,964 MiB | 13.6 |
| cockroachdb/pebble | base again | 260.8 s | 1,788 MiB | 7.6 |
| cockroachdb/pebble | candidate | 246.6 s | 1,949 MiB | 5.7 |

Within the noise of the two base runs.

## The coverage plan block

`main`'s block was generated from C-4's 40-pin input over the SW-3 base
(regenerating it from `evidence/c-4/coverage-plan-input.json.gz` reproduces
`docs/coverage-plan.md` byte for byte). `plan-base.mjs` replaces that input's
20 Go pins with this run's candidate records
(`coverage-plan-input.json.gz`), and `coverage.mjs` regenerates the block
with the SW-3 base as before. Only the Go section changes: Go level 2
79.11% → **79.65%**.

## Choosing what to build

A temporary diagnostic (not committed) recorded, for every member link with
a call in its receiver chain that was not definite on `main`, where the
receiver's type was lost. Over the 20 pins: 68% end in a library type, 16% in
an interface result (dispatch sets by rule), 5% in a type parameter's type
(4,700 of the diagnostic lines in fiber's `apptest.Ctx(t, New())`, whose
result is an interface), the rest in members not found on a checkout type
(mostly promoted from an embedded library type). That is why this chunk
builds the module-layout and conversion fixes and leaves generic
instantiation for later (see the change note).
