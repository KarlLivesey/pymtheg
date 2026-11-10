# Pymtheg: the tool specified before implementation

Status: reviewed design draft, not an implemented or mechanically verified specification. Pymtheg is the working name; it is Welsh for fifteen. The earlier research used “Standard 15.” Naming is reversible and must not dominate engineering work.

This map describes the tool in the form we want the tool eventually to describe other programs: entities, signatures, data passing, effects, ownership, states, failure paths, repeated work, budgets, and open decisions. It is deliberately independent of a parser that does not exist yet.

## 1. User objective and system boundary

The user describes a program before implementing it. Pymtheg helps find missing decisions, incompatible contracts, invalid lifecycles, repeated rules, and multiplied work while changes are inexpensive.

The language targets general program design: pure algorithms, command-line tools, file processing, task runners, applications, and distributed services. It may describe abstract operations without implementing their libraries. A first implementation has a documented subset; “general purpose” is a direction, not a claim to support every feature immediately.

Inputs are source documents, explicit project settings, declared environment contracts, requested properties, and optional bounded checker settings. Outputs are human-readable findings, a versioned JSON report, optional generated models, and replayable traces with provenance.

Within the boundary: parsing, type resolution, model construction, local analysis, structural cost analysis, rule comparisons, bounded behavioural lowering, checker execution, trace mapping, and reporting.

Outside the initial boundary: production code generation, arbitrary codebase ingestion, a GUI/LSP, distributed backend hosting, universal complexity inference, arbitrary semantic equivalence, proving all possible requirements complete, and full implementation conformance. These are potential extensions, not hidden prerequisites.

Ordinary local checking must work offline. Specifications are data, never JavaScript/Python to evaluate. Reading a specification does not grant permission to perform its declared network/filesystem effects.

## 2. Top-level flow

```text
CLI request + configuration
    |
    v
source loader --> immutable source snapshot + import/declaration graph
    |
    v
lexer/parser --> source-spanned AST, recovery diagnostics, explicit holes
    |
    v
resolver/type checker --> typed project IR + capabilities + dependency graph
    |
    +--> contract/outcome checks ----------+
    +--> effect/ownership/lifecycle checks +--> property results and findings
    +--> structural cost analysis --------+
    +--> exact rule comparison -----------+
    |
    v  only for requested, supported behavioural slices
lowering preflight --> source-mapped finite model --> backend adapter
                                                    |
                                                    v
                                              raw checker result
                                                    |
                                                    v
                                           validate/map/replay trace
                                                    |
                                                    v
shared evidence aggregator --> text / JSON / optional artifacts
```

All analyses consume one canonical IR snapshot. No analyser reparses source or invents a separate definition of errors, ownership transfer, calls, or costs. Interpretation and lowering use the same expression/operator definitions. A small reference step semantics supports trace replay; it is not a second model checker.

## 3. Data identities, versions, and source locations

| Entity | Identity and contract |
|---|---|
| `SourceSnapshot` | Immutable set of canonical file identities, content hashes, source bytes/text, and import edges. Has a snapshot hash. |
| `SourceSpan` | File identity and half-open offsets into the exact snapshot; define encoding explicitly. Use UTF-16 code-unit offsets internally if using TypeScript strings, and a line index for presentation. Do not mix byte/code-point/code-unit offsets. |
| `NodeId` | Unique within one snapshot; not promised stable across edits. Always qualified by snapshot identity in persisted artifacts. |
| `SymbolId` | Qualified module/declaration identity. MVP has no overloaded declaration names. Imports resolve to these IDs, not repeated strings. |
| `PropertyId` | Stable qualified identity for a declared/generated property, with a content hash for its current definition. |
| `TypedProjectIR` | Immutable, versioned representation of types, symbols, expressions, control flow, resources, effects, contracts, costs, and holes. |
| `DependencyGraph` | Edges identify the kind of dependency: calls, type references, imports, rule use, ownership transfer, assumptions, or property support. |
| `Assumption` | A declared fact not independently established: external cost, provider behaviour, finite scope, atomicity, fairness, etc. Has source/provenance. |
| `Obligation` | A fact still to establish or a required lifecycle action. Transfer changes who owns an obligation; it does not mark it discharged. |
| `Finding` | Stable category/code, severity, message, spans, related symbols, evidence reference, and optional suggested investigation. |
| `RunRecord` | Requested checks, effective configuration, tool/backend versions, input hashes, bounds, seed, elapsed measurements, artifacts, and terminal state. |

