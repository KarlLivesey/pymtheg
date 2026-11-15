<img src="assets/icon.svg" width="64" height="64" alt="">

# Pymtheg

A local architecture, planning and specification workspace. Keep complete design
documents, requirements, decisions, contracts and their revision history together.
Build `.pym` designs with Blocks or Text before implementing adapters. Inspect
missing outcomes, effects, resource cleanup, multiplied work and copied rules.
Explore bounded behaviour and follow counterexamples back to the design.

Pymtheg is a provisional name. This integrates established specification ideas;
it is not a universal proof engine or a proof that production code follows a model.
The package is private. CLI checking needs no server or browser; Studio runs locally.

## Open the design workspace

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
./pymtheg init /path/to/my-project --name "My project"
./pymtheg studio /path/to/my-project
```

`init` works in an empty folder: it creates project identity/configuration without
inventing source or plans. If documentation exists, it offers a preview; use
`pymtheg init /path/to/my-project --import-docs` to retain those documents explicitly.
Studio and MCP discover the initialized project from its subfolders. Existing
configuration and design files are preserved. See [project setup](docs/project-init.md).

Open the printed session URL in **Firefox**. Studio includes a source editor,
a Text/Blocks editor sharing one source buffer and undo history,
create-only forms for components, operations, data shapes, resource lifecycles
and finite event models, plus project-type selection and recoverable lifecycle and operation-contract edits,
real checks on unsaved buffers, source-linked findings, work and lifecycle views,
change impact, bounded simulation/verification, a trace player and run history.
Use **Architecture** to import or author the wider design, search its documents,
connect requirements to contracts and compare named revisions. Planning drafts
can be recovered after restart. Imported claims remain explicitly unverified.
See [the Studio guide](docs/studio.md) and [five modelling journeys](docs/journeys.md).
No account or cloud service is needed. `./pymtheg doctor` checks local prerequisites.

## Coding-agent connection and scaffolds

`./pymtheg mcp /path/to/project` exposes a local MCP server for coding agents.
It can check proposed source without saving, explain findings, retrieve real
counterexamples and generate TypeScript, Rust or Go types/functions with fail-fast stubs.
See [MCP setup and workflow](docs/mcp.md), or choose **Connect agent** in Studio.
`./pymtheg scaffold examples/mvp/library.pym --target rust` prints a scaffold to inspect.
[Language emitter plugins](docs/output-plugins.md) add other targets without compiler changes.
Every generated function fails with “Not implemented” until implemented. Use
`--body empty` for literal empty bodies, which may not compile. Neither mode
implements business logic or proves conformance.

The first existing-code reader is available for TypeScript and JavaScript:

```sh
./pymtheg observe --list --root .
./pymtheg observe src/service.ts src/main.ts --label "Current implementation" --retain --out implementation.json
```

It captures source hashes, declarations, body categories and relationships using
the TypeScript parser, without executing the project. Unresolved relationships
remain explicit. In Architecture, choose **Plan & code graphs** to inspect
retained versions, connect a plan to an observed declaration, and see unlinked work,
stubs and changes. Plan and code checkpoints can be selected independently. Review exact linked-code
changes and observed call-site differences, then explicitly accept one link’s
current version without clearing other warnings.
Linked-code review also flags changes to observed constants and resolved transitive
callees, with retained dependency comparisons. Dynamic and uncaptured dependencies
remain unknown. Capturing code is explicit; it is not continuous background indexing.
These are initial working slices with open scope: see [the implementation-gap map](https://github.com/KarlLivesey/pymtheg/blob/main/docs/implementation-gap-map.md)
and [block-editor contract](https://github.com/KarlLivesey/pymtheg/blob/main/docs/block-editor-map.md).

See the [current completion audit](https://github.com/KarlLivesey/pymtheg/blob/main/docs/current-completion-audit.md) for remaining
gaps and exact validation boundaries. The [previous withdrawn review](https://github.com/KarlLivesey/pymtheg/blob/main/docs/1.0-status.md)
is preserved as history. Pymtheg does not claim universal proofs or production conformance.

Review-36 repairs pass the established acceptance checks: 1,100 local tests,
96 real integrations and 111 journeys in each browser engine. The review/polish
cycle has stopped to proceed with the functional trial; independent sign-off
remains unsigned. [Run the trial](https://github.com/KarlLivesey/pymtheg/blob/main/docs/trial-start.md).
[Repair evidence](https://github.com/KarlLivesey/pymtheg/blob/main/evidence/product-audit/review-36-follow-up/README.md).

## Run locally

Requires **Node 24 or newer** (tested on 24.21.0). Dependencies and tool versions
are pinned. `./pymtheg doctor` reports an older Node as not supported.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
./pymtheg check examples/mvp/algorithm.pym
./pymtheg check examples/mvp/files-buggy.pym --format json
./pymtheg check examples/mvp/files-fixed.pym
./pymtheg check examples/mvp/task-local.pym
./pymtheg check examples/mvp/checkout.pym
```

### Install from a package tarball

The package is not published yet, so install it from a tarball made with
`npm pack` (after `npm run build`):

