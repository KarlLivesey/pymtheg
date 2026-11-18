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

The replay preserved every repository's link total and completion outcome.
Pebble, Fiber, golang/tools, PocketBase and protobuf-go had small changes
in their Go outcome counts compared with the previous SW-3 archive. The
boundary checks and stored library evidence also refine the strict-inside
partition, so that metric can move even with identical graph counts.

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