Persist exact large integers as decimal strings in JSON. Never silently round symbolic bounds through JavaScript floating-point numbers. Preserve schema and semantic versions. Store enough original context to map a result correctly; reject stale trace-to-source mappings.

A frozen snapshot contains the exact bytes actually read; this is not automatically an atomic snapshot of the entire filesystem. Detect a file changing during reading and either retry within a bound or report unstable input. Checks use the frozen content even if an editor later changes a file. Compare identities/hashes before presenting an old trace against current content.

### Candidate IR shape to make the boundary concrete

```text
ProjectIR {
  schemaVersion, semanticVersion, snapshotId,
  modules, symbols, types, rules, operations, flows, resources, properties,
  dependencyEdges, holes, sourceOrigins
}

Flow {
  symbolId, typedParameters, resultType, declaredEffects,
  preconditions, postconditions, budgetConstraints, body: Block
}

Expr = Literal | ValueRef | Field | RecordValue | TaggedValue
       | Unary | Binary | PureCall | ExplicitUnknown

Statement = BindPure | InvokeOperation | If | Match | ForEach | Retry
            | ResourceTransition | OwnershipTransfer | Return | UnknownDecision

InvokeOperation {
  nodeId, sourceSpan, calleeId, typedArgumentsWithPassingModes,
  resultBinding: TypedTaggedOrOrdinaryValue
}

CostExpr = Constant | SizeVariable | Add | Multiply | Maximum
           | SupportedSum | UnknownCost

ResourceAbstractState {
  resourceIdentity, owner, possibleLifecycleStates,
  moveState, activeBorrows, outstandingObligations
}
```

This is a candidate representation to refine, not existing source code. Record concrete field/type choices in the grammar/IR documentation. A CFG may be derived from structured blocks for analysis, but must preserve the same source semantics and origins. Effectful invocation is explicit; it is not hidden in a supposedly pure expression. A pure call still contributes declared intrinsic work and respects short-circuit evaluation. Matching a tagged operation result handles its variants through the ordinary flow model, rather than a second unrelated error mechanism.

Built-in resource creation, borrowing, and release can initially be typed operation forms rather than a separate statement for every convenience keyword. Preserve their ownership/effect semantics in the canonical model. Do not add two competing representations of the same operation merely to simplify a renderer.

## 4. Component signatures and ownership

The notation below is a design contract. Functions return structured errors; ordinary user mistakes must not emerge as uncaught internal exceptions.

```text
loadProject(request: LoadRequest, cancel: CancelToken)
  -> PhaseResult<SourceSnapshot>

parseProject(snapshot: borrow SourceSnapshot, limits: ParseLimits)
  -> PhaseResult<ParsedProject>

resolveAndTypecheck(parsed: borrow ParsedProject, config: LanguageConfig)
  -> PhaseResult<TypedProjectIR>

buildDependencyGraph(ir: borrow TypedProjectIR)
  -> DependencyGraph

analyseOutcomes(ir, graph, limits) -> AnalysisResult[]
analyseEffectsAndOwnership(ir, graph, limits) -> AnalysisResult[]
analyseLifecycles(ir, graph, limits) -> AnalysisResult[]
analyseCosts(ir, graph, resourceDefinitions, limits) -> AnalysisResult[]
compareRules(ir, comparisonPolicy, limits) -> AnalysisResult[]

planBehaviourCheck(ir, entrypoint, properties, scope, backendCapabilities)
  -> Supported<CheckPlan> | Unsupported<Reasons> | Incomplete<Obligations>

lowerBehaviour(ir, plan)
  -> GeneratedModel + SourceMap + AssumptionSet

runBackend(model: borrow GeneratedModel, config, cancel)
  -> BackendOutcome

mapAndValidateTrace(rawTrace, model, sourceMap, ir)
  -> ValidatedWitness | BackendOnlyWitness | MappingFailure | StaleInput

aggregateResults(requestedChecks, phaseResults, analysisResults, runRecord)
  -> Report

renderText(report: borrow Report) -> String
renderJson(report: borrow Report) -> VersionedJson
publishArtifacts(report, artifacts, destinationPolicy)
  -> PublishedArtifacts | PublishError
```

`PhaseResult<T>` carries an optional value, diagnostics, explicit holes/blocked nodes, completeness, and phase measurements. A recovered AST is not an entirely valid AST. Error/unknown types must not be implicitly converted to `Any` or used as evidence that a check passed.