```sh
npm pack --ignore-scripts                     # writes pymtheg-1.0.0.tgz
npx ./pymtheg-1.0.0.tgz --help                # one-off run; note the ./
npm install --global ./pymtheg-1.0.0.tgz      # or a global install
pymtheg doctor
```

Write the tarball as `./name.tgz` (or `file:/absolute/path/name.tgz`): npm treats
a bare absolute path such as `npx /tmp/pymtheg-1.0.0.tgz` as a command and fails
with exit 126. The installed package has five runtime dependencies (ten packages
in all) and no install scripts; the browser app and grammars ship prebuilt.
Licences of everything it ships are in [docs/licences.md](docs/licences.md) and
`THIRD-PARTY-NOTICES`.

For coding agents, prefer the MCP server (`pymtheg mcp`, one long-running
process) or a global install over running `npx` per call: each `npx` call costs
about 3 s and 165 MiB before any work (measured on the dev server).

`pymtheg studio` and `pymtheg mcp` stop cleanly on SIGINT (Ctrl-C) and SIGTERM.
When they run under `npx`, npm passes a signal sent to the `npx` process only to
its own child, a `sh -c` shell. Where that shell keeps itself as the parent of
the command instead of replacing itself with it (as in some Debian-based images),
the signal never reaches Pymtheg and `npx`, the shell and the server keep running.
A terminal's Ctrl-C signals the whole process group and is not affected. A
supervisor that stops the server by PID should signal the process group
(`kill -INT -- -PGID`) or run the installed `pymtheg` binary directly.

The algorithm reports `N * N` comparisons (at most 40,000 for N <= 200) and an
independent alpha-renamed policy copy. The bad file flow leaks on InvalidData;
the corrected version closes on success, error and cancellation. The local task
model contrasts three blind retry attempts with one attempt followed by explicit
uncertainty propagation. The exploratory
checkout quote reports `3 * N = 600` remote calls against a budget of 500 and keeps
the payment reconciliation hole incomplete. These examples deliberately have
different exit statuses; a warning about duplicate rules alone doesn't fail.

You write Pymtheg designs; you do not need to learn a backend language.
`check` runs local analyses and works offline once built. For behavioural
exploration, `verify` runs a built-in exhaustive breadth-first search and
`simulate` a built-in seeded sampler. Both run in Node worker threads inside
Pymtheg: no other program, runtime or download is needed, and the CLI, Studio and
MCP use the same engines. Findings map back to your source and each invariant
gets its own result, plus one `state-domains` result for declared ranges.
`--state-budget N` (default 1,000,000 distinct states) bounds `verify`; running out
leaves the unviolated properties inconclusive (exit 2), never passed. An engine
or worker error is a failure (exit 3, `B104`), never a verdict.

```sh
./pymtheg simulate examples/mvp/task-buggy.pym --entry TaskRunner --seed 42 --max-steps 12 --max-samples 1000
./pymtheg simulate examples/mvp/task-fixed.pym --entry TaskRunner --seed 42 --max-steps 12 --max-samples 1000
./pymtheg simulate examples/mvp/checkout-fixed.pym --entry Checkout --seed 42 --max-steps 12 --max-samples 1000
./pymtheg verify examples/mvp/checkout-fixed.pym --entry Checkout
./pymtheg emit examples/mvp/task-buggy.pym --entry TaskRunner --target json --out /tmp/task-model.json
```

Models and their source maps come from the typed project, not fixture names.
Counterexamples are replayed against the source event semantics before they are
reported. A corrected sampled run reports
`no_counterexample (simulation, sampled, not exhaustive)`, never an unqualified
verified result. In JSON (CLI `--format json`, MCP, Studio) every behaviour
result carries `exhaustive`. It describes the search, not the verdict: `true`
only when every reachable state was searched (a completed `verify`), `false` for
every `simulate` result and every search that stopped early or never started
(budget, timeout, engine error, unsupported lowering). Read `exhaustive`, not
`completion`, to tell a proof from a sample: a sampled run reports
`no_counterexample` / `complete` with `exhaustive: false`. A counterexample is
real whatever `exhaustive` says.
`emit --target json` writes the lowered model the engines check
(machine, source mapping, bounds, assumptions and, for flows, the finite
source-state graph) so you can inspect it.

Source domains define finite scope. Optional `--scope scope.json` must contain
`{"domains":{"phase":"0..4", ...},"assumptions":[]}` with **all** domain entries
exactly matching the source. No automatic scope reduction. `--timeout 500ms` or
`45s` bounds checking work (max 120s). `--seed`, `--max-steps` and `--max-samples`
belong to `simulate`; `--state-budget` to `verify`.
`--out report.json` on check/simulate/verify atomically publishes a report while
retaining stdout findings. `--format json` is versioned, log-free stdout;
`--verbose` phase messages go to stderr. Bounds are decimal strings in JSON.

Exit codes: **0** requested checks complete without errors; **1** design/language
errors or counterexample; **2** incomplete/unsupported/timeout/stale evidence;
**3** invocation, IO, integration or internal failure; **130** cancellation.
Cancellation wins; fatal failure wins over errors, errors over incomplete-only.
Every property retains its own evidence even when the single exit code differs.

