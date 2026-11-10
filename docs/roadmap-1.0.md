# Pymtheg: roadmap from 0.1 to a usable 1.0

Status: proposed delivery plan, 8 November 2026. This is a target, not a claim that
these features exist. Current capabilities remain in [support.md](support.md).
Karl requested a GUI, fast closed feedback loops, and correctness tests that do
not depend on computer speed. Those constraints apply to every milestone here.

## The 1.0 product promise

A developer can open a local project, describe a program without implementing its
adapters, and use Pymtheg to answer:

1. What data, outcomes, effects and resources cross each component boundary?
2. Which declared cases or decisions are missing, and who depends on them?
3. Can this bounded scenario leak, duplicate work, violate a rule or mishandle cancellation?
4. How does work multiply, and which assumptions make the estimate valid?
5. What changed when I edit a rule, interface, bound or failure policy?

They can investigate a finding in the GUI, follow it to source and evidence, edit
the design, and see the new result. The CLI and GUI must give the same answer.

“1.0” means a stable, useful and supported design workflow within a published
semantic boundary. It does not mean every language feature, solver, proof or
application architecture is supported. Generality across application domains is
more useful than a long list of unfinished analysis modes.

## Where 0.1 actually stands

The current tool has real textual parsing, a typed project model, local checks,
structural work accounting, exact rule copies, conservative ownership, a versioned
report, and real source-mapped Quint/TLC integrations. It has four example domains,
self-models and explicit limits. Existing test/capture counts are historical
baseline evidence, not a substitute for validating subsequent changes.

The important gaps for 1.0 are:

- No GUI or interactive authoring workflow.
- Structured flows do not execute or lower to behavioural checking. Authors must
  describe a separate explicit finite machine for that check.
- Contracts beyond constant arguments are mostly obligations. Diagnostic recovery,
  resource-returning calls, useful borrow patterns and loop ownership need work.
- Project/scenario configuration, change-impact browsing and saved run comparison
  are not yet product workflows.
- Packaging, compatibility policy, accessible interaction and independent-user
  acceptance are not yet established.

Do not put a polished “verified” dashboard over those gaps. Expose what each
analysis did and did not establish.

## Delivery order

Versions are planning labels, not dates or permission to create large batches.
Every row is delivered through small vertical slices with inspected evidence.
GUI work starts before the language expansion; the engine work then appears in
that same interface as it lands.

| Milestone | User-visible result | Engineering work | Exit evidence |
|---|---|---|---|
| **0.2 — inspect a real project** | Local GUI opens a report/project; findings jump to exact source; counterexamples can be stepped through | Thin local host, validated report API, source/evidence panes, run lifecycle and cancellation, tool availability | One real bad/fixed example changes the UI correctly; stale/cancelled/unsupported evidence cannot appear current and successful |
| **0.3 — author and iterate** | Edit multiple `.pym` files, run checks, understand missing decisions and impact | Versioned buffer snapshots, conflict-aware save, live diagnostics, basic completion/navigation, project/scenario configuration, reverse dependency view | Unsaved edit changes the analysis; late old results cannot overwrite it; added error variant identifies affected consumers |
| **0.4 — check the flow you wrote** | Selected structured flows simulate and verify without a second hand-written machine | Shared source-step semantics; abstract operation models; finite flow lowering; replay/differential checks | Two unrelated flow programs and renamed/reordered variants yield matching source/backend transitions and useful witnesses |
| **0.5 — realistic resources and work** | Model opening/returning resources, failures and cancellation; inspect trustworthy cost derivations | Outcome-specific ownership returns, borrow lifetime rules, loop resource invariants in a limited subset, cardinality propagation, explicit metric semantics, stronger repeated-work guards | File/task/payment cases cover success, errors, ownership transfer, cancellation and zero/early exits without lost obligations or false cleanup |
| **0.6 — contracts and design scenarios** | More useful precondition checks, feasible examples, reusable failure scenarios, before/after impact reports | Branch-sensitive scalar constraints, requirement IDs and dependency provenance, linked environment protocols, scoped scenario runs | Known feasible/infeasible cases; caller facts discharge supported obligations; unsupported reasoning remains visible |
| **0.9 — release candidate** | A new user can install, model, investigate and revise a project without assistance | Stable grammar/report/config APIs, migration tools, formatter, docs, diagnostics catalogue, accessibility, reproducible packages, clean-environment checks | Four domain acceptance journeys, CLI/GUI parity, crash/cancel recovery and deterministic regression suite |
| **1.0 — supported release** | A dependable local specification-design tool with a clear scope | Resolve release-blocking findings and document supported environments/compatibility | Release checklist below is met; any publication is separately authorised |

