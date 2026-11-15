# Requirement -> component -> executable evidence

This is the maintained requirement index. The current candidate has passing
632-test local, 95-test real integration and 101-journey GUI evidence; those
counts do not establish whole-product readiness or replace independent review.
See [current completion audit](current-completion-audit.md) for the outstanding
acceptance gates and [current evidence](../evidence/product-audit/seventeenth-validation.json).

The review-by-review sections below retain the decisions and boundaries at each
stage. Their dated pending notes are history, not the current capability list.

Karl's expanded scope also requires:

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Versioned planned/existing/gap graphs | bounded implementation; completion review open | Retained TS/JS observations, independent plan/code versions, many-to-many links, simultaneous gap conditions and per-link source/call-site review. Other language readers and behavioural conformance are not delivered; see `implementation-gap-map.md` |
| A real visual block editor alongside text | bounded implementation; independent readiness review open | Shared source/undo/recovery, typed calls, outcomes and resource actions; create components, operations, data, resources and finite event models; edit lifecycles, types, interfaces, state ranges and operation rules/work. Source-preserving Text remains available. See `block-editor-map.md` and `operation-editing-map.md` |
| Clearer typography and reusable visual standards | implemented foundation; usability acceptance open | 16px body/15px code foundation; first-use, narrow-layout and three-engine operation-form checks pass. Real screen-reader use remains unverified. |

Statuses describe this MVP. `partially implemented` names a concrete limit, never
a disguised pass. The [initial map](../design/initial-system-map.md) records the
pre-implementation hypotheses. New evidence lives in `evidence/`, separately from
unchanged historical `research/results/`.

| Requirement | Status | Component / acceptance evidence |
|---|---|---|
| R01 signatures/data/types/spans | implemented | language + semantic; `test/core.test.mjs`, `test/imports.test.mjs` |
| R02 four application domains | implemented | `examples/mvp/{algorithm,files-*,task-*,checkout*}.pym`; captured reports |
| R03 outcomes/unknown isolation/consumers | implemented | closed Result/union matching, dependency closure; core tests and `quote-unknown.json` |
| R04 ownership/obligations/cancellation | partially implemented | conservative single owner/read borrow, local automata, transferred summaries; core tests; no general aliases, owned result collections or loop invariants |
| R05 composed costs/budgets/repeated work | implemented | additive counters with exact/upper/unknown; cost regressions incl. bigint/zero/early return/recursion; `algorithm.json`, `quote-unknown.json` |
| R06 exact independent rule copies | implemented | alpha canonical hash buckets, resolved symbols; core/import tests and deterministic benchmark; near copies deferred |
| R07 real behavioural integration | implemented | explicit finite-machine subset; `test/backend.integration.mjs`; built-in exhaustive search and seeded sampler (R1-A removed Quint and TLC), all 3 checkout defects, task retry, renamed/reordered source |
| R07 bounded structured flow lowering | implemented bounded subset | `test/flow.test.mjs`, `test/flow.integration.mjs`; capability preflight rejects unsupported recursion/domains/concurrency |
| R08 scoped evidence/unknowns/assumptions | implemented | result/exit policy, schema, model/session tests; never merges sampled/exhaustive/incomplete/cancelled into one pass |
| R09 actionable text and versioned JSON | implemented | actual locations, related declarations, paths; independent Ajv schema validation, JSON stdout isolation |
| R10 tool efficiency/measurement | implemented | parse-once imports, reverse effect worklist, indexed diagnostics, cost caps, hashed rule copies; `benchmarks.json` |
| R11 cancellation/owned process cleanup | implemented | worker termination, TERM/KILL process groups, temp finally; process/session tests, CPU cancellation measurement; session-escaping malicious descendants outside containment |
| R12 stale evidence/atomic publication | implemented | snapshot/model hashes, frozen source text, staleFiles; source edit and interrupted/failing publication tests |
| R13 design before construction | implemented | initial map preserved; decisions/grammar/probes published before broad compiler; progress loop record |
| R14 short feedback loops | implemented | meaningful failing/corrected CLI tests and actual output per loop; `docs/progress.md` |
| R15 executable self-models | implemented | `examples/self/pipeline.pym`, `publication.pym`; reports compare 100 versus 20 reads/parses under declared file/pass assumptions; real loader parse counters and lifecycle tests challenge model |
| R16 honest support/evidence handoff | implemented | this checklist, support matrix, decisions, captures; no universal correctness/translator equivalence claim |
| General logical feasibility/postconditions | partially implemented | conjunctive scalar entry/guarantee consistency; branch-sensitive scalar/affine call facts and supported assumed return bounds; unresolved/general proofs explicit |
| Arbitrary shared memory parallelism/aliasing | deferred | requires semantics beyond v0; unsupported lowering |
| Recursive cost proofs, amortisation, probabilities, latency, peaks | deferred | recursive work unknown; reserved nonadditive metrics rejected |
| Quint-to-TLC via Apalache | withdrawn | external checkers removed in R1-A (decision D2); historical probe failed acquiring the missing distribution |
| Full liveness/progress, refinement/conformance, production code generation | deferred | safety-only models and abstract environment contracts |
| Guided local GUI and recovery | implemented | typed scope forms, transaction/restart/conflict tests, multi-file investigation and scope-aware comparisons; browser suites |
| Agent-facing MCP | implemented | `test/mcp.test.mjs`, `test/mcp.integration.mjs`, installed package protocol smoke |
| Fail-fast code scaffolds (optional empty bodies) | implemented TypeScript/Rust/Go + plugin API | checked signatures/types/contracts; native compiler non-Unit return tests, unresolved declarations omitted; explicit plugin identity/version/cancellation tests |
| LSP, extra backends, incremental semantic cache, publication | deferred | package private; recovery storage is not a semantic cache |

