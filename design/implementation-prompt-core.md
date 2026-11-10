# Build Pymtheg: specification-first program design and analysis

You are implementing a new specification language and developer tool. The working name is **Pymtheg**, Welsh for fifteen, following the joke in xkcd 927 about creating one more standard. Earlier research called it **Standard 15**. Karl also likes Hamabost; the name is provisional. Use `pymtheg` as the provisional CLI and `.pym` as the source extension. Centralise these names so a later rename is routine. Do not publish packages, register domains, or spend implementation time on branding.

## 1. The actual problem

Karl wants to describe **any kind of program before implementing it**, including:

- Signatures, types, inputs, outputs, and what is passed between components.
- Values versus references, borrowing, ownership, and state mutation.
- Business rules, operation contracts, environmental assumptions, and effects.
- Creation, transfer, use, cancellation, cleanup, and termination of resources/tasks.
- Branches, loops, retries, failures, ordering, and concurrency where relevant.
- Calls/work performed repeatedly, complexity, resource budgets, and repeated logic.

The pain is discovering halfway through implementation that a missing case requires a large refactor, an operation is called far too often, or the same business decision has been independently written twelve times.

Build a checkable design description that makes those consequences visible while the design is inexpensive to change. The user should not need to implement networking, persistence, frameworks, or production adapters to discover a design defect. Nor should the specification become a second full implementation merely to express a simple idea.

The project combines established techniques. It is not a claim to have invented formal specification, a universal proof engine, or a tool that knows every unstated intention. Make the integration, semantic consistency, useful findings, and authoring experience excellent.

## 2. Mandatory first step: deeply specify this tool itself

**Before implementing the compiler, make the same map of Pymtheg that we want Pymtheg eventually to make of other programs.** A thoughtful design is a prerequisite, not optional documentation after coding.

The complete initial system map is included later in this prompt. Treat it as a concrete starting hypothesis to challenge, not an infallible design. Review it against the user requirements and existing research. Settle the blockers for the first slice; keep other decisions explicitly open.

The map must cover:

1. Components, interfaces, signatures, types, data passed, ownership, and effects.
2. The end-to-end pipeline from files to user-visible findings.
3. Entity identities, source spans, snapshot/version hashes, and provenance.
4. Contracts, environmental assumptions, pending obligations, and unknowns.
5. The tool's own sessions, workers, subprocesses, temporary files, reports, and cleanup lifecycles.
6. Failure, cancellation, timeout, partial-result, and stale-result behaviour.
7. Each analysis algorithm, its inputs, guarantees, limitations, and likely complexity.
8. Repeated work and shared decisions that should have one authoritative definition.
9. Backend translation boundaries, semantic correspondence, and trace validation.
10. A requirement-to-component-to-test traceability table and an explicit gap/decision ledger.

Actively try to break the design. Walk at least these scenarios before committing to architecture:

- One incomplete payment flow alongside an otherwise complete pure flow.
- A source file edited while a checker is running.
- A parser recovery hole feeding a later cost/type check.
- An ownership obligation transferred to a failing callee.
- An unknown external outcome followed by retry/cancellation.
- A cost budget accidentally being added as if it were work.
- A loop with early return, zero iterations, and unknown body cost.
- Recursive calls without a known bound.
- Ten thousand rules compared for duplicates without an all-pairs explosion.
- A backend that hangs, crashes, emits invalid output, or leaves descendants.
- A CPU-bound local analysis that prevents the event loop from handling Ctrl-C.
- A report renderer receiving incomplete evidence that looks superficially like a pass.

Publish the map, semantic decisions, and first probes before broad implementation. This is not an automatic human approval gate: proceed through authorised work after the design is concrete, unless a genuinely blocking question requires Karl's answer.

## 3. Work in short, fast, closed feedback loops

This is a hard working preference: **small change -> fast meaningful check -> inspect evidence -> adjust.** Deep thought and fast iteration must coexist.