## GUI: an analysis workbench, not just a graph

Proposed default: a local web application launched with `pymtheg studio PATH`,
opened manually in Firefox. Keep the existing TypeScript/Node core. React + Vite
and CodeMirror 6 are a reasonable starting choice; validate this with the first
small slice before committing to extra infrastructure. No Electron, cloud account
or hosted service is required for the first GUI.

The source files remain authoritative. A graphical view is derived from the typed
project/report, not a second specification format. Drag-to-edit diagrams and full
round-trip graphical programming are outside the first GUI.

### Main workspace

- **Project navigator:** files, declarations, scenarios, named requirements/rules,
  and unresolved decisions. Search works before a large graph is rendered.
- **Source editor:** source-spanned findings, related declarations, completion,
  hover signatures, go to definition and find references. An old report can show
  its frozen source while the current editor has changed.
- **Findings/evidence panel:** what can happen, why, affected scope, assumptions,
  outstanding obligations, and the derivation or witness. Filters never erase the
  fact that a requested analysis was incomplete.
- **Run controls:** selected entry/scenario, Local Check / Simulate / Verify,
  backend availability, explicit scopes and limits, cancellation and history.
  Expensive backend runs require an explicit action; typing does local checks.

### Views that make the tool useful

1. **Overview:** findings grouped by component and evidence state. No global
   “verified” badge. “Job completed” is distinct from “property established.”
2. **Component/impact view:** calls, types, effects and dependencies, with reverse
   navigation from a changed rule/outcome. Start with a searchable list/tree;
   add a filtered graph where it clarifies a question. Do not draw 10,000 nodes
   merely because the project contains them.
3. **Resource lifecycle:** permitted states/transitions, current ownership and
   obligations on a selected path, including failure and cancellation exits.
4. **Cost breakdown:** expression, units, assumptions, bounds and contributing
   calls. Show why a change produced `3N` or `1 + 2N`; do not imply either is
   measured latency. Before/after comparison checks scope/unit compatibility.
5. **Counterexample player:** previous/next event, highlighted source operation,
   changed state values and violated property. Keep provider effects separate
   from what the caller observed. No autoplay timing is needed for correctness.
6. **Decisions/contracts:** explicit unknowns and proof obligations, their owners
   and consumers. Let users distinguish “assumed”, “model-checked in this scope”,
   “structurally established” and “not established”.

Initial GUI success is a real finding that a user understands and fixes. It is not
completion of all six screens. Add views as the underlying data supports them.

### Shared engine and session boundary

Extract/extend the existing coordinator into an application service consumed by
both CLI and GUI; keep one parser, typed IR, analyser set and exit/evidence policy.
The UI formats data and submits requests. It must not infer a verdict from a
process exit code, recalculate costs or reinterpret ownership.

A request carries project identity, exact source/buffer versions, requested entry,
scenario/configuration and a run ID. Responses/events retain the run ID and snapshot
hash. Partial, terminal, superseded and cancelled events have explicit states.
An old completion cannot replace new results just because it arrived last.
Cancellation and host shutdown release workers, checkers, streams and owned files.

For unsaved editing, introduce a source-provider/snapshot interface rather than
writing temporary edits over the user's files. Imports and dirty buffers must be
resolved into one versioned input snapshot. Save operations compare the loaded
version with disk, preserve unsaved changes, and surface external-edit conflicts.

The local host binds to loopback, authorises a session and restricts file access to
the explicitly opened project. Protect file writes and process-starting endpoints
from cross-origin requests and path/symlink escapes. It serves validated structured
data; it never executes `.pym` effects or renders source as raw HTML.

No agent preview/browser is needed while writing this plan. Future UI automation
must obey Karl's `pc-tools headless -- ...` limits, close browser objects in finally
blocks, and assert observable state rather than elapsed time. Manual review uses
Firefox; T3 agent preview remains disabled.