Acceptance details: [acceptance.json](../evidence/acceptance.json) records exact
commands, exits and each result's method/completion/bounds/witness validation.
Tests assert problematic/corrected cases and false-positive controls. Measurements
are observations, not tight timing correctness assertions. Correctness tests use controlled clocks, explicit child readiness and deterministic operation counts. CPU cancellation uses the production coordinator with a worker that cannot finish before cancellation. No elapsed-time threshold decides correctness. Real backend runs have explicit resource budgets; exhaustion is reported as an unresolved/skipped integration case, never a pass.

| Extensible language outputs | implemented | `contracts/document.ts`, built-ins and `plugins.ts`; `output-plugins.test.mjs`, `outputs.integration.mjs`; JavaScript example requires no compiler change |

## Reopened architecture and usability requirements

| Requirement | Status | Evidence |
|---|---|---|
| Retain whole imported architecture and unknown fields | implemented for text-document import | `architecture.test.mjs`; ProjectC import manifest and GUI probe |
| Native requirements, decisions, risks, owners, criteria and evidence notes | implemented | `studio-architecture.test.mjs`, `studio-architecture.browser.mjs` |
| Stable revision comparison and dependency impact | implemented structural subset | ID rename/deletion tests; GUI revision comparison |
| Large rolling revisions without copying unchanged documents | implemented with explicit quota | 100-revision content-dedup test; v1 storage migration regression |
| Recover unfinished architecture edits | implemented | stale-writer test; `studio-architecture-recovery.browser.mjs` restarts the real server |
| Agent access to architecture, recipes and example results | implemented read-only | actual MCP client discovery and calls in `mcp.test.mjs` |
| See inputs produce an actual result | implemented deterministic flow subset | `trial.test.mjs`, `studio-trial.browser.mjs` |
| Guided route to a real counterexample and corrected model | implemented bounded retry recipe | `recipes.integration.mjs`, `studio-recipe-outcomes.browser.mjs` |
| Usable interface output from unfinished component bodies | implemented | scaffold tests and actual GUI preview journey |
| Contextual call completion with explicit unresolved values | implemented syntax-assistance subset | `studio-completion.browser.mjs` |
| Whole-product first-use quality at 9.5 in every area | under review | previous score withdrawn; independent re-review required |

| Review-driven requirement | Current boundary | Evidence |
|---|---|---|
| Keep active plans through source refresh | Source-scoped merge, reviewed snapshot commit, local-edit conflicts | `architecture-continuity`, `architecture-preview`, import GUI |
| Rebase and recover independent edits | Per-record/document comparison; explicit same-record review; source-specific duplicate resolution | `architecture-rebase`, `studio-architecture-rebase.browser` |
| Read-only agent architecture access | No persistent schema/projection/permission writes; legacy worker cancellation | `architecture-agent-readonly`, `architecture-readonly` |
| See type, prose and route dependencies | Conservative references, linkable Markdown sections, catalogue-level metadata | `architecture-impact`, `architecture-documents` |
| Find open planning gaps and changed evidence | Structural criteria/links/evidence checks; no proof inferred | `architecture-work`, work GUI |
| Transfer complete local architecture history | Atomic, validated deduplicated archive; 64 MiB transfer bound | `architecture-history`, history GUI |

Fourth-review regression traceability:

| Requirement | Contract/implementation | Evidence |
|---|---|---|
| Truthful rolling history | `checkpoint_log`, v5 `checkpoint_parents`, merged graph validation | `checkpoint-order.test.mjs`, `storage-v4.test.mjs`, final history GUI |
| Stable source refresh | per-source inventory, tracked-path/fork metadata, canonical registry serialization | `architecture-tracked-source.test.mjs`, `architecture-multisource-cli.test.mjs`, import-resolution GUI |
| Links keep their meaning | full heading identifiers, explicit anchors, no body-only rebinding | heading identity/link/evidence tests |
| Rich first-use inputs | bounded interface builder, three form steps and named reuse | `interface-builder.test.mjs`, rich-interface and first-use GUI |
| Useful agent/plugin access | virtual buffers, shared builder, explicitly registered output targets | `mcp.test.mjs`, output registry/shutdown tests, installed-package smoke |

Post-sixth self-audit evidence includes locale-independent snapshot identity,
legacy history preservation and no-op refresh across locales
(`locale-portability.test.mjs`), bounded authoring shapes and metadata-phase
cancellation (`guided-shape-budget.test.mjs`), and the executable authoring
self-model (`self-authoring.test.mjs`). UI confirmation of these post-freeze
changes remains pending; the seventh independent review covers its frozen input.

Seventh-review follow-through:

| User-visible requirement | Implementation | Evidence |
|---|---|---|
| Check the selected design without unrelated fixture failures | Related import/reverse-caller scope and source policy; independently bounded/lazy inventory | `related-scope`, `source-inventory`, `studio-large-sources.browser` |
| Move a project without losing interface lookup | Relative MCP identities and name/relative-path search | `interface-search`, `mcp`, `studio-interface-scale.browser` |
| Preserve what a plan links to during a move/replacement | Unique content-first document matching; separate IDs for replacement headings | `architecture-heading-identities`, `retitled-link`, linked-target comparison GUI |
| Maintain generated contracts beside handwritten code | Contracts-only TypeScript/Go interfaces, Rust traits and portable drift manifests | `contracts-regeneration.test`, three real compiler consumers, `studio-contracts-regeneration.browser` |
| Resume interrupted interface design after a signature change | Retained baseline/proposed/current comparison and explicit current-target selection | `interface-resume`, `studio-interface-resume.browser` |
| Keep branch review history accountable | V7 identified acknowledgements, optional reviewer/notes, durable withdrawal and paged records | `branch-ack`, `studio-branches.browser` |
| Keep advice readable and evidence correctly labelled | Comment notices, long type formatting, structural/trace counts, clean search, empty-state contrast | `format`, `shared-interface`, `mcp`, architecture/readability GUI |

The discovery self-model (`examples/self/discovery.pym`, `self-discovery.test.mjs`)
also traces R10/R15 to observed directory-entry/list/parse counts. The compared
runs retain one typed source while differing in discovery work. Counts do not
assert a universal filesystem traversal or latency bound.

Large agent-facing output has separate transport evidence in
`emissions.test.mjs` and `mcp-emissions.test.mjs`: a thousand-type interface,
full source/manifest/details reconstruction, exact hashes, one plugin invocation,
old-snapshot retention after a new check, Unicode boundaries, eviction and clear.

Post-ninth-freeze additions requested by Karl:

| User-visible requirement | Implementation / evidence | Verification boundary |
|---|---|---|
| Initialize an empty project without invented content | `project/workspace.ts`; `workspace-init.test.mjs` | Atomic identity/config creation, eight-way concurrency, corruption and real relocation |
| Studio and MCP know the initialized project | Nearest-marker discovery and `ProjectView.workspace`; `mcp-init.test.mjs` | Real stdio connection from a subfolder and unsaved source check; rendered GUI journey queued separately |
| Preview and optionally retain existing docs | Filtered existing importer; `project-documents.test.mjs` | No saved import during preview; explicit import, no-op repeat, native-plan preservation and cancellation |
| Parser failure cannot silently erase consumer evidence | `reporting/selection.ts`; `related-scope.test.mjs` | No recovered declaration is required to preserve its module error and incomplete-file identity |

Post-tenth-freeze document reading: `DocumentReader.tsx` preserves original source
while providing formatted reading, bounded source pages and safe retained links.
`document-reader.test.mjs` checks rendered structure/inactive HTML and images;
`document-links.test.mjs` checks retained-revision path boundaries. The prepared
GUI journey has not yet run while the independent review owns the browser.

Post-tenth source-linked planning and rolling setup:

| User-visible requirement | Implementation / acceptance evidence | Boundary |
|---|---|---|
| Plans link actual checked source | `architecture/source-contracts.ts`, `studio/service.ts`, `SourcePlanLinks.tsx`; `source-contracts.test.mjs`, `studio-source-planning.browser.mjs` | Stable project-relative IDs, per-plan expectations and exact reviewed source; no requirement proof is implied |
| Work on a large rolling source project | Explicit import-closure capture; 2,051- and 10,002-file regressions | Browse cap is distinct from explicit source selection; aggregate review has explicit file/byte limits |
| Resolve setup import conflicts where encountered | `ProjectSetup.tsx`, `project/documents.ts`; `project-setup-review.test.mjs`, `studio-setup-conflict.browser.mjs` | Hash-bound choices, another preview before commit, separate acceptance of broken links |
| Switching import interfaces preserves a source | Shared document selection and inventory policy; `studio-source-profile.browser.mjs` | CLI/Studio no-op refresh keeps the same revision and document scope |
| Retain and resolve edited-move advice | Structured candidates in heading registry; heading identity regression tests | Suggestions survive later saves and clear after explicit repair; no automatic retargeting |
| Separate code signatures from design validity | CLI/GUI contract comparison and `contracts-regeneration.test.mjs` | Errors in the current model remain visible even if signatures match |

The formatted document reader's browser journey has now passed. Earlier pending
notes above describe the state before those runs and are retained as history.

Expanded-scope vertical slices after the twelfth review:

| Requirement | Implementation and evidence | Remaining boundary |
|---|---|---|
| Edit with friendly blocks and retain Text | `studio/block-model.ts`, `block-document.ts`, `BlockEditor.tsx`; block editor/resource/data-event/input-help tests and corresponding browser journeys | Common nested flow/resource actions, record/outcome edits and declaration creation work; existing lifecycle definitions and full machine creation remain open |
| Recover block edits and reject stale results | Shared editor history/recovery; `studio-block-recovery.browser.mjs` | Real restart, blank field and held-response cases pass; broader new-mode journeys still required |
| Retain implementation versions and compare to intent | `implementation/workspace.ts`, shared query worker and `ImplementationGraph.tsx`; implementation workspace/MCP/intent/multiple-link tests and graph GUI journey | TS/JS observation; explicit many-to-many bindings and structural status, not behavioural conformance |
| Agent access to planned/existing/gap graphs | `mcp/implementation.ts`; `implementation-mcp.test.mjs` | Paged graph/version reads and source previews; explicit metadata writes never modify source |
| Keep large graph queries cancellable | Owned query worker; `implementation-query.test.mjs` | Nonterminating worker cancelled through production coordinator; no elapsed-time assertion |
| Friendly declaration creation | Implemented bounded create-only forms | `declaration-authoring.test.mjs`, real interface API/MCP tests, `studio-declaration-authoring/recovery/stale.browser.mjs`; source stays unsaved until explicit Save |
| New declaration recovery and stale preview | Implemented | Blank type field survives actual restart; held preview cannot replace newer Text; duplicate names refuse creation |
| Reproducible browser selection | Implemented test tooling | Shared resolver, explicit helper environment and pinned-browser path recorded in the 85-journey journal; native crash trigger remains open |
| Compare and review one linked code change | `implementation/comparison.ts`, `comparison-protocol.ts`, shared query worker and `ImplementationReview.tsx` | Exact snapshot hashes, missing baseline, static-call-site deltas, unchanged database read, cancellation and malformed worker probes; actual MCP and stale-review/focus/draft-preservation GUI journey |

## Historical post-fifteenth-freeze evidence

These changes are outside the immutable candidate under independent review.
The complete local boundary passes 583 tests; the later self-model test is
recorded separately. Do not attribute new GUI work to the old 94-journey pass.

| Requirement | Component / evidence | Remaining boundary |
|---|---|---|
| R01, business contracts | Shared declaration schema/writer and `OperationRulesEditor`; `operation-authoring.test.mjs`, real template MCP and recovery tests | New operation-rule GUI journey registered but unrun until browser handoff; guarantees are assumptions |
| R03, R10, rolling change impact | `operation-authoring-project.test.mjs`: 128 impacted callers, exact parse counts and independent plan retained | One deterministic integration fixture, not a universal scale proof |
| R08, R09, exact readable evidence | BigInt-safe feasibility text serialization; `feasibility-rendering.test.mjs` and retained real before/after CLI output | Package boundary predates this renderer fix; later candidate validation must include it |
| R15, self-modelled authoring lifecycle | `examples/self/contract-authoring.pym`, source-replay test, real TLC counterexample and 130-state corrected check | Finite policy model with three source versions, not implementation conformance |


## Additional self-use evidence after the seventeenth freeze

The [initialization self-use journey](../evidence/product-audit/parent-self-use/README.md)
links Pymtheg's real initialization policy, finite self-model and implementation,
flags a deliberate temporary code change, and preserves current/historical gaps
through export and reload. Its separate full-source capture observes all 173
TypeScript files, keeps unresolved relationships explicit and isolates a changed
helper without changing other declaration identities. These checks add evidence
for R10/R12/R15 and versioned graphs; they do not upgrade product scores or prove
that implementation behavior conforms to the model.