## Language boundary

Read the [grammar](docs/grammar.md) and [support/semantics matrix](docs/support.md).
The core supports typed records/unions/results/lists, named pure rules, explicit
operations/effects, structured bounded flows, unknown decisions, and conservative
single-owner resources. Costs are declared additive counters, not inferred elapsed
time or peak memory. Abstract operation summaries are environment assumptions.

Behavioural lowering supports **explicit finite scalar event machines and bounded
structured flows**, including finite records/lists/outcomes, nested calls, retries,
resource results and linked provider protocols. General aliases, owned resource
collections, outer-resource loop invariants, full logical proofs, recursive cost
proofs, arbitrary parallelism, temporal liveness, extraction and production
conformance remain outside this bounded release. Unsupported requested claims remain
visible and fail with status 2. Read [decisions and risks](https://github.com/KarlLivesey/pymtheg/blob/main/docs/decisions.md).

The four domains are in [examples/mvp](examples/mvp). The separate
`checkout-late.pym` models late effects and independently failing compensation;
pending reconciliation is not terminal and no eventual completion is claimed.
Executable [self-models](examples/self) expose repeated parsing and worker/publication
lifecycle decisions without reimplementing the compiler.

## Validation and evidence

```sh
npm test                    # fast source/CLI, schema, lifecycle and cancellation suite
npm run test:backend        # behavioural, Rust/Go compiler and MCP integration suite
npm run bench               # instrumented 1,000 / 10,000-rule measurements
npm run capture             # schema-validated reports, bounded real runs
npm run format:check
./pymtheg fmt examples/mvp/library.pym --check
./pymtheg doctor --format json
```

Behavioural integration tests explicitly report a skip when a configured checker
time budget expires; that is never a passed correctness assertion. Set
`PYM_TEST_BACKEND_TIMEOUT=45s` to choose a larger explicit integration budget.
Correctness tests use readiness events, controlled clocks and deterministic counts;
benchmark timings are informational only.

- [Maintained self-map](https://github.com/KarlLivesey/pymtheg/blob/main/docs/runtime-map.md), [initial prerequisite map](https://github.com/KarlLivesey/pymtheg/blob/main/design/initial-system-map.md).
- [Requirement/component/test checklist](https://github.com/KarlLivesey/pymtheg/blob/main/docs/requirements.md), [loop record](https://github.com/KarlLivesey/pymtheg/blob/main/docs/progress.md).
- [Versioned report schema](docs/report.schema.json), [captured acceptance commands/results](https://github.com/KarlLivesey/pymtheg/blob/main/evidence/acceptance.json).
- [Measured parser/rule/graph/cost counters](https://github.com/KarlLivesey/pymtheg/blob/main/evidence/benchmarks.json), [validation notes](https://github.com/KarlLivesey/pymtheg/blob/main/evidence/validation.md).

## Preserved research

[Comparison](https://github.com/KarlLivesey/pymtheg/blob/main/research/comparison.md), [original proposal](https://github.com/KarlLivesey/pymtheg/blob/main/design/proposal.md),
[primary-source manifest](https://github.com/KarlLivesey/pymtheg/blob/main/research/sources/index.json), and the hand-written
[Quint](https://github.com/KarlLivesey/pymtheg/blob/main/examples/checkout.qnt)/[TLA+](https://github.com/KarlLivesey/pymtheg/blob/main/examples/Checkout.tla) baseline remain intact.
Historical logs are under `research/results/`. New implementation evidence is
under `evidence/`; it does not retroactively upgrade the research spike.
`examples/checkout.s15` is an aspirational incomplete sketch, **not accepted input**.

The original experiments sampled 1,000 corrected Quint traces of six transitions
and exhausted eight states of a manually aligned TLA+ model, using external tools
that Pymtheg no longer uses or needs (decision D2). The generated checkout
separates submission, provider effect and delivery; the built-in search exhausts
its corrected finite case. Neither proves translation correctness in general or
conformance of a production implementation.

Public naming values live in `src/shared/identity-values.ts`, re-exported by
`src/shared/identity.ts`. The CLI, source discovery, scenarios, generated source
filenames and browser forms use those values. A rename also updates package
metadata/bin and the local launcher; persisted storage/protocol IDs need an
explicit migration rather than a cosmetic rename. No publication work.

For a design that already has handwritten implementations, use
`pymtheg scaffold design.pym --mode contracts --target typescript` (or `rust` /
`go`). Keep that generated interface/trait file separate and implement
`PymthegContracts` in your own file. Save a comparison baseline with
`--manifest contracts.manifest.json`; after a design change,
`pymtheg scaffold design.pym --check contracts.manifest.json` lists added,
removed or changed contracts. Studio offers the same workflow under output
purpose. Neither comparison nor compilation proves the implementation's behaviour.

## Licence

Pymtheg is licensed under the MIT License; see [LICENSE](LICENSE).
Third-party components and their licences will be listed in `docs/licences.md`
and `THIRD-PARTY-NOTICES` once the licence inventory work lands.