## The engine work that earns 1.0

### 1. Bridge structured flows to behaviour

This is the largest product gap. A user should not have to maintain equivalent
flow and machine models by hand for supported scenarios.

First settle the source-step semantics for return, match, retry, cancellation,
resource transfer and abstract calls. Then build a small reference executor and
lower that same typed semantics to the existing engines. It is an executable
model, not an implementation of networking, persistence or a framework.

Build in this order: pure finite branches -> one operation with tagged outcomes ->
matching/return -> bounded loops/retries -> nested calls -> resource/cancellation
paths. Finite records/unions/bounded lists follow with explicit value domains.
Any unsupported construct blocks that selected check instead of becoming an
empty action or silently reduced bound.

Link abstract operations to **environment protocols** when request submission,
provider effect, response delivery, idempotency, reconciliation or compensation
matter. Keep explicit machines as the advanced modelling option. Do not turn all
programs into actors, or silently make a whole external interaction atomic.

The first success criterion is one source flow producing an error-path witness
through a real backend and replaying it against source semantics. Next test an
independently structured program. Comparing a few traces is evidence, not a general
translator proof.

### 2. Make resource modelling practical

Prioritise resource-returning operations and tagged success/error ownership
summaries: opening a file should not require an artificial standalone declaration
when the design is naturally `open -> Result<owned File, Error>`.

Specify who owns each obligation on success, each error, cancellation, and return.
Add useful lexical borrowing and limited loop invariants without general shared
aliasing. Handle resources acquired inside an iteration and cleanup of an aborted
batch. General shared mutation and arbitrary owned containers remain later work
unless a real pilot example makes a narrowly supported form necessary for 1.0.

### 3. Improve contracts without promising universal proof

Propagate supported scalar facts from caller preconditions and branch conditions
into call sites. Explain whether a precondition was established, violated or left
as an obligation. Distinguish trusted external postconditions from checked model
bodies. Offer a feasible example when the supported constraint fragment permits it.

Do not require a new SMT/Why3 integration to call the product 1.0. Add one only when
real examples show a concrete need and the translation/evidence boundary can be
validated. Unproved contracts must remain visible.

### 4. Strengthen work accounting and change analysis

- Derive useful collection cardinalities through local bindings and calls.
- Preserve zero iteration, early returns, short circuiting, retry stops and cleanup
  contributions. Label exact versus conservative bounds and unknown terms.
- Give metrics explicit semantics/units. Never apply additive work algebra to
  latency or peak live memory merely because a user named a counter that way.
- Keep exact rule-copy analysis and safe hoisting prerequisites. Near-copy hints
  are optional, bounded and labelled heuristic; API batching needs capacity limits.
- Show changed interface/rule consumers, added obligations and comparable cost
  changes between two snapshots. Start with whole-project recomputation; introduce
  incremental caching only when measurements justify it and invalidation is tested.

### 5. Supply the everyday developer workflow

These are as important as more sophisticated analysis:

- Versioned project/scenario configuration and reproducible CLI commands for each
  GUI run, including effective tool versions, scopes, assumptions and seeds.
- `doctor`/tool-status guidance, pinned optional backends and explicit local setup.
  A missing backend must not break offline local checking; no silent downloads.
- A formatter and practical recovery diagnostics; source remains reviewable in Git.
- Requirement IDs, notes and ownership of unresolved decisions, linked to findings
  and affected components rather than a separate uncheckable document.
- Shareable reports that include evidence and scope. Avoid including full project
  source by default in a share/export without making that choice visible.
- CLI/CI mode with documented exit policy and stable JSON, plus lightweight editor
  integration. A reusable language service can later expose LSP; a full editor
  extension marketplace launch is not a prerequisite.
- Installation/help/tutorials and four real modelling journeys: pure algorithm,
  file CLI, background worker and checkout. A new user should be able to author
  a fifth example without hardcoded domain support.

## Tests and release gates

Every semantic addition needs one real bad source example, its corrected version
and a false-positive control. Keep diagnostics and source identity in the checks.

- **Deterministic correctness:** operation/node counts and configured analysis
  budgets, controlled clocks, readiness barriers and explicit event/state assertions.
  No startup sleeps, animation delays or throughput thresholds used as correctness.
