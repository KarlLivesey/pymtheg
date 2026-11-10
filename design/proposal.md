# Standard 15: initial language proposal

Status: design draft, not a compiler specification. [checkout.s15](../examples/checkout.s15) is illustrative and has no parser. The executable evidence remains the [Quint](../examples/checkout.qnt) and [TLA+](../examples/Checkout.tla) models.

## Purpose

Describe enough of a program to expose expensive design mistakes before implementing its libraries, persistence, networking, and user interface. Support arbitrary application domains through common constructs rather than making every program look like a distributed service.

A useful first version answers: Are declared outcomes handled? Can the specified lifecycle get stuck or end with unfinished obligations? How often do operations execute? Which business rules are independently repeated? What will a proposed contract change affect?

The language describes a model of a program. It is not required to be a deployable implementation. Abstract operations and structured control flow coexist: specify the interface and permitted effects of a database operation, without implementing a database driver.

## Foundations to reuse

| Source | Adopt |
|---|---|
| VDM | Types, pure functions versus stateful operations, implicit contracts, executable refinement. |
| Quint | Typed behavioural models, readable expressions, nondeterminism, simulation and checker integration. |
| TLA+ / PlusCal | State-transition semantics, explicit atomicity, safety/progress distinction, fairness and refinement. |
| P | Typed events, message delivery/failure possibilities, lifecycle monitors, reproducible schedules. |
| Dafny / WhyML | Preconditions, postconditions, mutation frames, ghost values and generated verification obligations. |
| F* / Pulse | Explicit effects, ownership, borrowing, and separation of independent state. |
| Alloy | Relationship constraints, cardinalities, searching for valid examples and counterexamples. |
| RaML | Named resource units, size-dependent costs and eventual amortised analysis. |

These are influences, not a commitment to link nine toolchains. The first implementation should need only one behavioural backend.

## Small semantic core

### Values, signatures, and contracts

Provide primitives, records, tagged unions, collections, type aliases, and refinements. Function signatures state parameter/result types. Operations additionally declare readable/writable state, external effects, and all known outcomes.

Pure functions and rules have no externally visible effects. An operation may have an abstract body described by a contract. A contract is an assumption at its call sites until an implementation or independent model is verified against it; reports must preserve that distinction.

An impossible precondition or invariant must be reported as a potentially vacuous specification, not accepted merely because no execution violates a property. Offer satisfiability and reachability queries alongside violation searches.

### Data passing, ownership, and lifecycles

Distinguish copyable values, shared references, borrowed references, and owned resources. Passing an owned resource using `take` transfers the obligation to finish its lifecycle; it does not copy the obligation or silently discharge it. Borrowing cannot outlive the owner or overlap with conflicting writes.

Resources declare states, allowed transitions, terminal states, and obligations. A reservation might move from `Held` to `Consumed` or `Released`; a task may become `Succeeded`, `Failed`, or `Cancelled`; a file may become `Closed`.

Start with conservative single-owner scope analysis. General aliasing, shared mutable ownership, and full concurrent separation logic are later work. Lifecycle state machines can be model checked earlier than all ownership features can be proven.

### Structured flow and atomicity

Support sequence, branches, pattern matching, iteration with cardinality bounds, operation calls, bounded retry, parallel composition with a concurrency bound, and explicit state transitions. Every checkable event has a defined execution boundary.

Local pure computation between external calls may be treated atomically in the first subset. External calls separate request, provider effect, and observed response wherever uncertainty matters. Grouping a payment capture and stock release into a single atomic action is an explicit abstraction, never a default promise about real services.

Make `retry attempts <= 3` mean **three total attempts including the first**, with no ambiguity about additional retries. Recursive calls and unbounded loops can be expressed eventually, but a checker without an established bound reports unknown cost or requests a measure/invariant. Never silently replace unbounded behaviour with a convenient small number.

### Failure, cancellation, and unknown outcomes

Result types distinguish a definite rejection from an unknown external outcome. A lost response is not evidence that an effect did not happen. Idempotency keys, lookup/reconciliation, and compensation are modelled explicitly.

Cancellation may begin a cleanup lifecycle rather than finish it. A failed refund moves the operation into a pending-compensation state until a specified recovery path settles it. “Eventually settled” needs environment and scheduling assumptions; no safety-only result may be presented as a liveness proof.

Declared tagged outcomes support exhaustive handling checks. `unknown "decision"` is a first-class placeholder with source location, affected callers, and outstanding obligations. Unknown or unsupported behaviour must produce an incomplete result, or a clearly labelled conservative abstraction. It must never become a successful no-op during lowering.

### Business rules

Rules are named, typed, pure definitions: eligibility, visibility, pricing policy, retry eligibility, and so on. A rule is referenced from many operations without becoming duplicated logic.

The first checker can find exact copies after safe normalisation and identify near-copies for review. It must not automatically merge merely similar rules or presume two policies with different purposes are interchangeable. Do not use an LLM's equivalence judgement as proof.

### Resources and costs

Each operation can declare quantities such as `db_reads`, `remote_calls`, `bytes_allocated`, and `cpu_steps`. A cost declaration for an abstract operation is an assumption. Keep worst-case work, expected work, total allocation, live memory, and wall-clock latency as different quantities.

