# Existing approaches and what Standard 15 would add

Research date: 8 November 2026. This is a focused comparison of the tools discussed, plus two important relatives; it is not an exhaustive search of all specification languages.

## Finding

The central idea already has a substantial history: formal specification, executable modelling, contracts, model checking, and resource analysis. **VDM is particularly close to the general-purpose description language; Quint is particularly attractive for accessible behavioural checking.**

A plausible new project would combine typed program structure, explicit failure/lifecycle obligations, compositional call costs, named business rules, and helpful reports about incomplete decisions. The contribution would be the language's integration and developer experience. The underlying checking techniques should largely be reused.

## Comparison

“Can model” means the user can explicitly encode a concern. It does not imply the tool automatically recognises that concern or discovers an unstated requirement.

| Tool | Core abstraction and existing capabilities | What to borrow | Fit and limits for this project |
|---|---|---|---|
| **Quint** | Typed executable state-machine specifications; simulation; safety/temporal properties; TLC and Apalache backends. | Readable expressions, types, named actions, concrete counterexample traces, existing checker integration. | Strong first behavioural backend. Its effect system tracks specification behaviour, not a ready-made catalogue of database/network effects. No recursive operators/functions; do not assume every future language feature translates directly. |
| **P** | Communicating state machines, typed events, monitors, safety/liveness checks, reproducible schedules; multiple checking backends. | Explicit messages, event handlers, failure injection, lifecycle monitors, module interfaces. | Excellent for asynchronous/distributed workflows. A general sequential algorithm should not have to become a collection of actors. Checking guarantees depend on backend, bounds, and search configuration. |
| **Dafny** | Verification-aware programming with signatures, pre/postconditions, frame specifications, invariants, ghost state, termination, and compilation. | Contracts, restricted mutation, proof obligations at operation boundaries, explicit specification-only values. | Strong eventual route to verifying algorithms and implementations. Describing a desired contract alone does not automatically establish that an implementation exists or that the contract expresses the intended requirement. |
| **Resource Aware ML (RaML)** | Automatic resource bounds for supported OCaml programs using type-based amortised analysis; evaluation steps, heap cells, and user-defined ticks. | Explicit cost units, size-dependent bounds, resource annotations, potential-based analysis. | The strongest dedicated cost-analysis reference here. It needs a supported program and cost model, not just an API signature. The public site advertises release 1.5.0 from June 2020; that date alone does not establish current maintenance status. |
| **TLA+ / PlusCal** | State-based specifications, temporal logic, fairness, refinement, explicit-state TLC checking, and a separate proof system. PlusCal translates algorithm-like notation into TLA+. | Precise state-transition semantics, safety versus progress, fairness assumptions, refinement. | Broad behavioural foundation. Counterexamples concern the selected model; checking finite instances is not a proof for arbitrary populations. Direct cost/duplication advice requires additional analysis. |
| **Alloy 6** | Relational modelling, constraints, example/counterexample generation, mutable state, temporal logic, and trace visualisation. | Searching for valid designs as well as invalid ones; relationship invariants and cardinality constraints. | Particularly useful for data relationships, ownership relations, and incompatible requirements. Analysis scopes matter. Alloy 6 supports unbounded-time checking over a finite scoped state space with appropriate backends. Alloy “signatures” describe sets/types, rather than API operation signatures. |
| **F\*** | Dependent/refinement types, effects, specifications, proofs, extraction; Pulse adds concurrent separation logic for state and ownership. | Typed effects, ownership reasoning, precise contracts, proof-backed implementation boundaries. | Powerful for rigorous algorithm/memory/concurrency guarantees. A substantial proof-oriented toolchain rather than a lightweight architecture linter. Its documentation explicitly distinguishes a proof of a model from verification of the original implementation. |
| **VDM / VDMJ / Overture** | VDM-SL: data, functions, operations, contracts, state; VDM++: classes/concurrency; VDM-RT: deployment and timing. VDMJ includes interpretation, proof obligations, testing, coverage, and extensions. | Separation of pure functions and state-changing operations; implicit contracts alongside executable definitions; modelling before implementation. | An especially close existing language family. VDM-RT already addresses early performance/bottleneck exploration under hardware and timing assumptions. This weakens any claim that “a description language that analyses designs” is novel by itself. |
| **Why3 / WhyML** | Specification/programming language, verification conditions, libraries, multiple automated/interactive provers, extraction, and an OCaml API. | A verifier-facing intermediate representation and pluggable prover architecture. | Worth investigating before creating a deductive verification layer. Does not provide the proposed whole workflow of lifecycle templates, call-cost advice, and policy-duplication findings out of the box. |

