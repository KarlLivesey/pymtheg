# R1-A: remove TLC, Quint and Java

Mega-plan item 2.9; decisions D2 (no Java, no TLC JAR, no Quint) and D7 (no
backwards compatibility). First item of the initial-release definition:
"`npx pymtheg` runs on a clean machine with no Java or Quint". Evidence:
[evidence/r1-a/](../../evidence/r1-a/README.md).

## Capability check before deleting

Sources: the W2-A differential (`evidence/w2-a/README.md`,
`evidence/w2-a/comparison.json`: 49 example and 86 trial entries, zero conclusive
or unexplained disagreements; the known B106 was fixed by W2-G), the adapter and
model code, and the tests that ran both engines.

| What TLC or Quint gave the user | Built-in engine | Status |
|---|---|---|
| Exhaustive finite safety check (TLC) | Breadth-first search in a worker, named `--state-budget` | provided; W2-A differential agrees |
| Per-invariant verdicts | One verdict per invariant, each checked independently | better: TLC stopped at the first violation and left the rest inconclusive |
| Declared-range (domain) violations | `state-domains` result on every run, with the B011 finding | provided; now reported as a holding result too, not only when violated |
| Invariant failing in an out-of-range state: "Fix the event's range violation first" advice | was missing | **implemented in this chunk** (`src/backends/adapter.ts`), covered by `test/domain.integration.mjs` "upper" |
| Shortest counterexample (TLC breadth-first) | Breadth-first, shortest | provided |
| Source replay of every witness | Engine replays before reporting; adapter replays for display | provided |
| Seeded random simulation (Quint) | Seeded sampler, same seed and limits give the same result | provided; traces differ from Quint's (different sampler), and a sample is never a pass |
| Deadlock / liveness | — | not a gap: the generated TLA+ modelled deadlock as an `Idle` stutter and checked only `INVARIANT Safety`; Quint checked only `safety`. Neither ever checked deadlock or liveness |
| `emit --target quint` (inspect the generated model) | `emit --target json` writes the lowered model the engines check | replaced; Quint/TLA+ text export is gone by decision (D2) |
| TLC `statesGenerated` measurement | `statesVisited`, `transitionsTaken`, `depthReached` | replaced |
| Studio and MCP `verify`/`simulate` | They selected TLC and Quint explicitly; `verify` failed without a JAR | now on the built-in engines (a gain) |

No capability became a false pass. Nothing was left "not supported yet".

## What was removed

- `src/backends/adapter.ts`: the Quint and TLC paths (temporary workspace,
  version and JAR-digest checks, `java` launch, ITF and TLC-trace parsers,
  `quintVersion`, `tlcHash`, `locateQuint`, `defaultQuint`), the `backend`,
  `quint` and `tlcJar` options, the injectable process runner parameter and the
  temporary-directory cleanup record. `runBackend(ir, options, signal,
  exploreOptions)` is the one path.
- `src/behaviour/model.ts`: the TLA+, TLC config and Quint text generation and
  the `quint`/`tla`/`config` fields; the `generated` names (`v0`, `p0`) in the
  source mapping. The model hash is now over the machine, the mapping and (for
  flows) the flow graph.
- `src/shared/operators.ts`: `backendOperator` (Quint/TLA+ spellings). Replaced
  by `scalarBinaryOperators`, the operators the shared evaluator implements; the
  behavioural preflight now checks operators and state names directly (these
  checks used to happen implicitly while printing TLA+/Quint).
- CLI: `--backend`, `--quint`, `--tlc-jar`, `PYM_TLC_JAR`, `emit --target quint`
  and its `.map.json` side file. Help text.
- `doctor`: the Quint, Java and TLC checks and the `jar` parameter.
- Studio: `startStudio({ tlcJar })`, `StudioService`'s `tlcJar` constructor
  parameter, `ProjectView.tools` (`{ quint, tlc }`), `agentConnection.env` (it
  only carried `PYM_TLC_JAR`), and the web text "TLC is not configured" and
  "Quint: … · TLC: set PYM_TLC_JAR …".
- MCP: `AgentWorkspace`'s `tlcJar` parameter, `project_info`'s `tools` field, the
  `PYM_TLC_JAR` read in `runAgentStdio`, and the `explore_behaviour` description
  naming Quint and TLC.
- Diagnostic codes B102, B103, B105 and B107 (external process, version, output
  and temporary-workspace failures) and their explanations.
- `@informalsystems/quint` (optional dependency) from `package.json` and
  `package-lock.json`; 70 packages leave the full install.
- Tests: `test/backend-location.test.mjs` (Quint lookup), the ITF parser test, and
  the fake-Quint session tests whose only subject was the external process
  (crash, malformed output, timeout, missing tool).

## What replaced it, and other changes

