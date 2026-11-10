> The rework requirements below are preserved. See [completion-review.md](completion-review.md) for their implementation and evidence, including the subsequent Rust/Go/plugin requirement.

# Product rework: usefulness before a score

Karl rejected the previous assessment: the interface and product need substantial
work, and must be easy to read, understand **and use**. The previous 9.5/10 rating
is withdrawn. Passing implementation tests is necessary but does not demonstrate
that the product solves the user's problem.

## Confirmed missing workflow: coding-agent MCP access

The product previously had CLI and Studio HTTP interfaces, but **no MCP server**.
Karl selected: let coding agents use Pymtheg to check designs and read findings.
This is an inbound MCP server, not a Studio client for arbitrary external tools.

The first transport is local stdio: `pymtheg mcp PROJECT_ROOT`. It must use the
same worker, typed IR, reports and optional real backends. It must never treat
an incomplete analysis as success or execute effects described in source.

Initial tools:

- Inspect the project: available source files and named scenarios.
- Check a source file, optionally with unsaved source overlays, without saving.
- Simulate/verify a selected entry with explicit finite scope and bounded settings.
- Read a saved run's summary, findings, individual property evidence and trace.

Reports are retrieved by immutable run ID. Large details are paged or bounded;
no unbounded full-project dump in an agent's context. Every summary states which
checks completed, what remains unknown and whether the source has since changed.
Tool errors, design findings and inconclusive evidence remain distinct.

One canonical project root confines all sources/imports. Agents cannot ask this
server to execute commands, install tools, send network messages or write source.
The host owns cancellation, request deadlines, workers and subprocess cleanup.
MCP cancellation uses the real request signal. Shutdown cancels outstanding work.
Stdout contains protocol messages only; incidental errors go to stderr.

## Hard acceptance journeys

1. An actual MCP client discovers tools and checks a source with a wrong argument.
   The returned finding identifies the affected call, explains the mismatch and
   points to the declared signature. Corrected unsaved input removes the finding;
   neither operation modifies disk.
2. An incomplete flow and an independent complete flow share a file. The agent
   can see exactly which results are usable and which depend on the hole.
3. A real source-generated counterexample can be retrieved step by step with
   source operations and changed values. Correcting the design changes the result;
   sampled and exhaustive evidence are not conflated.
4. Invalid paths, unsupported scenarios, cancellation, stale source and malformed
   requests cannot become a successful design claim. Test through protocol calls,
   not only private helpers. Use deterministic readiness and counts, not sleeps.
5. A person reading a finding can answer: what can happen, why it matters, where
   it comes from, what decision/action to consider, and what this evidence cannot
   establish. Apply the same presentation to Studio and agent summaries.

## GUI review must be critical

Current shortcomings include technical diagnostic wording, advanced scenario
editing as raw JSON, list-heavy inspection views, and volatile project state.
The existing browser tests cover navigation and mechanics, not comprehension.
The next GUI slice focuses on interpreting and acting on a finding. Do not hide
these gaps behind a new numeric score or declare the whole product done because
one MCP endpoint or a more attractive screen exists.

A new product rating is withheld until complete before/after journeys demonstrate
usefulness. Record remaining gaps explicitly. No delegation, publishing, remote
pushes or installation into the user's agent configuration without instructions.

The scaffold target has been clarified: actual source declarations **with empty
function/method blocks**, not declarations alone. The first output is TypeScript.
The tool must say that bodies are unfinished, preserve the originating snapshot,
omit unresolved contracts explicitly, and never invent implementation behaviour.
In particular, empty non-void bodies do not pass TypeScript's return checking.
That expected incompleteness must be reported rather than hidden with fake return
values or suppressed type errors. Files are returned as artifacts, not saved over
application code.

MCP uses the official stable v2 SDK (`@modelcontextprotocol/server` 2.4.0,
Apache-2.0). Both modern negotiation and existing initialize-based clients are
supported. The maintenance-only v1 package was inspected and removed before
implementation. Zod 4.2.0 and the test client 2.4.0 are pinned.