The request coordinator owns cancellation, timers, subprocess handles, and temporary artifacts. Pure analysis passes borrow immutable input and return immutable results. Backend adapters do not own the final report policy or decide whether a project is correct. Renderers only display an existing report; JSON/text cannot disagree because they reimplement judgement.

Initially execute passes sequentially unless measurement justifies concurrency. Bounded parallel analysis can be added without changing ownership contracts. Do not create a global mutable “current project” or share partially mutated symbol tables between passes.

## 5. Language semantics that must be settled first

### Types and values

Start with `Bool`, mathematical `Int`, `Nat`, `String`, and `Unit`; nominal named types; records; payload-bearing tagged unions; and built-in `List<T>` and `Result<T,E>` forms. Define list cardinality bounds independently of element types. Use integer minor units in money examples rather than requiring a decimal solver.

All operation signatures are explicit. User-defined generic functions, unrestricted refinements, subtyping, implicit coercions, and overloading are later features unless required by an acceptance example. Resolve aliases deliberately. Diagnose invalid/infinitely expanding aliases. Recursive flow signatures can be resolved, while recursive costs or behavioural lowering may remain explicitly unsupported/unknown.

Pure rule recursion is excluded from the initial total-expression subset. Do not confuse “no declared IO” with a proven total function. User data is never evaluated with the host language's unrestricted `eval` or dynamic imports.

Distinguish abstract contracts trusted as visible environment assumptions from postconditions of a concrete body that still need checking. A body does not prove its own declared postcondition by existing. First-version nontrivial logical proof may be unsupported; report an obligation rather than silently treating every claim as established. Requested type/effect checks can still complete without claiming that an unrequested logical proof was performed.

### Operations, outcomes, and effects

Use one coherent outcome mechanism: tagged outcomes/`Result`, with a documented desugaring if surface syntax uses named error handlers. Do not independently invent `throws`, `Result`, exceptions, and cancellation propagation without connecting their semantics.

Every reachable declared outcome must be handled, propagated through a compatible enclosing result type, or marked unresolved. Distinguish a definite rejection, a failure guaranteed to precede any effect, and an unknown outcome after a possible effect. Closed outcome enumerations allow exhaustive checking; future external outcomes remain an environment-contract question.

Effects identify the resource or service as well as the kind: reading one store is different from mutating another. A pure rule cannot call an effectful operation. An operation's transitive effects must be covered by its declaration. Capturing a reference does not silently remove its effects.

### Structured flow and time

Define sequence, lexical binding, branching, exhaustive pattern matching, bounded collection iteration, bounded retry, explicit resource transitions, and return. Parallel composition, async messages, and unbounded computations need planned semantics; unsupported first-version cases produce a diagnostic before lowering.

`attempts <= 3` always means three total attempts, including the initial call. A retry policy specifies which outcomes permit another attempt. It does not retry successful operations or assume all failures are effect-free. Account for backoff/reconciliation work if declared.

Sequential source order and short-circuit evaluation are explicit. Return/break paths cannot fall through into later statements. Cancellation has documented observation points and a cleanup path; it is not an invisible jump that discharges resources.

External request, provider effect, response delivery, reconciliation, and compensation are distinct events where the model needs them. Do not silently lower several external effects to one atomic action. A declared atomic block is a modelling assumption unless its implementation is established.

### Resources and ownership

Resources have initial/permitted/terminal states, transition rules, and obligations. A locally owned nonterminal resource must be settled or transferred on every modelled exit. A terminal state is not automatically reachable merely because it is declared.

MVP ownership is single-owner with limited lexical read borrowing. Consuming an owned value invalidates subsequent use. A borrowed value cannot be consumed, mutated incompatibly, or escape beyond its owner. More general aliasing/shared mutation is diagnosed as unsupported until its semantics are implemented.

Passing `take resource` transfers the obligation to a callee. A matching return can transfer it back. A callee summary must describe what happens on success, each error, and cancellation. Unknown callee behaviour cannot justify dropping a caller's obligation.

Resources created per loop iteration must be settled each iteration or returned in an explicitly supported owned collection. Do not collapse arbitrary many fresh resources into one symbolic resource and infer that one close releases them all.

### Unknowns, feasibility, and obligations

`unknown "decision"` is legal in exploratory specifications. It has a source location, dependencies, affected properties, and unresolved obligations. It is not a successful no-op. Local analyses independent of that hole can still give useful results.

Contradictory assumptions or unreachable entrypoints can make every invariant vacuously true. Check simple contradictions and reachability, and provide a non-vacuity query/witness when supported. If feasibility is not established, report that limitation rather than claiming it has been checked.