- **GUI correctness:** component tests with controlled run streams, out-of-order
  results and external edits; end-to-end tests with the actual engine and source
  files. Accessibility checks cover keyboard navigation, focus, screen-reader labels
  and evidence indicators that do not depend on colour.
- **Semantic correspondence:** tiny transition-system differential tests and replay
  for supported constructs; rename/reorder/metamorphic controls; no fixture IDs in
  lowering. Parser/operator fuzz/property tests use recorded seeds and bounded work.
- **Lifecycle:** CPU cancellation, backend failures/hangs, retained descendants,
  host shutdown, incomplete evidence, dirty buffers and atomic publication.
- **Reproducibility:** clean local install/build, CLI/GUI parity, pinned backends,
  archived scenario commands/configuration, report/config migration fixtures.
- **Performance:** instrument parsing, graph traversal, effect propagation, cost
  expression growth, rule hashing and UI materialised element counts. Timings/RSS
  are measurements, not cross-machine pass/fail criteria.

A 1.0 release candidate must have:

- [ ] A documented stable core grammar and explicit unsupported boundary.
- [ ] One authoritative typed semantics shared by CLI, GUI and supported backends.
- [ ] A complete open/edit/check/investigate/fix/rerun/save/export journey.
- [ ] Structured-flow behaviour checks for the advertised subset, including real
      failure/cancellation cases and replayed counterexamples.
- [ ] Resource returns and per-outcome obligations usable in the four pilot domains.
- [ ] Supported contracts/costs explained with derivations, assumptions and unknowns.
- [ ] No stale, timed-out, cancelled or unsupported result shown as an unqualified pass.
- [ ] Deterministic tests, bounded integration probes and no known critical lifecycle,
      data-loss or false-assurance defect in the supported scope.
- [ ] Keyboard-accessible GUI, documented setup and reproducible private packages.
- [ ] Independent modelling feedback incorporated, not just the author's fixtures.
- [ ] Release notes, compatibility/migration policy and third-party licence notices.

A bounded solver timeout is not a test pass. It is unresolved evidence and may
make a release requirement incomplete. Performance measurements do not override
semantic acceptance criteria. Publishing packages/binaries remains a separate
authorisation, even once the release candidate is ready.

## The first small loops from here

Do these before building a broad dashboard or adding another backend:

1. **Read a real report:** render one captured report and frozen source in the GUI.
   Clicking its finding highlights the exact range. Validate the schema; malformed
   data gives an explicit error. No fake analysis output.
2. **Run the existing checker:** the local host uses the shared coordinator to check
   a selected real example; the same result appears in CLI and GUI. Cancel works.
3. **Play a witness:** previous/next through the task counterexample, with changed
   values and the original operation highlighted. Keyboard controls work.
4. **Protect versions:** feed a newer result before an older completion; the older
   one stays labelled old and never overwrites the current source/evidence.
5. **Edit and recheck:** one unsaved edit fixes a real issue; the new snapshot and
   diagnostics update without corrupting disk or dropping unrelated findings.
6. **Start the flow bridge:** one tiny typed branching flow executes using reference
   source semantics, then a real backend. Compare actual transitions before adding
   loops, resources or complex environment protocols.

Each item is split further whenever its next uncertainty cannot be checked in a
short loop. Keep the objective/change/evidence/next-step record. The next actual
implementation slice should be **GUI report + source navigation**, not another
architecture essay.

## Explicitly outside the initial 1.0 target

Universal proofs, unrestricted shared-memory concurrency, arbitrary aliasing,
recursive complexity inference, accurate general latency/peak-memory inference,
production code ingestion/conformance proofs, cloud collaboration/accounts,
graphical round-trip programming and multi-backend plugin infrastructure.

AI assistance may be useful later for proposing drafts or missing questions, but
it must not silently introduce assumptions or upgrade evidence. It is not needed
to make the core 1.0 workflow valuable.

## Execution gate

Karl authorised implementation after deep plan review and required a second 9.5/10
review of the nearly feature-complete result. [1.0-contract.md](1.0-contract.md)
now fixes the mandatory feature set, architecture decisions, score rubric and
hard blockers. It supersedes any suggestion that a partial GUI alone earns 1.0.
