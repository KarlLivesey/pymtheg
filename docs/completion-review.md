> Historical review. Read the [current completion audit](current-completion-audit.md)
> for the latest independent assessment, outstanding gaps and exact validation
> boundaries. Earlier scores below remain withdrawn; historical evidence retains
> its original scope.

> Reopened for a whole-product usability audit at Karl’s request. The scores below describe the previous self-review and are not the conclusion of the current audit. First-use gaps were reproduced.

# Historical completion review: reopened

Historical checkpoint only: these gate and score claims predate the independent
usability audit and the architecture-holder requirement. They are withdrawn for
the current product. TypeScript, Rust, Go and extensible language output were
part of that earlier checkpoint. This is an evidence-backed
engineering **self-review**, not an independent usability certification or a
universal verification claim. The table below is preserved as history, not a
current readiness claim.

## Separate area gates

Each area was assessed independently against the completion goal of the time. There is no
weighted average that can compensate for a missing feature. Design and delivered
workflow scores are both 9.5/10 for the bounded release. The remaining deductions
below describe limitations of breadth and polish, not hidden unfinished gates.

| Area | Design / delivered | Evidence and remaining deduction |
|---|---|---|
| Guided scenarios | 9.5 / 9.5 | Checked-IR shapes; Bool/integer/string/record/list/tagged controls; real finite simulation; named scenario saved and reproduced through CLI (`studio-scenario.browser.mjs`). Advanced or recursive domains remain a deliberate expert workflow, not universally automatic forms. |
| Durable recovery | 9.5 / 9.5 | Transactional drafts; killed-before-commit recovery; stale-writer conflict; restart restores buffers/context/frozen history; source conflict review and save-copy; competing drafts reviewed before retry (`recovery.test.mjs`, `studio-recovery.browser.mjs`). History is deliberately bounded to three durable runs; there is no cloud backup. |
| Larger designs | 9.5 / 9.5 | Seven-file independent workbench, file/evidence filters, direct navigation/transitive impact, 400-to-201 comparison, scope/seed/assumption warnings, multiset findings. Unchanged costs are hidden by default. Deterministic 10,000-rule counters remain linear in visited rule nodes, with zero pair comparisons. Whole-repository ingestion is outside the language tool. |
| Clarity | 9.5 / 9.5 | Diagnostic families explain the problem, consequences, next action and evidence; declaration navigation and correction exercised end to end. Incomplete/unsupported/sampled/finite results remain different. More domain-specific examples and terminology testing with new users can improve onboarding. |
| MCP | 9.5 / 9.5 | Modern/legacy clients; inspect/check/fix/recheck; actual traces; cancellation; stale/malformed inputs; installed-package execution. Sources are not written; executable plugins cannot be selected over MCP. Local stdio only; no remote collaboration service. |
| Code scaffolds/plugins | 9.5 / 9.5 | One versioned contract document; three built-ins; real Rust/Go syntax and type checks where empty bodies permit them; TypeScript AST empty-body checks; fourth JavaScript plugin; malformed/version/identity/cancellation controls; Studio downloads and installed-package plugin run. Target-language idiom tuning remains possible. Empty non-unit return bodies are intentionally unfinished, not typechecked implementations. |
| GUI | 9.5 / 9.5 | Seven guarded browser workflows cover onboarding, editing/navigation, checking/fixing, traces, sharing, typed scenarios, recovery, investigation and output downloads. WCAG A/AA scans cover dialogs and new views; screenshots inspected and defects corrected. Broader independent-user, assistive-technology and browser testing remains useful; it has not been fabricated. |
| System correctness | 9.5 / 9.5 | 116 local + 39 integration tests; exact source snapshots/evidence; cancellation and owned-process cleanup; deterministic count/readiness assertions; self-models and atomic publication. Finite/model-relative guarantees only. Arbitrary recursion, aliasing, liveness proofs and production conformance remain outside the published subset. |

A 9.5 here means the named local release workflows are implemented, tested and
reviewed without a known material defect at handoff. It does not mean a model can
know every intention, an untested third-party plugin is correct, or all possible
input programs and user workflows have been exercised.

## Critical findings fixed during this pass

- Volatile work was replaced by SQLite-backed draft/history recovery. A competing
  recovery revision stops saving until reviewed, rather than overwriting it.
- Source conflicts now offer a separate copy; original source and the unsaved
  buffer survive. The conflict dialog exposes both recovery versions.
- Scenario values come from checked types, rather than requiring JSON editing.
- Comparison originally hid the relevant changed flow below unchanged helpers;
  changed or incompatible work estimates now appear immediately.
- Duplicate finding text at two sites was incorrectly treated as a set. Counts
  are retained, and removed source files are visible.
- A disappearing heuristic property caused a false scope warning. Scope
  comparison now compares shared property identities; real changed seeds,
  bounds, versions and assumptions still warn.