The initial feasibility checker need not solve arbitrary logic. State exactly which cases it establishes and which remain unknown. An invented requirement outside the declared model cannot be automatically discovered.

## 6. Analysis implementation map

| Analysis | Required inputs | Initial implementation | Output and boundary |
|---|---|---|---|
| Names/signatures | AST, symbol tables, scopes | Declaration pass followed by reference resolution; explicit type checking and argument checking. | Error spans and related declarations. Error recovery cannot manufacture valid values. |
| Outcome coverage | Typed results, control-flow graph | Compare declared alternatives with handlers/propagation; account for known branch reachability. | Missing declared outcome or incompatible propagation. Exhaustive relative to the declared domain only. |
| Effects | Calls and declared effect sets | Propagate summaries over the call graph; handle SCCs by a monotone fixed point or explicitly limited recursion policy. | Undeclared effect/purity violation with call path. |
| Local ownership | Resource identities, control flow, callee summaries | Conservative abstract interpretation. Track owner, moved/borrowed state, lifecycle state set, obligations. Join branches without discarding alternatives. | Invalid use/transition; possible unsettled exit. Distinguish feasible witness from conservative candidate. |
| Lifecycle progress | Resource automata and environment assumptions | Local terminal-reachability checks; behavioural backend for selected global properties. | Safety versus eventual progress are separate. Graph reachability alone is not inevitable completion. |
| Structural costs | Typed control flow, operation cost contracts, cardinality bounds | Symbolic nonnegative cost DAG per metric with sequence/branch/loop/retry composition. | Exact expression or upper bound under declared assumptions; explicit unknown terms. |
| Repeated rules | Typed pure-rule expression trees | Hash canonical syntax after parameter alpha-renaming and safe syntactic normalisation. | Independent exact copies are identified; many references to one rule are reuse. |
| Similar rules | Rule signatures, domains, canonical trees | Optional bounded candidate comparison; deferred initially if necessary. | Heuristic suggestions only. Missing a candidate under the cap does not establish absence of duplicates. |
| Change impact | Labelled dependency graph | Reverse reachability from changed contract/rule/resource nodes. | Potentially affected consumers and the reasons. This is dependency impact, not proof every consumer breaks. |
| Behaviour | Valid typed slice, scope, properties | Capability preflight, lowering, pinned Quint adapter, mapped trace validation. | Property-specific evidence with finite scope and backend details. |

Repeated read detection requires stable arguments and an explicit consistency contract. A permission check after a permission-changing effect may be necessary. Detecting repeated work does not authorise automatically hoisting or batching it.

## 7. Cost algebra and the checker's own complexity

Keep metrics independent: remote calls, database reads, CPU steps, comparisons, total allocations, peak live bytes, and latency are not interchangeable.

For worst-case work: sequence adds; exclusive branches take `max`; a loop with upper cardinality `N` multiplies a valid per-iteration upper bound by `N`; bounded retries multiply a valid attempt bound by the number of permitted attempts. Dependent loop bounds may need sums, a looser stated bound, or an unknown result. Parallel branches add total work even if they overlap in time.

Early returns, short-circuit expressions, retry stopping conditions, and infeasible branches affect counts. Conservative overestimates are acceptable when labelled as upper bounds, not exact costs. Expected costs require probability assumptions. Latency requires scheduling, concurrency, dependency, and service-time assumptions. Peak memory needs lifetimes, not just an allocation counter.

Separate an abstract operation's declared cost summary, a concrete operation's intrinsic overhead, and a flow's budget. A budget constrains an inferred total; it must not be added to that total. A declared total must not be counted again on top of its body. Costs are nonnegative and unit-checked, with explicit `exact`, `upper`, or `unknown` interpretation. Settle this distinction in the grammar before implementing arithmetic.

Example: three remote calls per item give `3N`; at `N <= 200`, at most 600 calls for that portion of the workflow. Moving one stable read outside the loop yields `1 + 2N`. Reducing it to three calls through batching requires batch-size/payload contracts. Do not include or omit payment/recovery calls without identifying the measured workflow boundary.

Unknown cost does not become zero. A recursive SCC without a supported recurrence/bound remains unknown. A zero-iteration loop can eliminate an unknown body cost only when its nonexecution is actually established.

The tool must analyse its own potential hot spots:

