# R1-C: MCP graph tools and design loop

Adds two agent tools, `code_graph` and `graph_result`, over the existing
`executeGraph` command API. No graph sources, stored schema, language interface,
module, CLI, backend selection or engine-status lines changed. The only server
registration edits are one import and one call; `try_inputs` has its separately
requested additive input form. Workspace edits own/close graph jobs. R1-A's
TLC/Quint/Java lines remain untouched.

## Agent surface

`code_graph` starts index/status/search/symbol/callers/callees/path/impact/file
work and waits up to five seconds by default for the first page inline (with a
session job ID for further pages). `wait:false` immediately returns a handle; an
unfinished default wait returns a handle with progress instead. Selectors, uncertainty, failed
files, staleness and auto-sync all come from `src/graph/commands.ts`; this layer
only validates/shapes, pages and bounds results. No re-resolution, traversal or
freshness algorithm is duplicated. **No additive graph export was needed.**

`graph_result` polls, waits with optional MCP progress notifications, reads named
sections or cancels. Work runs in an owned Worker so synchronous parser/resolver
phases cannot block stdio. One graph job runs per connection; disconnect cancels
and joins workers. Status is read-only; queries sync unless noSync. Initial cold
queries start full indexing, rather than answering from an incomplete graph.
Clients should retain the jobId and poll for long runs. `code_graph.wait` defaults
to true; `graph_result.wait` defaults to false and, when enabled, waits for completion.
The inline deadline selects only a response shape, never the validity of an answer.
`section` selects the first page, using the same renderer and byte cap as graph_result.
Progress is the core's deterministic file/phase counters; initial inventory/hash
work can have no progress event yet. No wall-clock assertions or scheduling sleeps.

Replies carry `pymtheg.mcp-graph/v1`, compact names/kinds/locations, core status,
counts, truncation and explicit follow-up instructions. Candidate membership is
paged separately with its full count and symbol refs; possible/unresolved calls
are separate and always flagged in the summary. Raw stored reasons remain in
exact detail JSON, with short per-job codes in a paged legend (including Rust
uncertainty and Go open-set qualifiers). Job completion is not a claim of semantic
success. Each completed page names a failed-file preview and its total; all names
and reasons are recoverable from failed_files pages, never silently discarded.
The default answer also shows ordinary/possible-link previews. A bounded miss is
not proof of absence; name-only suggestions are noisy and never promoted.

The stable reference is the existing literal `symbol:<64 hex digits>`, returned
as `ref` and accepted unchanged as a later selector. It is stable across ordinary
incremental indexing. The graph's namespace is persisted in graph.sqlite; deleting
or replacing that cache can reset references. File/qualifiedName/kind accompany
refs and exact source/snapshot fields are in details; future R1-D should preserve
that provenance, not silently relink a missing ID. New requirement-to-symbol
mutations are explicitly not implemented here.

## Bounds and errors

- At most 64 KiB per graph tool result, counting text plus structuredContent;
  this is below the shared 256 KiB transport guard. Pages adapt by UTF-8 bytes,
  not just item count. Overlarge single records fail explicitly rather than pass.
- Core query limit 20 by default / 100 maximum; depth 5 / 100. Core truncation
  needs a narrower/new query, not more result pages. Page nextOffset is separate.
- Three retained graph jobs per connection, each with at most 8 MiB of logical
  compact tables/details. Expiry and retention exhaustion give actionable errors.
  Indexing retains the core's existing memory/work costs, not an 8 MiB heap cap.
- Names are explicitly clipped at 200 characters, preserving Unicode boundaries;
  full data is retrieved with detail refs. Detail pages use the shared UTF-16
  character pager and SHA-256 contentHash. Paths and line/column metadata stay
  exact; stale no-sync positions describe the indexed snapshot.
- Operational/precondition failures have error code/message/action. SDK schema
  validation and existing legacy tools retain MCP isError text errors. Missing
  indexes, failed files and module-phase failures preserve the command layer's
  incomplete status; the exact index report is available as a detail ref.
- MCP root confinement refuses an init-free child that would implicitly index
  its parent's Git project. It neither initializes nor changes that boundary.

## Design loop and documentation

`try_inputs` accepts either an immutable runId **or** file plus optional buffers.
The file form uses the existing workspace check/typed snapshot, then the existing
trial worker. Canonical parse/type errors in the new file form return incomplete plus a runId and a request to read
findings. Report-level replayed contract violations remain executable and return
violated; the existing run-ID path retains its behaviour. No source is saved and no new
analysis or arbitrary runtime execution was added.

