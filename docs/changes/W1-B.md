# W1-B: built-in engine library

New library only; no command, adapter, Studio or MCP wiring changes.
`explore.ts` exports `explore(model, options?, ir?)` and
`sample(model, options, ir?)`, taking the existing `GeneratedModel`.
Pass the original typed `ProjectIR` as `ir` for flow witness replay. No source
parsing or lowering occurs in the engines; existing `initial`, `evaluate`, `step`,
`domainValid` and `replay` own the semantics. The caller owns preflight, snapshot
identity, scope issues and translating this library result into product reports.

`ExploreResult` is exactly:

- `method`: `exhaustive | sample`.
- `completion`: `complete | state_budget | domain_boundary | cancelled |
  timed_out | engine_error`. `complete` describes completion of the requested
  search or samples, not a combined safety verdict.
- `properties`: one `PropertyVerdict` per `model.properties` entry in its order.
- `domain`: a separate `PropertyVerdict` with `property: "state-domains"`.
- Each verdict has `property` (source name), `verdict` (`passed | violated |
  incomplete | no_violation_found`), and optional `trace: TraceState[]`.
  Only `violated` has a trace; it includes initial state/event `-2`, source scalar
  values (including bigint), and source event indexes. Traces are not JSON-safe
  without bigint serialization. Every returned witness has passed `replay` and
  validation of its particular property/domain failure.
- `measurements`: `{statesVisited, transitionsTaken, depthReached, samples}`,
  or `null` when no engine measurements are available (worker interruption or
  startup failure). State count is distinct source-value states, including initial
  and admitted out-of-domain states, excluding event identity. Transitions count
  every executed enabled event, including edges to visited states and the edge
  which detects an exceeded budget; deadlocks count one implicit stutter. Depth
  is maximum admitted BFS depth or actual sampled walk depth. `samples` is zero
  for exhaustive checking and walks started for sampling.
- `sampling?`: `{seed, maxSteps, maxSamples, fingerprint}`, present on successful
  sampler execution. Fingerprint is eight hex digits of a uint32 FNV-1a event
  sequence accumulator (initial markers included); diagnostic, not proof of trace
  identity. `error?` supplies engine failure text.

Exhaustive options: `stateBudget`, a positive safe integer, default **1,000,000**.
BFS visits enabled events in model event order and retains first parents, so each
property's first witness has shortest transition length. State encoding sorts
names and tags scalar types. Exact equality guards between a state name and a
literal use an index; remaining guards still use the shared evaluator. Named
steps use a one-event view of the same machine to avoid repeated linear lookup.
A budget exactly equal to the reachable state count may complete; attempting to
admit one additional distinct state stops with `state_budget`. All unviolated
properties and domains become `incomplete`. Already replayed violations survive.

An out-of-domain successor is inspected and replayed, but not expanded: source
replay only permits a domain failure at a witness's final event. Search continues
through other valid states. Completion becomes `domain_boundary`, and unviolated
claims are incomplete. Any evaluator/replay failure returns `engine_error`, clears
all witnesses and makes every verdict incomplete. No invalid witness is published.

Sampler options (all required): `seed: string`, `maxSteps` (nonnegative safe
integer), `maxSamples` (positive safe integer). Seed hashing uses UTF-16 code units
with FNV-1a, then Mulberry32 drives uniform event selection by array index.
Each sample restarts at `initial()`, runs up to `maxSteps`, and deadlocks stutter.
Out-of-domain walks stop at their first domain failure. The same model/options
produce the same walks, witnesses, fingerprint and counts. A completed sample
reports `violated` or `no_violation_found`, **never `passed`**; `samples` states the
number of walks checked. Sample witnesses need not be shortest.

`runExplore(request, options?)` in `explore-runner.ts` returns a promise of
`{result: ExploreResult, elapsedMs: number}`. Request is `{model, ir?, method:
"exhaustive", options?: ExploreOptions}` or `{model, ir?, method: "sample",
options: SampleOptions}`. Options are `signal?: AbortSignal`, `timeoutMs?: number`
(default 120,000, finite and nonnegative), `onReady?: () => void`, and
`clock?: {now(): number; setTimeout(callback, ms): unknown;
clearTimeout(handle): void}`. Clock callbacks follow timer scheduling semantics.
The timer starts after worker creation and before readiness. Readiness calls the
hook before acknowledging start; cancellation there prevents search. The runner
owns and awaits worker termination on every exit. Cancellation/timeouts yield
`cancelled`/`timed_out` with all verdicts incomplete, no traces and null counts.
No partial worker evidence is guessed. Worker startup/exit errors and hook failures
become `engine_error`. Elapsed milliseconds are observations only.

Evidence: `evidence/w1-b/README.md`, `examples-comparison.json` and check logs.
This fragment is for the wave ledger to fold into support/decisions later.
