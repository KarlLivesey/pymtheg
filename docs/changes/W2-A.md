# W2-A: built-in behaviour backend is the CLI default

`verify FILE --entry NAME` now runs the built-in exhaustive breadth-first search.
`simulate FILE --entry NAME` now runs the built-in seeded sampler, respecting
`--seed`, `--max-steps`, `--max-samples` and `--timeout`. Both use the production
worker coordinator and need neither Java, a TLC JAR nor Quint. Explicit
`--backend builtin` selects the same implementation. `--backend tlc --tlc-jar PATH`
and `--backend quint` retain the external comparison engines. Emission is unchanged.

`--state-budget N` configures exhaustive source-state capacity, default 1,000,000;
it must be a positive safe integer. The sampler has its own step/sample limits.
The adapter's `BackendOptions` adds optional `method: "exhaustive" | "sample"`
(default exhaustive) and `stateBudget`; omitted `backend` means builtin. Existing
explicit external backends retain their existing behavior. A final optional
`RunExploreOptions` argument permits deterministic production-runner clock/ready
hooks; the adapter always supplies the requested signal and timeout itself.

Every invariant has its own result, plus a separate `state-domains` result.
Exhaustive successes use `no_counterexample (finite_model_check, complete)`;
sampled successes use `no_counterexample (simulation, complete)` and the engine
verdict `no_violation_found`, never an exhaustive pass. The witness derivation
records the engine verdict, whole-search completion and sampler fingerprint.
Shortest BFS counterexamples retain source-replayed events/states. Sample traces
are replayed but need not be shortest. A failure in one invariant no longer
leaves other invariants inconclusive merely because checking stopped there.

Budget exhaustion and domain boundaries make unviolated properties incomplete;
timeout and cancellation retain their report completion categories. Worker or
engine errors map every property to inconclusive/incomplete. Limit diagnostics
name `stateBudget` or `timeoutMs`. Already replayed violations survive a state
budget/domain boundary; an interrupted worker supplies no guessed partial counts
or witnesses. W1-B's engine result shape is unchanged.

The discovery baseline B106 remains unresolved in shipped code. Its known cause is
flow lowering mutating its input during `sourceMappingValid`; the fix is scheduled
as W2-G. No TLC trace failed replay. Expected TLC verdict after that fix is
`no_counterexample`, complete, 38 states. Direct built-in exploration on the same
lowered model completes with `executionSafe` holding, 30 distinct source states
and 37 transitions (TLC includes last-event identity). This execution-only result
retains the existing no-business-safety assumption. See the direct evidence script.
No change to `flow.ts`, `model.ts`, or the identity gate is shipped in W2-A.

## Wiring still needed outside this chunk

These files were inspected but not changed:

- `src/mcp/workspace.ts:185`: replace `backend: kind === "verify" ? "tlc" : "quint"`
  with `backend: "builtin"`, and add `method: kind === "verify" ? "exhaustive" : "sample"`.
- `src/studio/service.ts:3392`: replace the analogous conditional backend with
  `backend: "builtin"`, and add `method: run.request.kind === "verify" ? "exhaustive" : "sample"`.
- `src/studio/service.ts:3207-3208` still exposes legacy Quint/TLC availability;
  the later removal/wiring chunk should update consumer-facing tool status.

Thus CLI defaults are self-contained now; MCP and Studio still explicitly select
external engines until their owners apply those changes. The adapter result shape
remains compatible with their consumers. No MCP, Studio, support matrix, decision
ledger or MCP documentation was edited; this fragment is for the manager to fold in.

## Existing tests adjusted for the default change

Only explicit backend selections were added, preserving each test's intended
external-backend coverage: `test/session.test.mjs` (fake Quint process lifecycle),
`test/backend.integration.mjs`, `test/domain.integration.mjs`,
`test/flow.integration.mjs`, `test/machine-authoring.integration.mjs`,
`test/operation-authoring.integration.mjs`, `test/unused-scope.integration.mjs`.
Their former implicit simulation backend was Quint. Assertions were not weakened.

See `evidence/w2-a/README.md` and `comparison.json` for all 49 examples and 86 trials,
classification explanations, performance observations and check results. Trial
models, scopes, source snapshots, state values and traces were not committed.