| Stage | Size parameters / expected scaling | Risk and planned control |
|---|---|---|
| Loading/parsing | Source bytes `B`, files `M`, import edges `I` | Read/hash/parse each snapshot once; track file and nesting limits. Imports must not expand repeatedly through diamonds or cycles. |
| Graph construction | Symbols `S`, dependency edges `E` | Adjacency maps and SCC/reachability algorithms aim for `O(S + E)` for the graph work itself. This is not a claim the whole compiler is linear. |
| Type/contract analysis | Typed nodes `T`, expression/type expansion sizes | Memoise local normalisation within a run where sound; limit alias/constraint growth. Report supported scope. |
| Path/ownership analysis | CFG nodes `C`, abstract-state combinations `A` | Worklist joins and widening/limits; avoid enumerating all source paths. Budget exhaustion produces incomplete analysis. |
| Cost algebra | Flow nodes and symbolic expression DAG size `D` | Share subexpressions; cap simplification/expansion. Avoid expanding a compact polynomial into exponential intermediate forms. |
| Exact rule copies | Total pure expression nodes `R` | Canonical hashes group candidates in expected near-linear hashing work; check equality within collision buckets. Do not compare every rule with every other rule. |
| Similar-rule suggestions | Candidate bucket sizes | Bounded optional comparisons; worst-case pairwise work is explicitly capped and reported. |
| Behavioural checking | Product of resource/data/control scopes and interleavings | State explosion is inherent; explicit limits, cancellation, and small selected slices. Timeouts are not successful checks. |
| Trace mapping/rendering | Trace length `L`, event/state payload size | Bound capture sizes; stream or cap output with an explicit truncation marker; preserve the original artifact if retained. |

Record actual per-phase duration and sizes before adding persistent caches. Start without cross-run caching. A future cache key must include semantic IR/dependency hashes, property/configuration, assumptions, analyser/backend versions, scope, and relevant environmental inputs. Cached diagnostics also need fresh source mapping; unchanged semantics do not imply unchanged line numbers.

## 8. Evidence model and shared judgement rules

A diagnostic's severity is not its evidence strength. A backend exit code is not a correctness verdict. A result should carry orthogonal fields such as:

```text
AnalysisResult {
  propertyId, propertyHash, analysisKind,
  outcome: counterexample | no_counterexample | established | inconclusive | not_run,
  method: structural | abstract_interpretation | simulation | finite_model_check
          | deductive_proof | heuristic,
  completion: complete | incomplete | unsupported | timed_out | cancelled | failed,
  scope: { snapshotHash, modelHash?, configurationHash, bounds?, seed? },
  assumptions: AssumptionId[],
  outstandingObligations: ObligationId[],
  witnessOrDerivation?,
  witnessValidation: source_replayed | backend_only | unvalidated | not_applicable,
  diagnostics: Finding[],
  toolVersions, measurements
}
```

Centralise at least these policies so the same logic is not independently written in the CLI, analyser, adapter, and renderer:

1. `MayReportEstablished`: relevant analysis completed; prerequisites satisfied; method actually establishes the property within its stated scope; assumptions remain visible.
2. `AffectedByHole`: dependency-based propagation of unresolved decisions. Unrelated properties need not become unusable.
3. `ObligationDischarged`: valid terminal transition or verified transfer/summary; not “a function returned.”
4. `EffectCovered`: the caller's effect declaration covers the transitive effect on the specified target.
5. `OutcomeHandled`: explicit branch or compatible propagation with the correct ownership obligations.
6. `SourceMappingValid`: exact matching snapshot/model identities and valid generated-to-source spans/events.
7. `SafeToSuggestHoist`: stable inputs, consistent reads, and no intervening relevant mutation; still a suggestion.
8. `ComputeExitStatus`: one policy based on the requested analyses and final result set.

A sampled no-counterexample result stays sampled. A finite exhaustive result is limited to its selected model/scopes. An overapproximated violation may be spurious until validated. Underapproximation can find witnesses but cannot establish absence of bugs outside the explored subset. A timeout, cancellation, missing tool, unsupported feature, or vacuous model must not be rendered as “passed.”

Proposed CLI exit policy: `0` requested checks completed without error findings; `1` diagnosed language/design errors; `2` requested analysis incomplete/unsupported; `3` invocation/IO/integration/internal failure; `130` user cancellation. Fatal tool failure takes precedence over ordinary findings; ordinary error findings take precedence over incomplete-only status. JSON preserves every result regardless of the single exit code. Heuristic warnings alone do not fail unless requested by a warnings-as-errors option. An unrequested backend is not a failed local check.

## 9. Lifecycles and failure recovery of Pymtheg itself