- Aim for **2–5 minute loops**. If a loop is drifting beyond roughly ten minutes, split the uncertainty or vertical slice. These are pacing targets, not permission to skip necessary checks.
- Start each loop with one hypothesis or observable behaviour. Know what result would prove the change useful.
- Prefer one real failing source example or user-visible behaviour, then the smallest implementation that handles the general case.
- Run focused checks in a few seconds where practical. Keep routine local validation around thirty seconds or less where practical. Put slower backend/integration probes behind explicit bounded commands.
- The first executable loop should load a tiny source file and produce a real source-spanned diagnostic. Do not write the whole parser, type checker, analyses, backend, and reporter before running anything.
- At integration boundaries, run the meaningful broader checks. Do not rerun expensive model checking after every documentation or formatting change.
- Inspect actual output. A zero exit code alone is not sufficient evidence.
- Update the map/decision ledger when an interface, invariant, assumption, or support boundary changes. Avoid ceremonial documentation for every trivial edit.
- Keep brief progress updates focused on findings and the next uncertainty. Avoid silent stretches longer than about a minute during active work.
- Do not repeatedly ask permission for routine reversible decisions already covered by this task. Make sensible choices, record them, and continue.
- Do not stop at scaffolding, mock output, an architecture essay, or a TODO-only backend. Deliver the bounded working MVP defined below and truthfully distinguish later features.
- Do not use “short loops” as a reason to make shallow decisions, generate mirror-image tests, or leave necessary work unfinished. A loop ends in inspected evidence, not just a patch.

Keep a concise implementation progress record: loop objective, changed behaviour, check/result, unresolved issue, next smallest step. If a test fails, narrow the cause and fix it before piling on unrelated work. Do not hide a regression by weakening its acceptance criterion.

## 4. Existing research and exact current state

The existing workspace is a research/design spike, **not an implementation of a new language**. If these files are present, read them before replacing or extending them:

```text
README.md
research/comparison.md
design/proposal.md
design/pymtheg-system-map.md
examples/checkout.s15
examples/checkout.qnt
examples/Checkout.tla
examples/double-charge.cfg
examples/stock-leak.cfg
examples/missing-refund.cfg
examples/fixed.cfg
research/run_examples.py
research/results/summary.json
research/results/*.txt
research/sources/index.json
```

The original workspace was `/home/user/.t3/scratch/2026-11-08-right-so-there-might-be-e279b705`. Do not assume this path or temporary installed tools exist in a new environment. This prompt includes the essential findings and system map so it can also be used elsewhere.

`checkout.s15` is aspirational syntax. It deliberately includes unknown decisions and undefined types such as `Receipt`, `QuoteError`, and `CheckoutError`. Do not quietly promote it to a clean executable example, a verified specification, or a parser acceptance requirement without updating its status and meaning. Preserve historical evidence rather than rewriting old logs to match new expectations.

### Prior art to understand and reuse

| Project | Relevant contribution | Important qualification |
|---|---|---|
| **VDM / VDMJ / Overture** | General specification-first modelling, types, pure functions versus operations, contracts, executable models, testing/proof obligations. VDM-RT includes deployment/timing analysis. | A close predecessor; study it before claiming novelty or inventing all notation from scratch. |
| **Quint** | Typed executable specifications, nondeterminism, simulation, invariants, temporal properties, TLC/Apalache integration. | The language lacks recursive operators/functions. Its specification effects are not automatically our network/filesystem/ownership system. |
| **TLA+ / PlusCal** | Precise state-transition and temporal semantics, fairness, refinement, concrete counterexamples. | A result concerns the selected model and configuration. Finite instances do not establish arbitrary system sizes. |
| **P** | Communicating state machines, typed events, monitors, failure/message scheduling, safety/progress analysis. | Strong for asynchronous/distributed programs; do not force every algorithm into actors. Guarantees depend on the checking engine and configuration. |
| **Dafny** | Signatures, contracts, frame conditions, ghost state, termination, proof obligations, compilation. | Not a ready-made lightweight whole-design linter. A contract is not automatically proved merely by being written. |
| **F* / Pulse** | Refinements, dependent types, effects, ownership/separation logic, proof-oriented implementation. | Proof of a model does not establish that arbitrary handwritten production code conforms. |
| **Alloy 6** | Relations, cardinality constraints, example/counterexample search, mutable state, temporal traces. | “Signatures” mean sets/types. Scope matters; complete unbounded-time checking is possible over finite scoped state spaces with suitable backends. |
| **Resource Aware ML** | Type-based amortised resource analysis, size-dependent bounds, steps/heap/user ticks. | It analyses supported OCaml programs, not arbitrary specifications. Its site advertises release 1.5.0 from June 2020; do not infer abandonment from that alone. |
| **Why3 / WhyML** | Verification conditions, prover integration, specification/programming IR, extraction. | A possible later deductive backend, not a requirement to integrate immediately. |

Primary references:

```text
https://www.overturetool.org/languages/
https://github.com/nickbattle/vdmj
https://quint.sh/docs/lang
https://quint.sh/docs/model-checkers
https://quint.sh/docs/model-based-testing
https://lamport.azurewebsites.net/tla/high-level-view.html
https://p-org.github.io/P/whatisP/
https://p-org.github.io/P/advanced/importanceliveness/
https://dafny.org/
https://fstar-lang.org/tutorial/book/intro.html
https://fstar-lang.org/tutorial/book/pulse/pulse.html
https://alloytools.org/alloy6.html
https://www.raml.co/about/
https://why3.org/
```

The 8 November 2026 research also found that Quint Studio beta advertises model generation from code/docs, behavioural checking, and reproduction as tests. P advertises PeasyAI and PObserve. F* documents agent-assisted modelling. Those product features were documented, not independently exercised. “Add AI to specifications” is not a differentiator by itself.

### What was actually executed

Only Quint and TLA+/TLC were executed in the original experiment. Five other originally discussed tools, plus VDM and Why3, were assessed from documentation.

The hand-written checkout models have one order, one reservation, at most two payment attempts, certain provider acceptance, uncertain response delivery, and atomic successful cleanup. Both tools found:

1. Retrying after a lost response can capture payment twice.
2. Cancellation can leave stock reserved.
3. Cancellation after a lost response can leave a retained charge.

Quint **0.33.1** found no violation in the corrected model over **1,000 sampled traces with up to six transitions**. Negative cases stopped at their first discovered violation. **TLC 2.19**, distributed in TLA+ release **v1.7.4**, checked all **eight reachable states** of the corrected finite model. Eight experiment outcomes matched expectations: three violations and one corrected case in each tool.

No automated equivalence proof linked the two hand-written models. No production implementation, independent compensation failure, delayed provider effects after cancellation, arbitrary populations, or eventual-completion proof was checked. These are research facts, not evidence that Pymtheg's future translator is correct.

The successful TLC experiment called Java directly on the hand-written TLA+ model; it did **not** test Quint-to-TLA+ compilation. In Quint 0.33.1, the integrated TLC adapter expects an Apalache-distribution JAR, and compilation to TLA+ uses the Apalache integration. Check those prerequisites in an early bounded probe. Do not assume downloading the standalone TLC JAR makes every Quint verification command work.

If the original research files are available, the baseline can be rerun with:

```sh
npm install --prefix /tmp/spec-language-research --ignore-scripts --no-audit --no-fund @informalsystems/quint@0.33.1
python research/run_examples.py --quint /tmp/spec-language-research/node_modules/.bin/quint
python research/run_examples.py --quint /tmp/spec-language-research/node_modules/.bin/quint --tlc-jar /tmp/spec-language-research/tla2tools.jar
```

The last command additionally needs the official JAR from `https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar`, with recorded SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`. The baseline runner uses a 45-second per-invocation timeout, one TLC worker, and a 512 MiB Java heap. TLC's Java management socket was blocked by the original restrictive sandbox and required an appropriate permitted execution context. Treat an environment failure as an environment failure, not a model violation. Temporary `/tmp` tools may have disappeared in a later session.

Temporary tools were installed locally, not globally. The official Quint package/repository reported Apache-2.0. Inspect licences before incorporating other implementations. Reuse ideas without copying implementation code uncritically. Pin tool versions; record any deliberately tested upgrades.

## 5. Implementation approach and repository structure

Default to **TypeScript on a supported Node.js LTS**, because it fits the Quint ecosystem and a language-tooling CLI. If an established repository already dictates another stack, examine it first and justify a departure from this default. Use strict types, explicit phase/result unions, and exhaustive case handling. Validate external JSON at runtime; casting parsed JSON does not validate it.

Start as one small package with clear modules, not an elaborate monorepo or plugin framework. An indicative structure is:

```text
src/
  cli/
  language/       # tokens, parser, grammar, AST, spans
  semantic/       # names, types, contracts, canonical typed IR
  analysis/       # outcomes, effects, ownership, lifecycles, costs, rules, impact
  behaviour/      # supported source-step semantics, lowering, trace mapping
  backends/       # process runner and Quint adapter
  reporting/     # schemas, aggregation, text and JSON renderers
  shared/        # only genuinely shared primitives and judgement policies