- `emit FILE --entry NAME --target json --out MODEL.json` writes
  `pymtheg.model/v1`: snapshot id, model hash, lowered machine, source mapping,
  bounds, assumptions, flow scope and source states, and source hashes. It still
  refuses an unused scope (B014) and never overwrites a source.
- `doctor` runs the real lowering and search workers on a built-in probe machine
  (verifier: one failing and one holding invariant; simulator: the failing one),
  opens in-memory SQLite through the storage boundary, loads the Go and Rust
  Tree-sitter grammars, and checks the Studio build. Exit 3 if Node, the
  verifier, the simulator or storage is not ready.
- A built-in worker or engine error is now `completion: "failed"` with B104,
  error severity and exit 3 (W2-A backlog: it used to look like a budget-limited
  run, exit 2).
- Options belonging to another command are rejected (W2-A backlog):
  `--state-budget` outside `verify`; `--seed`, `--max-steps`, `--max-samples`
  outside `simulate` (scenario defaults are still accepted); `--target` outside
  `emit`.
- Plain-text `simulate` output shows `(simulation, sampled, not exhaustive)` for a
  sampled no-counterexample result instead of `complete` (W2-A backlog). JSON is
  unchanged.
- Studio and MCP pass `method: "exhaustive"` (verify) or `"sample"` (simulate).

## Tests: kept, converted, deleted

Every test that ran an engine now runs the built-in one, with no skip for lack
of Java. Expected values that were TLC's answers and are still right:

- `test/flow-lowering-pure.test.mjs`: `stampOnce` and `discovery.pym#selectSourceTree`
  — no B106, `no_counterexample`, `complete` (the W2-A/W2-G expected verdict,
  first established with TLC). It previously skipped without a JAR.
- `test/backend.integration.mjs` "verified checkout": the three defects exit 1,
  `fixed` exits 0 with every result `no_counterexample` (was "real TLC generated
  checkout").
- `domain`, `machine-authoring`, `operation-authoring`, `unused-scope`, `flow`
  integration tests and `test/mcp.integration.mjs`: the same verdicts for
  `verify` and `simulate` that were asserted for TLC and Quint. Adjusted only where
  the built-in engine reports more: the `state-domains` result is always present
  (a guarded machine now has a holding domain result instead of none), so tests
  that counted behaviour results select invariants by name.
- `test/mcp.test.mjs`: "MCP distinguishes missing integration" (verify failed
  without TLC) became "MCP verify needs no installed integration": verify now
  completes with `no_counterexample`.
- `test/session.test.mjs`: the edit-during-check test now edits the source at
  the real worker's readiness hook and checks the old snapshot id is kept and the
  file reported stale.
- `test/emit.test.mjs`: JSON model contents; a new test that `--target quint` is
  refused.
- `test/builtin-backend.test.mjs`: engine error is `failed` with B104; timeout
  B124; cancellation B130.

`npm run test:backend` keeps its name and now runs only built-in engines (plus
the Rust/Go compiler and MCP integration tests it already had).

## Justified mentions left by the grep

`grep -ri "tlc\|tla2tools\|tla+\|quint\|java" src test package.json` finds only:
"JavaScript" (language name, 52 lines), and `test/emit.test.mjs`, whose test
checks that the removed `--target quint` is refused. In docs: the D2/R1-A
statements that the tools were removed; historical sentences in the README
"Preserved research" section; `docs/support.md`/`runtime-map.md`/`decisions.md`
lines about Quint's *source repository* as a TypeScript indexing corpus; and
superseded ledger entries, marked as superseded.

## Known limits

- MCP and Studio expose no state budget for `verify`; they use the default
  1,000,000 distinct states (Stage 5 redesigns the MCP surface).
- Behavioural literals and domains stay within ±9,007,199,254,740,991. That bound
  came from JSON/ITF interchange with Quint; the built-in engine uses exact
  bigints and could lift it, but this chunk keeps the support boundary unchanged.
- The seeded sampler is not Quint's sampler: the same seed gives different traces
  from before, and on `examples/mvp/task-protocol.pym#retryJob` the default
  sampled run finds no counterexample where `verify` finds one. A sampled result
  never claims a pass.
- Quint simulation was never part of the W2-A differential (TLC only); simulation
  semantics were checked by the tests that ran both engines.
- The npm package still ships `docs/`, which includes historical documents (review
  briefs, audits, earlier chunk notes) that mention TLC and Quint as history. No
  packed file name refers to them. The hand-written research files
  `examples/checkout.qnt`, `examples/Checkout.tla` and `examples/*.cfg` stay in
  the repository as preserved research and are not packed.
- Historical documents under `docs/` (`1.0-status.md`, review briefs and audits,
  `operation-contract-authoring-map.md`) and `docs/mega-plan.md`/`docs/build-plan.md`
  were not rewritten; they describe their own time.
- `src/backends/process.ts` stays: output plugins and `observe` (git) still run
  child processes through it.