| Resource / state machine | States and required exits | Important failure behaviour |
|---|---|---|
| Analysis session | `Created -> Loading -> Analysing -> [Checking] -> Aggregating -> Completed`; may enter `Cancelling`, `Cancelled`, or `Failed`. | Exactly one terminal session state. Completed does not mean the program passed: it means the session completed and produced its findings. |
| Source snapshot | `Building -> Frozen -> Released` or `Invalid`. | Every result refers to one frozen snapshot. Mid-run file edits do not mix versions; mark later results stale or run a new session. |
| External checker | `Prepared -> Spawned -> Running -> Exited`; cancellation/timeout follows `Stopping -> Terminated -> Reaped`. | Coordinator owns process group, deadlines, output limits, and cleanup. Reap descendants; never leave a checker running after a terminal request. |
| Temporary workspace | `Allocated -> Populated -> InUse -> Cleaning -> Removed` or `CleanupFailed`. | Cleanup on success, error, timeout, and cancellation. Diagnostic artifacts may be retained intentionally with a stated retention policy. |
| Output artifact | `Staged -> Validated -> Published` or `Abandoned`. | Publish via atomic replacement where supported. Do not corrupt a previous report with half-written JSON. Report output-path errors without losing available text diagnostics. |
| Evidence record | `Pending -> Produced -> Validated -> Reported`, or `Invalid/Unvalidated`. | Raw backend text is not validated source-level evidence. Parse/mapping failures stay visible and never fall back to a success. |
| Future cache entry | `Absent -> Building -> Validated -> Committed` or `Invalidated`. | Disabled in MVP. No partial entry is reusable; all semantic/version dependencies belong in the key. |

Use argument arrays to launch tools, not shell interpolation. Keep backend output separate from JSON stdout. Cancellation must stop accepting new work, terminate owned subprocesses, collect completed partial results, release resources, and produce an explicitly cancelled outcome. Cleanup errors are reported without rewriting the original analysis failure.

CPU-bound local analysis also needs a cancellation strategy. In Node.js, installing a signal handler is insufficient if synchronous analysis monopolises the event loop. Choose and test cooperative yields/checkpoints or an owned analysis worker; keep backend subprocess ownership in the coordinator. If using a worker, account for snapshot/IR transfer and memory duplication. Do not claim prompt cancellation based only on the external-checker timeout test.

Adapter errors distinguish executable missing, unsupported version, spawn failure, configuration error, nonzero checker result, malformed output, output truncation, timeout, cancellation, and internal adapter defects. Do not classify all nonzero exits as counterexamples.

## 10. Behavioural backend boundary

Quint is the initial behavioural backend candidate, not the whole language semantics. Its language has no recursive operators/functions; its effects concern specifications and do not automatically implement Pymtheg's service/resource effect system. TLC finite-state checking and Apalache bounded/symbolic checks have different guarantees. Record the actual selected engine and configuration.

Before generating a model, establish that the requested slice fits a published support matrix. Choose finite object/data scopes explicitly. Preserve operation outcome variants, request/effect/response uncertainty, ownership-state changes, and the selected atomic boundaries. Never lower an unsupported feature to `true`, zero, an empty body, or a silently shortened loop.

Generated actions carry IDs mapped to source constructs. Validate/replay a counterexample against the supported source-step semantics where possible. If only backend evidence is available, label it `backend_only`. Hardcoding checkout behaviour or replacing source analysis with string matching is not an implementation of the language.

Integration tests must include renamed/rearranged versions of the same program and a second independently structured program. Compare finite transition systems or traces for tiny supported models; do not claim general equivalence from a handful of tests.

## 11. Research facts and current evidence

The prior work reviewed Quint, P, Dafny, RaML, TLA+/PlusCal, Alloy 6, F*, VDM/VDMJ/Overture, and Why3. VDM is particularly close to general specification-first design; VDM-RT includes timing/deployment analysis. Quint is approachable for executable behavioural specifications. RaML is a strong reference for resource accounting. No one project was shown to deliver the entire proposed authoring and analysis workflow.

Only Quint and TLA+/TLC were executed in the prior experiment. Quint 0.33.1 and TLC 2.19 independently found three deliberately planted checkout defects: duplicate capture after a lost response, stock retained after cancellation, and a retained charge after cancellation. The corrected Quint model had no violation over 1,000 sampled traces of up to six transitions. TLC exhausted eight reachable states of the corrected finite model.

