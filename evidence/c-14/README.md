# C-14 evidence

Items `go-external-targets`, `go-external-import`, `go-external-result`,
`go-external-fields`, and the Go builtins decision. Change note:
`docs/changes/C-14.md`.

All runs used the sweep runner (`scripts/sweep/run.mjs --local-build`) on
the 20 Go repositories of `sweep/repos.json` at their pinned commits, once
with a build of `main` at `5ec4baa` (**base**) and once with this branch
(**candidate**), in one scratch folder on the same storage, three workers
each. Every repository finished in both. Coverage exports use the base
build's readers for both (`coverage-base.json.gz`,
`coverage-candidate.json.gz`); scoreboards are `coverage.mjs` over those
exports alone (`scoreboard-base.md`, `scoreboard-candidate.md`).

## Level 2, Go

| Repository | Links | Level 2 before | Level 2 after |
| --- | ---: | ---: | ---: |
| charmbracelet/bubbletea | 12,533 | 71.84% | 81.33% |
| cilium/ebpf | 50,239 | 78.13% | 87.15% |
| cli/cli | 218,286 | 75.60% | 84.85% |
| cockroachdb/pebble | 214,346 | 76.41% | 84.99% |
| etcd-io/bbolt | 16,898 | 76.12% | 84.75% |
| evanw/esbuild | 118,250 | 87.96% | 90.93% |
| gin-gonic/gin | 21,081 | 69.92% | 83.01% |
| go-task/task | 18,984 | 74.65% | 83.43% |
| gofiber/fiber | 143,673 | 66.17% | 78.12% |
| golang/tools | 253,517 | 76.15% | 81.07% |
| junegunn/fzf | 25,947 | 77.94% | 85.74% |
| labstack/echo | 31,880 | 74.75% | 84.69% |
| mattn/go-sqlite3 | 9,650 | 56.00% | 59.58% |
| pocketbase/pocketbase | 197,148 | 56.88% | 58.92% |
| protocolbuffers/protobuf-go | 217,087 | 84.87% | 86.83% |
| restic/restic | 64,165 | 79.17% | 84.37% |
| samber/lo | 29,697 | 62.74% | 73.65% |
| spf13/cobra | 8,886 | 78.46% | 82.20% |
| stretchr/testify | 19,868 | 79.38% | 84.44% |
| wagoodman/dive | 14,901 | 69.23% | 81.91% |
| **Go module, 20 pins** | 1,512,591 Go links | **77.81%** | **84.88%** |

Repository rows count every module of the checkout (pocketbase, esbuild and
cli/cli also hold JavaScript or TypeScript, unchanged here). The Go module
row counts Go links only; the same figure results with the SW-3 base laid
under (23 graphs with Go code). The base reproduces C-8's final 77.81%.

**All sites and like-for-like** are the same figure: no site was added or
removed (1,512,591 Go links in both runs).

**Where the +7.07 pp comes from** (`site-comparison.json`):