- Recovery action buttons overflowed the dialog. Actions now wrap within a
  bounded, scrollable modal; a geometric regression assertion covers this.
- New accessibility tests required explicit browser contexts. The test harness
  was corrected, and all scans were rerun. Tests use isolated temporary projects,
  so recovery from an earlier test cannot contaminate the next one.
- Subprocess output could split a UTF-8 character across chunks. Streaming
  decoders now preserve exact Unicode; large-output regression covers it.
- The output-process self-model exposed cancellation after an already reaped
  child. It now models idempotent cleanup, matching the actual process owner.

## Commands and observed results

Run from the project root, after installing the pinned local dependencies.
The external tool paths below describe this validation environment, not bundled
runtime prerequisites. All backend/parser budgets are resource bounds; exhaustion
is unresolved evidence, never a passed correctness assertion.

| Command | Observed result |
|---|---|
| `npm run build` | Strict core and GUI typechecks; production GUI build succeeded |
| `node --test test/*.test.mjs` | **116 passed, 0 failed, 0 skipped** |
| `PYM_TLC_JAR=/tmp/spec-language-research/tla2tools.jar PYM_GO=/tmp/pym-go-1.25.4/go/bin/go node --test test/*.integration.mjs` | **39 passed, 0 failed, 0 skipped** |
| `node scripts/gui-check.mjs` | **7 suites passed**, including new-control and dialog accessibility scans |
| `npm run format:check` | Passed |
| `node test/bench.mjs` | At 10,000 rules: one parse, 30,000 rule nodes, zero pair comparisons; elapsed measurements are observations |
| `./pymtheg check examples/self/output.pym --format json` | Five complete local results; one plugin invocation upper bound; cleanup on all modelled exits |
| Private `npm pack` plus offline `npm install --omit=dev --ignore-scripts` under `/tmp` | Installed runtime package; no publication |
| `node scripts/mcp-package-smoke.mjs /tmp/pymtheg-completion-plugins/install/node_modules/pymtheg` | Real MCP check, empty scaffold and Quint counterexample; hoisted dependency resolution works |
| Installed `pymtheg scaffold ... --target javascript --plugin .../examples/plugins/javascript.mjs --format json` | Four mapped library declarations; no omissions; `plugin_declared` assurance |

Tool versions: Node 24.21.0, Quint 0.33.1, TLC 2.19 (validated official JAR),
Rust 1.98.1 / rustfmt 1.9.0, Go 1.25.4. The temporary official Go archive was
verified with SHA-256
`9fa5ffeda4170de60f67f3aa0f824e426421ba724c21e133c1e35d6159ca1bec`.
No global installation, deployment, push, package publication or agent delegation.

Exact logs and generated reports: [`evidence/recovery`](../evidence/recovery).
The final local and GUI suites were rerun after view/comparison corrections;
unchanged real backend integrations were checked at their integration boundary.
All correctness tests use outcomes, exact counts, readiness or controlled clocks;
none asserts that the computer must finish in a tight elapsed-time threshold.

## What to run

```sh
./pymtheg studio .
./pymtheg check examples/workbench/system.pym
./pymtheg scaffold examples/mvp/library.pym --target typescript
./pymtheg scaffold examples/mvp/library.pym --target rust
./pymtheg scaffold examples/mvp/library.pym --target go
./pymtheg scaffold examples/mvp/library.pym --target javascript --plugin examples/plugins/javascript.mjs
./pymtheg mcp /absolute/path/to/project
```

Open Studio's printed URL in Firefox. The workbench intentionally retains an
unknown payment decision while its independent quote remains analysable. Ordinary
`check` is offline. Simulation and finite verification use explicitly requested,
pinned optional tools. Agent setup: [mcp.md](mcp.md). Language/limits:
[grammar.md](grammar.md), [support.md](support.md). Maintained system map:
[runtime-map.md](runtime-map.md), decisions: [decisions.md](decisions.md).
Output API: [output-plugins.md](output-plugins.md).

Inspected screens: [work improvement](../evidence/recovery/work-improvement.png),
[incompatible scopes](../evidence/recovery/investigation.png),
[recovery review](../evidence/recovery/conflict-review.png),
[typed scenario](../evidence/recovery/guided-scenario.png).

## Deliberate boundaries

Third-party plugins are trusted executable code in a bounded owned process, not
sandboxed adversaries. Their output is structurally validated and source-mapped;
its language semantics are not universally proved. Built-in outputs contain no
business implementations. Mathematical integers retain arbitrary precision;
Rust needs the declared num-bigint dependency, and Go's Nat restriction remains a
contract obligation. General aliasing, recursive cost proofs, arbitrary shared
memory concurrency, full liveness, implementation conformance, LSP/cloud services
and production code generation remain outside this release. Their unsupported
status is documented rather than converted into a pass.