Those hand-written models were manually aligned; no equivalence proof was performed. There was one checkout, one reservation, at most two payment attempts, guaranteed provider acceptance, uncertain response delivery, and atomic successful refund/release. There was no liveness proof or check against a production implementation. Do not upgrade these facts into evidence about a new compiler.

The successful original TLC runs invoked the official Java checker directly on the hand-written TLA+ model. They did not exercise Quint-to-TLA+ compilation or Quint's integrated TLC command. Inspection of Quint 0.33.1 showed that its TLC adapter expects an Apalache-distribution JAR; TLA+ compilation also uses the Apalache integration. Retire this installation/translation risk with a small probe before promising a particular integrated verification command. Record and clean up any helper server owned by that probe.

The new behaviour tests must eventually include independent compensation failure, pending reconciliation, and delayed in-flight provider effects after cancellation. A genuine progress claim requires explicit fairness/availability assumptions.

## 12. Known design gaps and resolution probes

These are open decisions to resolve, not secretly implemented features.

| ID | Gap / risk | Next small probe / completion evidence |
|---|---|---|
| D01 | Exact concrete syntax and outcome notation | Write a small grammar plus one valid/invalid example; implement parse round-trip/span diagnostics. Choose one outcome mechanism. |
| D02 | How much ownership fits v0 | Trace a file resource through success, error, transfer, and cancellation; publish the supported alias/borrow subset. |
| D03 | Partial IR and independent analysis | One source with a hole in a payment flow and a complete pure flow; show the latter still gets a valid cost result. |
| D04 | Non-vacuity and path feasibility | Contradictory entry conditions and an impossible branch; establish simple cases and explicitly mark unsupported logic. |
| D05 | Atomicity and response uncertainty | Reproduce the lost-response double-charge scenario without making payment acceptance equal response receipt. |
| D06 | Compensation failure and late events | Add `Compensating/ReconciliationPending`; show why immediate `Cancelled` is unsound if effects can arrive later. |
| D07 | Source/backend semantics | Lower two tiny differently shaped finite programs and compare against the reference source-step relation; test renamed symbols. |
| D08 | General recursion and unbounded work | Resolve signatures and expose unknown costs/unsupported lowering; specify later recurrence/proof integration. |
| D09 | Useful duplicate advice without quadratic work | Hash alpha-equivalent rules; benchmark repeated references, independent copies, and near-copies in capped buckets. |
| D10 | Error/cancel cleanup in the tool | Fake checker hangs, emits invalid output, exits with a known violation, and spawns a child; verify classification and owned-process cleanup. |
| D11 | Incremental checking and code drift | Defer persistent caching/implementation conformance; retain hashes and dependency IDs now so later work is possible. |
| D12 | Final name/package identity | Pymtheg remains a working name. Availability checks are needed before publishing, not before local experiments. |
| D13 | CPU-bound analysis blocks cancellation | Choose cooperative scheduling or an owned worker; cancel a deliberately long local analysis and measure cleanup/response. |

## 13. MVP acceptance boundary and later features

The MVP must provide a real textual language, parser, typed IR, CLI, meaningful local diagnostics, bounded structural costs, exact duplicated-rule hints, a documented conservative ownership/lifecycle subset, and one real source-mapped behavioural integration. It must handle holes without inventing success. Include a dependency/impact report if straightforward from the required graph; do not let a large graph UI delay the CLI.

Its examples must include a pure nested-scan algorithm, a file-processing resource lifecycle, a task retry/lost-acknowledgement case, and checkout/quoting. At least two unrelated shapes must exercise generic lowering; all four need meaningful local analysis. Concurrency can begin with explicit finite event/state-machine modelling rather than arbitrary shared-memory parallelism.

Later work includes general aliasing, rich refinements, recursive cost proofs, probabilistic costs, precise memory peaks, full liveness proofs, implementation extraction/conformance, code ingestion, persistent incremental caches, LSP/UI, and additional backends. Keep a feature support matrix so later features are never presented as delivered merely because syntax was sketched.

## 14. Short-loop implementation contract

Deep design happens before construction, but it is tested in small increments. First review and challenge this map, resolve the blockers for the first slice, and publish the decisions. Do not spend an unbounded session polishing architecture without an executable probe.

Each implementation loop selects one uncertainty or behaviour, states its smallest observable result, makes a narrow change, runs the smallest meaningful check, inspects the output, and updates the map if a contract/assumption changed. Aim for 2–5 minute loops; split work if a loop is drifting beyond roughly 10 minutes. These are pacing targets, not reasons to weaken checks or fabricate success.