For the initial cost algebra:

- Sequence adds costs.
- An exclusive branch takes the worst-case maximum; an expected value requires branch probabilities.
- A loop over at most `N` items multiplies a per-item upper bound by `N`; dependent inner bounds need sums or an unknown result.
- A retry with at most `A` attempts multiplies a per-attempt upper bound by `A`, including explicitly modelled reconciliation/backoff work.
- Parallel work still adds operation counts. Concurrency can change latency; it does not erase work.
- Recursion requires a recurrence or user-supplied bound. A recursive call graph alone is insufficient to infer complexity.

An expression such as `3N` remote calls is a structural bound on the described flow. It is not measured runtime, not a complete CPU complexity result, and not a proof that an implementation follows the flow. Memory peaks additionally depend on lifetimes and concurrency. Costs can carry ranges or unknown terms.

Read-hoisting suggestions require stable inputs and a declared read-consistency contract. A repeated authorisation check across a permission change may be necessary. Batch suggestions require API cardinality and payload constraints.

## Diagnostic contract

Every finding should carry:

- Category and severity.
- Original source locations and dependency path.
- A concrete witness/trace or symbolic derivation, where available.
- Model assumptions, cardinality/time bounds, and checker configuration.
- Evidence status: `counterexample`, `sampled`, `exhaustive-within-model`, `proved-under-assumptions`, `estimated`, `heuristic`, `incomplete`, or `unsupported`.

The status belongs to a property and a particular model/version, not the whole project. A finite exhaustive result can still depend on an unverified external contract. A vacuous pass should not look like meaningful coverage.

Example target diagnostics (not outputs of an implemented Standard 15 checker):

```text
LIFECYCLE: Cancelled can retain Reservation.Held.
  witness: reserve -> cancel -> return
  evidence: counterexample

OUTCOME: Payments.capture may return OutcomeUnknown; no handler is specified.
  consequence: whether payment occurred is unresolved
  evidence: incomplete

COST: quote performs 3 * items.count remote calls.
  maximum: 600 when items.count <= 200
  path: quote -> each item -> customer, price, inventory reads
  evidence: structural bound under the declared operation costs

POLICY: Two independent purchase rules differ on account.suspended.
  evidence: heuristic until the predicate comparison is established
```

## Architecture

```text
source files
    |
parser, type checker, name/ownership resolution
    |
typed IR: operations, rules, control flow, resources, effects, contracts
    |                         |                         |
local structure checks   symbolic cost analysis   behavioural lowering
    |                         |                         |
    |                         |                      Quint
    |                         |                  simulator / TLC
    +-------------------------+-------------------------+
                              |
                  source-mapped findings and traces
```

The typed IR is the shared semantic model, not just a text format for gluing together tools. Specify integer domains, collections, aliases, error propagation, call boundaries, and nondeterminism before trusting a translation. Preserve explicit assumptions and source maps. Reject unsupported features; do not lower them approximately without labelling the approximation and its direction.

Quint's lack of recursive operators and its specification-focused effect system are concrete translation constraints. It can still model repeated transitions. General recursive computations may need another backend or an explicit abstraction. Prototype that boundary before choosing Quint as an irreversible foundation.

Implementation links can later map model operation IDs to real code and replay generated traces. Trace replay gives conformance evidence for the observed cases. Stronger refinement proofs are separate work. Generated stubs alone do not keep a model true as the implementation changes.

## First implementation

1. A textual parser and typed IR for values, tagged outcomes, named pure rules, operation signatures, sequential/branch/bounded-loop flows, and resource states.
2. Local checks for unknown names, incompatible signatures, unhandled declared outcomes, invalid transitions, and visible undischarged resource obligations.
3. Symbolic external-call counts with explicit unknowns and budget comparisons.
4. A restricted, source-mapped translation to Quint for one checkout workflow; preserve the lost-response distinction.
5. Recorded counterexamples and evidence-labelled reports. Add duplication hints only after named rules and structural equivalence have clear semantics.

This sequence is an implementation proposal; none of these new-language compiler stages is built yet.

## Acceptance examples

The checkout must expose the three defects already demonstrated by the existing checkers. Additional cases must establish generality:

| Program kind | First useful finding |
|---|---|
| Pure data transformation | Nested scans produce a quadratic comparison count under stated bounds; a shared policy has conflicting copies. |
| File-processing CLI | A declared parse-error/cancellation path can leave a file or temporary directory unfinished. |
| Background task runner | A lost acknowledgement followed by retry can duplicate an effect; a task never reaches a terminal state under a specified fair environment. |
| API workflow | An item loop multiplies calls; an unknown payment outcome lacks a reconciliation path. |

Before expanding the grammar, demonstrate one non-service example and compare how much description is required in Standard 15, Quint, and VDM. If the new notation needs nearly all the implementation, the abstraction has missed the original goal.

## Decisions intentionally left open

- How much aliasing and shared state the first ownership checker supports.
- Exact syntax, package format, and a permanent project name.
- Backend boundaries for general recursion and algorithm proofs.
- How contracts map to code and how drift is detected.
- Which missing-decision templates belong in the standard library rather than the language.

These decisions should be tested against examples. They are not reasons to invent an entire compiler framework in advance.
