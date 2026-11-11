# W2-G: flow lowering no longer changes its input

Fix for mega-plan item 1.3 (diagnosed in `evidence/w1-f/tlc-replay-b106.md`).

`graphMachine()` (`src/behaviour/flow.ts`) used to add the executionSafe
assumption to its `plan` and overwrite `graph.assumptions`. The backend
precheck `sourceMappingValid()` calls it again on the stored model graph with a
fresh, unexplored plan, which replaced the stored assumptions and broke the
model hash. Flows with no assertion, contract, resource or protocol that call an
operation therefore failed `verify`/`simulate` with B106 before any checking ran.

`flowGraph()` now records the executionSafe assumption in the graph it returns,
and `graphMachine()` only reads its arguments. Both use one shared
`propertyKinds()` helper, so the decision is made by one rule. Lowered models
are byte-identical to before for every supported example flow (same model
hashes); only the precheck stops corrupting them.

Contract or support change: none. `examples/self/discovery.pym#selectSourceTree`
now verifies under TLC as `executionSafe no_counterexample complete` (38
distinct states) instead of B106.

Follow-up, not done here: B106 still names two different failures, this
precheck ("Snapshot/model/source-map identity mismatch") and a real failed
witness replay. Giving the precheck its own code needs `src/backends/adapter.ts`.
