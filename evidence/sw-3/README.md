# SW-3 evidence

The [scoreboard](scoreboard.md) shows completion separately from link
coverage. Level 2 is the headline. Level 1, strict-inside and raw are
shown beside it, with an alternative that includes reviewed closed
candidate sets. The [sample review](sampling.md) describes the audit,
its intervals and the checkable source examples.

The v2 archive contains all stored link combinations for the 53 finished
repositories and the seven historical outcomes. The ordered tuple
fields are in its columns array. The outside proof columns record the
level, evidence and gap. A null level means outside origin was not proved
from the stored facts and the boundary check. Level zero means an outside
identity is missing, despite evidence that the link goes outside. Scope
and original disposition remain available. The sample archive gives each
site’s reason, label, and observed multiplicity.

The warm CLI totals were checked against each read-only export. The sweep
uses the Go and Rust source routes and never installs or runs a corpus
project’s code. The library proof uses captured graph facts and checkout
locations. The optional dependency information in the plan was not
consulted for these measurements.

Level 2 requires a declaring method owner. The previous shortcut used
the receiver name as the owner. The RustCrypto `State1600` array alias
would therefore take credit for a slice method, and Actix's `&Path`
would take credit for `Into::into`. The Rust dot calls and Go's
potentially promoted selectors now stay unclassified when the owner
is missing. A directly qualified library name or named trait can
still establish the declaring unit and symbol.

The overlay regression moves a site between two populated diagnostic
buckets in a 200-link fixture. The library item retains its 50-link
estimate. A `node:fs` binding earns the same Level 2 credit under
`no-symbol` and `local`.

The source audit labels ripgrep's `caps.get(0)` at
`crates/matcher/src/lib.rs:840` as a candidate set. `Self::Captures::get`
has checkout implementations in both the regex and PCRE2 matchers. This
site was in the previous draw and fell outside the new fixed-seed draw
after its receiver moved to the unclassified stratum. The follow-up
label contributes no sampling weight.

At cilium/ebpf's `link/perf_event.go:275`, both the caller and
`internal/sys/fd_other.go` require `!windows`. The implicit Windows
constraint on `internal/sys/fd_windows.go` excludes that stored
candidate from this call. The gap is caller-aware build filtering.

The replay preserved every repository's link total and completion outcome.
Pebble, golang/tools and PocketBase had small changes in Go outcomes
compared with `82af34d2`. Apply both scoring rules to the same released
graphs to isolate the method proof change. The fix to diagnostic handling
did not move Level 2 on this replay.

| Module | Before | After | Change (pp) |
| --- | ---: | ---: | ---: |
| Go | 77.0163% | 74.1651% | −2.8512 |
| Rust | 33.4832% | 33.2695% | −0.2136 |
| TypeScript / JS | 48.0225% | 48.0225% | 0.0000 |

The old rule credited 42,346 Go selectors and 1,454 Rust dot calls based
on receiver spellings. The replay also found four Rust calls with an
explicitly named declaring trait that now earn Level 2 credit. TypeScript
and JavaScript use stored import bindings and named paths for library
symbols, so they had no receiver-type shortcuts to remove.

The bundle comparison uses the filename and long-line rules documented
in the sweep guide. It retains the vendored Ace bundle under mdBook's
`playground_editor/` directory, which falls outside those rules.
[Scope rules](../../sweep/README.md#coverage-scoreboard)

The source audit follows sampled calls to their final targets. In cli/cli,
the helper behind `pkg/cmd/project/item-list/item_list_test.go:119` returns
a Cobra command, so `cmd.ExecuteC()` is a library use. In Actix Web,
`actix-web/src/http/header/entity.rs:182` reaches the `http` crate through a
local re-export. In Fiber, the sampled span at `ctx_test.go:1973` covers
`c.Response()` through the `Ctx` interface. The next call, `Body()`, uses
the fasthttp result. [Sample review](sampling.md) · [Sample archive](samples.json.gz)

To reproduce the export, run the sweep with a manifest containing the
53 finished pins. Then run the exporter on the dev server. The existing
archive supplies the sample allocations. The seven historical outcomes
come from SW-1.

```sh
node scripts/sweep/coverage-export.mjs --results "$PYM_SCRATCH/results.json" \
  --include-failed evidence/sw-1/results.json \
  --sampling-base evidence/sw-3/breakdown.json.gz \
  --reference-samples evidence/sw-3/samples.json.gz \
  --output "$PYM_SCRATCH/audit.json"
```

Use the archived graph counts and reviewed labels to regenerate the reports.

```sh
node scripts/sweep/coverage.mjs --results evidence/sw-3/breakdown.json.gz \
  --plan docs/coverage-plan.md --scoreboard evidence/sw-3/scoreboard.md \
  --sampling-report evidence/sw-3/sampling.md
```