examples/
test/
docs/
```

Choose a small maintained parser library or a clear recursive-descent parser. Explain the tradeoff briefly. Publish the actual grammar and keep examples consistent with it. Retain source spans from lexing through reporting. Avoid a compiler framework whose setup dominates the first working slice.

The complete system map later in this prompt defines the semantic and component contracts. Implement those contracts deliberately. If a probe disproves one, revise the map and tests rather than quietly implementing a different architecture.

## 6. Required first-version capabilities

### Real language and semantic core

- Parse actual textual `.pym` programs, not JSON renamed to `.pym` and not regular expressions that recognise one checkout fixture.
- Support the documented small type/value subset, explicit operation signatures, named pure rules, tagged outcomes, operation effects, resource states/transitions, structured bounded flow, and explicit unknowns.
- Keep one canonical typed IR. All analyses, reporting identities, dependency edges, and backend lowering refer to that model.
- Use standard `Result<T,E>`/tagged outcomes or one equivalent coherent mechanism. Define handler/propagation/cancellation semantics once.
- For payment examples, conceptually distinguish `Result<Receipt, Declined | Unavailable | OutcomeUnknown>`. The final grammar may spell this differently. `Unavailable` is effect-free only if the provider contract guarantees that; otherwise the model must preserve `OutcomeUnknown`. A timeout must never silently mean “no capture happened.”
- Resolve module/declaration references; detect duplicate/unknown names, argument count/type mismatches, invalid field/variant use, and illegal transitions. Support deterministic project loading and diagnose import cycles according to the published subset.
- Include a grammar/support matrix. A feature can be parsed but unsupported by a particular analysis; report that distinction.
- Handle arbitrary precision integer bounds and explicit cardinality assumptions. Do not silently truncate source integers to backend ranges.

### Useful local checks

- Find unhandled declared outcomes and incompatible propagation.
- Find effects that violate purity or exceed declared effect sets, with a call path.
- Find use-after-transfer, invalid lifecycle transitions, and visible unsettled resource exits in the conservative documented ownership subset.
- Preserve obligations across success, error, cancellation, return, and calls. Do not confuse ownership transfer with cleanup.
- Keep unknowns visible and identify their consumers. Independent completed analyses remain usable.
- Detect simple vacuity/contradiction cases; label unsupported feasibility reasoning rather than pretending complete logical coverage.

### Cost and repeated-work analysis

- Compose nonnegative cost expressions through calls, sequence, exclusive branches, bounded loops, and bounded retry.
- Distinguish exact costs, upper bounds, unknown terms, intrinsic overhead, abstract cost assumptions, and budgets.
- Infer `3N` for three remote calls inside an `N`-item loop and evaluate the upper bound at `N <= 200` as 600 calls for that workflow portion.
- Infer an explicitly annotated quadratic work count for a nested scan. Do not claim universal CPU complexity inference from this example.
- Preserve early-return, empty-loop, short-circuit, and retry-stop semantics, or clearly identify conservative bounds.
- A recursive SCC without a supported bound yields unknown cost, not zero or a guessed asymptotic class.
- Show the contributing call path/derivation. Do not conflate elapsed time, external-call counts, allocations, peak live memory, and latency.
- Detect repeated calls as investigation candidates. Require stability/consistency contracts before suggesting hoisting; batch suggestions need API size limits.

### Business-rule reuse and duplication

- Support named, typed, pure reusable rules.
- Recognise independent exact/alpha-renamed copies using resolved symbols and safe structural normalisation.
- Do not flag twelve references to one definition as twelve copies.
- Do not reorder floating-point arithmetic, short-circuit expressions, or potentially partial computations under the guise of normalisation.
- Any near-duplicate suggestions are explicitly heuristic, bounded, and optional in the first slice. Do not let an all-pairs comparison become the tool's own hidden quadratic bottleneck.

### Behavioural integration

- Implement at least one real adapter to pinned Quint tooling for a small published behavioural subset.
- Perform capability checks before lowering. Reject or mark incomplete unsupported recursion, parallelism, data domains, or outcomes. Never replace them with successful no-ops, arbitrary tiny bounds, or zero cost.
- Generate models from the typed IR with source event/span mappings. Do not hardcode the example's states or expected findings.
- Preserve the distinction between request submission, provider effect, response delivery, and observed knowledge where it matters.
- Carry scopes, assumptions, atomicity, seeds, versions, and actual selected engine into the result.
- A source-mapped backend counterexample must identify original operations. Validate/replay it where supported, and label backend-only evidence honestly otherwise.
- Exercise at least two independently structured source programs and renamed versions. Show the adapter handles language constructs rather than fixture names.
- Keep the original hand-written Quint/TLA+ examples as baselines, not as substitutes for translating new source.

## 7. CLI and reporting contract

At minimum provide equivalents of:

```text
pymtheg check FILE.pym
pymtheg check FILE.pym --format json
pymtheg emit FILE.pym --target quint --entry FLOW --out MODEL.qnt
pymtheg simulate FILE.pym --entry FLOW --seed 42 --max-steps 6 --max-samples 1000
pymtheg verify FILE.pym --entry FLOW --backend tlc --scope SCOPE.json --timeout 45s
```

Adjust argument spelling if needed, then document and test the final contract. Explain whether `check` requests only local analyses. An optional, unrequested backend must not make ordinary offline checking fail. A requested missing backend must produce an explicit integration error, never a skipped-success message.

Text output should be concise and useful: source location, what can happen, why, the relevant path, and evidence/assumptions. JSON output must follow a versioned schema and contain no progress logs. Send incidental process logs to stderr or separate artifacts.

Use the orthogonal evidence schema and central exit policy in the system map. Each property/result must retain its own completion, assurance, bounds, assumptions, outstanding obligations, and witness status. Avoid a global “verified” badge that hides holes or unrequested work.

Do not treat all nonzero subprocess exits as violations. Distinguish invalid input, backend unavailable, unsupported feature, malformed output, timeout, cancellation, and internal failure. Publish artifacts atomically and preserve available findings when writing an output file fails.

## 8. Acceptance suite: meaningful before/after examples

Implement black-box source-to-result tests in addition to focused unit checks. Do not write tests that merely mirror the implementation's internal representation. Assert both problematic and corrected cases, including false-positive controls.

| Area | Required behaviour |
|---|---|
| Parser/spans | A syntax error points to the actual token; Unicode offsets and line reporting are consistent. A valid example parses without manufacturing declarations. |
| Signatures | Wrong argument count/type and unknown fields/variants are diagnosed with related declaration locations. |
| Outcomes | A newly added error variant makes an exhaustive consumer incomplete/error as documented; compatible explicit propagation remains valid. |
| Purity/effects | A pure rule calling an effectful operation is rejected; an effect declaration for another service does not cover this call. |
| File lifecycle | Success closes a file; a parse-error exit leaks it; corrected cleanup handles both. Transfer to a callee does not falsely look like local close. |
| Unknown isolation | A hole in checkout blocks dependent claims while an independent complete pure flow still gets a justified result. |
| Cost algebra | `3N`, `1 + 2N`, empty iteration, exclusive branches, early return, retries including the initial attempt, nested scans, unknown callees, and recursion are classified correctly. |
| Budget semantics | A budget constrains the total and is not added as work; declared totals/body costs are not double-counted; negative/incompatible cost units are rejected. |
| Rule copies | Independent alpha-renamed copies are found; reuse of one rule is accepted; different resolved identifiers are not merged because their spelling matches. |
| Checkout | Lost response then retry can double charge; cancellation can retain stock; cancellation can retain a charge. Corrected bounded source model has no violation of those stated safety properties within its recorded scope. |
| Task runner | Lost acknowledgement plus retry can duplicate an effect. Demonstrate a structurally different program from checkout. |
| Generic lowering | Rename/reorder unrelated declarations and show the same semantics/findings without fixture-specific handling. |
| Unsupported feature | Parsing/typing and behavioural support are distinguished; unsupported lowering is explicit and cannot become a pass. |
| Evidence scope | Sampled, bounded/exhaustive, structural, heuristic, incomplete, timeout, and cancelled results cannot collapse into one success category. |
| Non-vacuity | A trivially impossible entry condition is identified; unsupported satisfiability reasoning is visible. |
| Process lifecycle | Fake and real adapters classify a violation, successful check, spawn failure, crash, malformed output, timeout, cancellation, and retained child-process risk. No owned checker remains running. |
| Local cancellation | Cancelling deliberately long CPU analysis remains responsive using the chosen scheduling/worker design. |
| Staleness | Editing source while a backend runs cannot map old evidence onto new source without a stale-result indication. |
| Publication | Interrupted/failed report writes do not corrupt an existing report; JSON stdout is valid even when the backend logs warnings. |

The four user-facing example domains are a pure algorithm, file-processing CLI, background task runner, and checkout/quotation. Their descriptions must reveal decisions at a higher level than full implementation. Show useful findings across the four; not every domain must exercise every optional backend feature.

Add lightweight benchmarks or instrumentation for parsing, graph sizes, rule hashing, and symbolic-expression growth. Report measured numbers as measurements, not theoretical guarantees. Avoid flaky tight wall-clock assertions in correctness tests; use deterministic operation/count/budget controls where possible.

## 9. Implementation sequence

Work vertically in short loops. The sequence below is a dependency order, not permission to create a large untested batch within each item.

1. **Self-specification and risk probes:** challenge the map, record semantic choices, resolve grammar/outcome/cost/ownership boundaries for v0, and identify the highest-risk translation/cancellation questions.
2. **Tiny executable slice:** package/CLI, source snapshot, parser for a small coherent subset, one meaningful diagnostic, text and basic versioned JSON output.
3. **Typed core:** declarations, signatures, symbol identity, source spans, partial IR, dependency graph, explicit unknowns, outcome/effect checks.
4. **Work accounting:** bounded loops, calls, branches, retries, symbolic costs, budgets, call paths, and exact rule-copy hashing. Benchmark before adding clever caching.
5. **Resource correctness:** local ownership, transitions, exits, transfer summaries, cancellation observation/cleanup within the declared subset.
6. **Reference behaviour and lowering probe:** define the small-step boundary; lower two tiny finite programs; preserve uncertain outcomes and source IDs. Investigate semantic mismatches immediately.
7. **Real adapter lifecycle:** process control, actual pinned tool execution, bounded settings, cancellation, output parsing, evidence mapping, trace replay/support status.
8. **Integrated examples and self-application:** run the four domains, translate representative Pymtheg pipeline/resource flows into real `.pym` self-models, and use those models to challenge the implementation.
9. **Consolidation:** meaningful end-to-end suite, support matrix, grammar/semantics documentation, quickstart, measured limits, outstanding risks, and a truthful final report.

Backend probes may happen earlier as disposable, bounded experiments to retire a design risk. Keep them separate from claims that the full source-to-backend pipeline is implemented. Revisit the order if evidence justifies it; do not use the roadmap to avoid the next runnable slice.

## 10. Environment and working constraints

- Read applicable `AGENTS.md`/repository instructions. Preserve unrelated user work and historical compatibility paths.
- If a `.codegraph/` directory exists at the repository root, use CodeGraph before searching/reading code to understand it. Do not create an index without user instruction.
- On Karl's Linux PC, reusable maintenance helpers are in `/home/user/Scripts/pc-tools`; read its `START-HERE.txt` before reusing/changing helpers. This project is not a reason to toggle display/USB fixes or reorganise PC maintenance scripts.
- Keep T3 Code agent preview/browser access disabled. Open manual-review pages in Firefox. Any necessary local headless browser automation must run entirely through `pc-tools headless -- COMMAND [ARGS...]` and inherit its CPU/RAM/lifetime limits. CLI/compiler tests normally need no browser. Do not raise or evade browser resource limits.
- Use the existing local toolchain where appropriate; install dependencies locally and pin versions. Do not make unrequested global/system changes.
- Use exact structured arguments and safe process APIs. No shell interpolation of source or user-provided paths.
- Do not spawn/delegate subagents unless Karl or an applicable instruction explicitly asks for delegation/parallel agent work. This prompt does not itself request a multi-agent workflow.
- Do not create top-level threads, deploy, publish, send messages to others, or push remote changes unless separately authorised.
- Reuse existing research and inspect primary documentation when a specific question needs resolving. Do not restart an unbounded literature survey or repeatedly fetch unchanged sources.

## 11. Completion and handoff requirements

Deliver a working, bounded MVP with genuine analysis and one real behavioural integration, plus its self-map. Keep a checklist of requirements with `implemented`, `partially implemented`, `unsupported`, `deferred`, or `blocked`, linked to evidence.

The final handoff must identify:

- What the user can run and what useful findings it currently produces.
- The language/analysis/backend subsets actually supported.
- Exact validation commands and observed results, including any skipped or blocked checks.
- Where the map, grammar, examples, reports, and implementation decisions live.
- Important assumptions and unresolved semantic risks.
- Which future features are intentionally outside this MVP.

Do not call the tool universally complete, the translator proven, the design logically exhaustive, or the implementation production verified. Do not imply the new analyses existed in the earlier research spike. A genuine external blocker can remain explicit, but it must not be disguised as completed work.

Start by examining the available workspace and the embedded self-specification below. Work through design review, small probes, and implementation until the defined MVP is complete. Keep the loops short and the reasoning explicit.

---

# Embedded prerequisite: Pymtheg's complete initial system map

The remainder is part of this prompt, not an optional external reference. Challenge and maintain it as implementation evidence develops.