The real stdio test initializes a fresh project as setup, then uses only MCP plus
ordinary source edits: writes a new machine/flow design, reads a Nat-subtraction
T002 diagnostic and nextStep hint, fixes/checks it, tries inputs without a run ID,
verifies its finite machine and simulates it. It requires complete evidence with
the correct method; missing/unsupported/budget-exhausted results fail the test.
It additionally pins buffered unsaved inputs and old run-ID compatibility.

`docs/mcp.md` is rewritten as an executable ordered session. Its JS blocks are
executed verbatim by a test, with SDK adapters for call/refuse and ordinary file
edits. The test also compares exercised names against real listTools, so every
registered tool has a checked call/result. Legacy link/comparison/unlink examples
are explicitly refused examples with nonexistent targets, not fake successful
links; `plan:` prefixes are correct (S25). Successful new linking is R1-D.

## Validation and evidence

All installation/builds/tests/corpus work runs on the dev server via
`pymtheg-dev --name r1c-73c371-a1`; no heavy workstation work, browser or subagents.
Focused tests cover mixed init-free Go/Rust/TypeScript use, all actions, a failed
whole file, candidates/possible callers, ambiguity, positional/stable selectors,
truncation, edits/no-sync staleness, size bounds and exact details. A controlled
worker readiness handshake proves busy rejection, cancellation, retention and
shutdown without depending on machine speed.

The pinned restic transcript copies the read-only c734245 corpus into unique
PYM_SCRATCH storage, uses the real stdio MCP server for index and five questions,
records every response size, and independently checks three Go-source answers.
The copy/database and client/server are removed in finally. Final counts/results
and source hashes are in evidence/r1-c/README.md and its companion artifacts.

The design-loop proof uses the backends present on this main: this chunk does
not claim the Java-free release work from R1-A, change engine status, perform the
R1-E accuracy measurement, or establish production conformance. Other inherited
limits include core indexing cost, conservative/noisy possible callers,
per-connection jobs, no cross-process index coordinator, and SQLite WAL -shm read
marks. No MCP project initialization tool, watcher, HTTP transport, new language
precision, package publication or requirement-to-symbol join is included.

Initial validation at `127b7508`: **2,602 npm-test cases passed**, zero failures/cancellations/skips;
format:check and all seven new focused tests passed. The unchanged MCP regression
subset plus the new cases passed 30 tests. The executable docs cover all 19
registered tool names. Pinned restic index + five questions use 17 successful MCP
calls, at most 37,288 bytes per result (below 65,536), with three source checks.
The initial over-broad try_inputs guard caused two intermediate failures; it was
corrected without changing old assertions, and the regression/final results are
recorded separately. The final source hashes match the corpus manifest; all copied
corpus/database scratch, clients/workers and both dev mirrors are cleaned.


## PR 40 inline-result follow-up

Normally merged main `350b70cee19dfa6ef2b3e60a4fbe2503d8e38fa3` in merge
`51a2e9ccbdeb27b800822c24cd4e02a2943a0334` (other parent:
`127b7508679de45adf1e9e6ad09dd87ba8f66c78`). This brings in clean init and
Go toolchain links; this follow-up adds no toolchain wiring and no dependency
on the unmerged requirement-link wrapper.

A shared wait helper releases progress/abort listeners and clears its deadline.
Cancellation still joins the worker; a completed page is rendered only after
worker exit. The existing one-worker and disconnect-cleanup rules remain.
Three controlled-worker tests force completion before deadline, deadline before
completion, fire-and-poll, and cancellation during an inline wait. An injectable
deadline is test infrastructure, not an MCP setting. They compare the entire
inline response with graph_result and assert the wire cap and worker cleanup.
No elapsed-time assertion decides correctness. Executed docs show both valid
shapes and explicit fire-and-poll. Follow-up validation and the new five-question
restic transcript are recorded in `evidence/r1-c/inline/README.md`.

Follow-up checks: **2,676 full-suite tests passed**, format check passed, and
**33 focused MCP regressions passed**. All five warm restic questions returned
inline in **one call each** (6,348 / 37,288 / 10,020 / 6,272 / 20,118 bytes).
The explicit cold index used two calls; seven total versus the historical 17.
All three pinned-source checks passed; source hashes match the recorded manifest.