| | Links |
| --- | ---: |
| Builtin calls (`declared-builtin`, new credit by the owner's decision) | 48,840 |
| Package-qualified names newly credited (mostly unnamed dependency imports: testify, cobra, cockroachdb/errors, …) | 58,115 |
| Package-qualified names the reconstruction already credited, now stored | 153,868 |
| Import units (`import-path`, level 1 only) | 32,563 |
| Members of library-typed values, unresolved with `library-member-unproven` | 111,415 |

Library links by evidence: `import-binding` go-std 152,853 and go 59,130;
`import-path` go-std 26,966 and go 5,597; builtins 48,840. 293,386 in all,
260,823 with a symbol.

## Nothing lost, nothing withheld

`compare.mjs` compares every Go link (keyed by file, kind, range and target
name) and every Go symbol (file, kind, identity) of all 20 pins:

| | |
| --- | ---: |
| Checkout-definite links before → after | 1,023,393 → 1,023,393 |
| Lost or retargeted | 0 |
| Candidate sets changed | 0 |
| Sites added or removed | 0 |
| Symbols missing | 0 of 200,941 |
| Sites main's reconstruction credited at level 2 | 153,868 |
| … now level 2 (stored) | 153,868 |
| … withheld | **0** |

The reconstruction replica in `compare.mjs` (a selector or qualified type
through an explicitly named import, or an unnamed standard-library import,
of an import left unresolved) counts 153,868 sites, exactly the export's own
`import-binding` level 2 count for the base (`scoreboard-base.md`, recorded
identities by encoding). Import units go from 32,530 reconstructed to
32,563 stored. The chunk adds no symbols, so no requirement link can change
anchor; symbol keys are unchanged on all 20 pins.

## Hand-check: 40 library links

Seed `c-14`, drawn from the library links with a symbol of restic,
cli/cli, pebble, gin and samber/lo (`site-comparison.json` `sample`,
`sample.tsv`). `verify-sample.sh` printed, from each pinned checkout, the
source line, the import that binds the qualifier, any local or
package-level declaration of the qualifier, and the go.mod requirement
(`verify-sample.txt`). Standard-library symbols were checked with `go doc`
(Go 1.27.4), dependency symbols on pkg.go.dev: testify `require.NoError`
and `LessOrEqual` (v1.9.0), `assert.Panics`, `Equal`, `NotNil`, `New`;
`heredoc.Doc` (v1.0.0); crlib `leaktest.AfterTest`; `redact.SafePrinter`
(v1.1.5, a type alias); `errors.Errorf` (cockroachdb/errors v1.11.3);
`windows.SID` (x/sys, used through the package's `*SID` API). Builtins are
the Go spec's predeclared functions; the resolver ruled out shadowing.

**All 40 are true**: each qualifier is bound by exactly that import, no
local or package-level declaration shadows it, each version is the one
go.mod requires, and each symbol exists. Notable: gin `render/html.go:74`
`template.Template` is `html/template` (the file imports that, not
`text/template`); pebble `compaction.go:498` `atomic.Int64` is
`sync/atomic`; pebble `mem_table_test.go:366` `errors.Errorf` is
`github.com/cockroachdb/errors`; restic `sd_windows_test_helpers.go:53`
`windows.SID` is in a Windows-only file (recorded as written).

## Toolchain route (restic, opt-in)

`toolchain-restic.mjs` indexes writable copies of the pinned corpus copy of
restic with this branch's build, source-only and with
`graph.toolchain.go` on (`toolchain-restic.json`):

| | Source-only (default) | Toolchain on |
| --- | ---: | ---: |
| Go level 2 | 84.36% | **91.08%** |
| `declaring-owner` (std / dependency) | 0 | 2,899 / 720 |
| Source-only library targets the toolchain also decided | | 13,903 |
| … agreeing on unit and symbol | | 13,903 (**0 disagreements**) |
| Source-only library targets the toolchain put in the checkout | | 0 |

Of the 4,765 links source-only marks `library-member-unproven`, the
toolchain names 2,806 standard-library and 647 dependency owners. The two
runs differ in 58 sites: derived `implements` links, which the toolchain
route replaces with its verified pairs (W3-L).

## A standard-library member table (not built)

`stdtable.go` (Go 1.27.4, `stdtable.txt`): 180 importable standard
packages, 1,169 exported named types, 3,236 declared and 362 promoted
exported methods, 2,525 exported fields; about 200 KB as tab-separated
text, one table per Go release. On restic 59% of the member-reason links
are standard-library members (2,806 of 4,765); applied to the 111,415
member-reason links of the 20 pins that is at most about 66,000 links
(about 4.4 pp), and only where the receiver's type is written in the
checkout: a library call's result would also need the functions' result
types (a second, smaller table). Reading GOROOT instead is the toolchain
dependency, opt-in only.

## Cost

`timing.sh`: cold index, builds interleaved in one session, project and
store in memory-backed storage (the shared machine's disk swung wall times
by 50%). Observations:

| Repository | main user CPU (s) | branch user CPU (s) | main wall (s) | branch wall (s) | Peak RSS |
| --- | ---: | ---: | ---: | ---: | --- |
| restic/restic | 27.43, 25.42 | 28.17, 28.34 | 83.6, 58.2 | 72.3, 56.5 | 0.70–0.79 GB both |
| etcd-io/bbolt | 6.88, 6.86, 7.50, 7.37 | 8.58, 8.47, 8.13, 7.92 | 10.4–15.5 | 12.5–13.6 | 0.37–0.39 GB both |

User CPU is about +8% on restic and +16% on bbolt; wall time is within the
noise. A CPU profile of bbolt (both builds) puts the difference in the
store's link writes (`insertLink` 4.0 → 6.9 s of samples, new
`insertLibraries` 0.8 s): 293,386 Go links now carry a library target row
and a larger body. The Go resolver's own functions do not appear among the
top entries. What it buys: +7.07 pp Go level 2 and `graph uses` for Go.

## Files

- `compare.mjs`, `site-comparison.json`: every link and symbol, both runs.
- `scoreboard-base.md`, `scoreboard-candidate.md`, `coverage-base.json.gz`,
  `coverage-candidate.json.gz`.
- `sample.tsv`, `verify-sample.sh`, `verify-sample.txt`: the hand-check.
- `toolchain-restic.mjs`, `toolchain-restic.json`.
- `stdtable.go`, `stdtable.txt`.
- `timing.sh`.
- `graph-uses-restic.txt`: `pymtheg graph uses fmt Errorf`,
  `… github.com/spf13/cobra`, `… builtin append`,
  `… github.com/spf13/cobra Command` on restic (counts 222, 186, 421, 134).
- `coverage-plan-input.json.gz`: C-4's 40-pin plan input
  (`evidence/c-4/coverage-plan-input.json.gz`) with these 20 Go pins laid
  over it (`evidence/c-8/plan-base.mjs`). Regenerating with it and the SW-3
  base gives the Go section committed in `docs/coverage-plan.md`. Main's
  other sections were made from inputs that are not all archived (C-8 and
  C-10 notes), so only the Go section was replaced; Rust, TypeScript and
  the checklist are main's.