Primary documentation: [Quint language](https://quint.sh/docs/lang), [Quint backends](https://quint.sh/docs/model-checkers), [P framework](https://p-org.github.io/P/whatisP/), [Dafny](https://dafny.org/), [RaML](https://www.raml.co/about/), [TLA+ overview](https://lamport.azurewebsites.net/tla/high-level-view.html), [Alloy 6](https://alloytools.org/alloy6.html), [F* introduction](https://fstar-lang.org/tutorial/book/intro.html), [Pulse](https://fstar-lang.org/tutorial/book/pulse/pulse.html), [VDM languages](https://www.overturetool.org/languages/), [VDMJ](https://github.com/nickbattle/vdmj), and [Why3](https://why3.org/).

### Existing products have moved closer

Quint's [current site](https://quint.sh/) advertises a **Studio beta** that breaks a codebase into components, generates specifications from code/documentation, checks them, and reproduces findings as implementation tests. P's site advertises **PeasyAI** for models from design documents and **PObserve** for checking observed logs against monitors. F* also documents agent-assisted modelling and implementation.

These are documented product capabilities, not features independently exercised in this experiment. “AI helps write specifications” and “keep a model near the code” are already occupied territory. Any new tool should add specific analyses and a better modelling workflow, with explicit evidence for its results.

## Shared example

An order has a stock reservation. It calls a payment provider. The provider can accept payment while its response is lost. The client may retry or cancel. There are at most two attempts in this experiment.

We ask for three safety properties:

1. No more than one payment capture per order.
2. A terminal checkout holds no stock reservation.
3. A cancelled checkout has refunded any captured payment.

The example deliberately separates **what the provider did** from **what the caller knows**. Treating a timeout as “payment did not happen” would hide the most interesting bug.

| Concern | Quint / TLA+ / P | Alloy | Dafny / F* / WhyML | VDM | RaML |
|---|---|---|---|---|---|
| Lost-response retry charges twice | Encode actions/events and a capture-count invariant; search for a violating trace. | Encode changing payment relations and a temporal assertion within scopes. | Encode state and contracts; discharge obligations for payment/retry operations, with explicit environment assumptions. | Specify state/operation contracts; exercise executable models and generated obligations. | Not its primary purpose. |
| Cancellation leaks a reservation | Assert terminal states hold no reservation; separately express eventual cleanup if required. | Express ownership and terminal-state relationships over time. | Encode ownership/state in contracts; eventual cleanup needs a progress argument beyond local safety. | State invariants, contracts, and executable paths; timing/concurrency through appropriate dialects. | May reason about heap/resource costs of supported code, not business reservation semantics automatically. |
| Too many remote calls | Add counters and budgets manually; useful traces are possible. | Can encode counts in scoped models. | Ghost counters/contracts can support proofs of a chosen bound. | Instrument the model; VDM-RT provides timing/deployment modelling. | Designed to infer resource bounds; map remote calls to user-defined ticks in supported programs. |
| Same business rule copied twelve times | Shared definitions are available; automatic semantic duplicate detection is not the central offering. | Shared predicates are available. | Shared functions/predicates are available. | Shared functions/operations are available. | Ordinary function reuse is available. |

These entries describe modelling approaches, not claims that every tool was installed or that the corresponding properties were proved in each tool.

## Hands-on results

Only **Quint and TLA+/TLC** were executed. The other evaluations are documentation-based. The same small model was independently written in their native notations; neither model calls real services.

| Configuration | Property | Quint 0.33.1 simulation | TLC 2.19 exhaustive search |
|---|---|---|---|
| Retry without a stable idempotency key | At most one capture | Counterexample | Counterexample |
| Idempotent payment, cancellation without cleanup | Terminal state releases stock | Counterexample | Counterexample |
| Idempotent payment, cancellation without reconciliation/refund | Cancelled order has no retained charge | Counterexample | Counterexample |
| Idempotent payment and atomic cleanup | All three properties | No violation in 1,000 sampled traces, up to six transitions each | No violation across all eight reachable states of the finite model |

Evidence: [machine-readable summary](results/summary.json), [double-charge simulation trace](results/quint-double-charge.txt), [missing-refund TLC trace](results/tlc-missing-refund.txt), and [corrected TLC run](results/tlc-fixed.txt). Commands and complete output are retained for each experiment. Negative cases stop as soon as a violation is found, rather than running all 1,000 samples.

### What the successful run does and does not establish

The corrected model has one checkout and a two-attempt cap. Provider acceptance is synchronous in the model; only delivery of the response is uncertain. No provider declines, crashes, delayed in-flight requests after cancellation, multiple orders, partial refunds, or independent refund/release failures are modelled. Cancellation's cleanup is atomic and guaranteed to succeed. A stable payment key is assumed to have the stated deduplication semantics.

Therefore the result is a check of the three stated safety properties **under those assumptions**, not a production checkout design. A realistic next version must model `Compensating` and `ReconciliationPending` states and independent failure/late-arrival cases. It must state fairness/availability assumptions before claiming eventual progress. A successful model check does not establish that later handwritten code implements the model.

## What deserves a new layer

### 1. Explicit uncertainty and missing decisions

Known errors and cancellation outcomes should be declared variants. Every reachable variant needs a handler or an explicit unresolved decision. Marking something `unknown` keeps exploration possible but prevents a misleading complete result. A tool cannot infer every requirement that was never represented.

### 2. Compositional work and external-call counts

For a quote operation with `N` items, calling customer lookup, price lookup, and stock lookup inside the loop costs `3N` remote calls. At `N = 200`, that is 600 calls for quoting alone. Hoisting an unchanged customer read gives `1 + 2N`; batching the other reads could reduce it to three calls **only if service batch contracts permit the whole request**.

This arithmetic should be derived from the flow and named operation costs. Wall-clock latency needs separate concurrency and service-time assumptions. Repeated reads are only safely hoistable under an explicit stability/snapshot contract.

### 3. Business decisions as shared definitions

Give a rule such as `MayPurchase` one definition and an identifier. Twelve references are successful reuse. Twelve independent copies are potential drift. Initially detect literal/normalised copies and suspiciously similar pure predicates; proving arbitrary programs equivalent is a different, much harder problem.

### 4. Actionable reports with their scope

A report should say which path breaks a rule, the relevant source locations, which assumptions it used, and whether the result is a counterexample, a finite exhaustive check, a sampled check, a proof, an estimate, or an unresolved decision.

## Recommendation

Start with a small language and a typed intermediate representation. Implement local structural checks and symbolic call counting there; translate a deliberately restricted behavioural subset to Quint. Keep source maps so the user sees the original operations rather than generated state variables.

Use VDM as a design reference and actively compare the authoring experience against it. Retain TLA+ semantics for state and progress. Treat Why3, Dafny, and F* as candidates for later proof-oriented integrations, not requirements for the first prototype. Borrow RaML's resource-accounting ideas before attempting to embed its OCaml-specific implementation.

Quint's published package and repository report Apache-2.0 licensing; integrating its CLI is a plausible starting point. Other projects' compatibility and licences need checking before any source code or libraries are incorporated. This research copied no implementation code from those projects.

## Source snapshots

[index.json](sources/index.json) records all attempted source fetches, including failures. A supplementary Event-B homepage request failed certificate validation; Event-B is not assessed here. Successful snapshots are plain text for auditability; extraction loses some original code formatting. Use the primary pages for precise syntax. No browser automation was used.