Keep focused unit checks fast (target a few seconds), routine local validation short (target under 30 seconds where practical), and backend probes bounded. Avoid silent stretches longer than about a minute; communicate findings and next uncertainty, not a running command diary. Broaden testing at integration boundaries and after failures, rather than rerunning every expensive backend after every text edit.

The first executable loop should check a tiny source file and produce one genuine source-spanned diagnostic. Subsequent loops grow capability vertically. Do not implement parser, types, ownership, costs, backend, and reporting in one large unvalidated batch. Do not ask for confirmation between routine authorised loops. Do not delegate agent work unless the user or applicable instructions explicitly authorise it.

## 15. Self-hosting the map without a bootstrap trap

This document is a human-authored first specification. As the real grammar emerges, translate representative parts of Pymtheg's own load/parse/analyse/check/report pipeline into executable `.pym` examples. Keep draft syntax visibly distinct from compiler-supported syntax until it really parses.

Use the self-model to look for repeated source reads, parsing once per analyser, pairwise rule comparison, lost cancellation cleanup, stale evidence, output publication failure, and cost terms without bounds. Compare observed phase measurements with modelled work counts, while preserving the distinction between measured time and structural costs.

Maintain traceability: user requirement -> model component/contract -> implementation -> acceptance example/test -> evidence. A self-model that repeats source code without exposing a design decision has not met the goal. A model that passes because its failure cases were omitted has not met the goal either.

## 16. Requirement-to-component-to-evidence map

All new-language implementation/test entries below are **planned**, not completed. The only existing executed evidence is the native-language checkout baseline described in section 11.

| Requirement | Owning component / shared contract | Planned acceptance evidence |
|---|---|---|
| R01 Describe signatures and data passing | Parser, type resolver, typed invocation/value model | Signature/type/field errors and corrected source programs; original source locations retained. |
| R02 Describe any application domain | General typed/structured flow core | Useful pure algorithm, CLI/file, worker, and checkout examples; no domain names hardcoded in the analyser. |
| R03 Expose missing declared cases | Outcome coverage and unknown-dependency policy | Add an error variant; identify affected consumers; prove unaffected analysis remains useful. |
| R04 Track ownership/lifecycles | Resource abstract state, callee summaries, obligation policy | File leak on error; move/use error; valid transfer; unsettled cancellation versus corrected cleanup. |
| R05 Expose multiplied work | Symbolic cost DAG and explicit operation summaries | `3N`, `1 + 2N`, retry, nested-scan, zero-iteration, early-return, and unknown-recursion cases. |
| R06 Detect independently repeated logic | Resolved rule canonicalisation and bounded comparison | Alpha-renamed copy found; twelve shared references accepted; different symbols not falsely unified. |
| R07 Explore behavioural failures | Lowering support matrix, backend adapter, trace validation | Checkout's three defects plus a differently shaped worker; renamed programs; corrected finite safety checks. |
| R08 Preserve assumptions and uncertainty | Evidence schema, dependency graph, result aggregator | No timeout/hole/unsupported/sampled result becomes an unqualified pass; costs keep assumptions. |
| R09 Give actionable feedback | Shared source IDs, report schema, renderers | Human text identifies path and source; machine JSON validates and agrees with the same result. |
| R10 Keep the tool itself efficient | Shared snapshot/IR, graph algorithms, rule hashes | Source parsed once per run; no unconditional all-pairs rule pass; bounded expression/path growth. |
| R11 Support cancellation and cleanup | Session coordinator, worker strategy, process/artifact lifecycles | Long local analysis and hung/child-spawning backend cancelled; no owned process/temp resource silently leaked. |
| R12 Prevent stale/corrupt evidence | Snapshot hashes, source map validation, atomic publication | Mid-run edit is distinguished; invalid mapping rejected; previous report survives interrupted publication. |
| R13 Think before implementing | Self-map, decision ledger, risk probes | Concrete design choices and counter-scenarios recorded before the corresponding broad implementation. |
| R14 Work in short fast loops | Implementation progress record and focused tests | Small observable behaviour per loop; inspected results; broader checks at actual integration boundaries. |
| R15 Use the tool on its own design | Self-model `.pym` examples and measured phase counts | Own source-loading, analysis, cancellation, and output lifecycles represented and challenged once grammar exists. |
| R16 Keep implementation honest | Feature matrix and evidence-linked completion checklist | Implemented/partial/unsupported/deferred/blocked states link to real tests/results rather than prose promises. |
