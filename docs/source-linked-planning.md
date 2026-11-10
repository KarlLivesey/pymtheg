# Linking plans to checked source

The tenth review found that native plans and checked `.pym` source are separate
worlds. A document import is not a substitute for a relationship to the actual
component. This bridge is required before another completeness claim.

## Identities and retained meaning

A source target uses `source:<project-relative-file>#<declaration>`. Project roots
are explicit; changing the selected entry cannot change that ID. A read-only
catalogue is projected from the canonical typed ProjectIR, with source snapshot,
file hashes, declaration spans, normalized declaration hashes and direct dependency
edges. Formatting/comments do not change a declaration hash. Body/contract changes
do. Dependent type and callee changes propagate through the graph rather than
repeatedly expanding every dependency closure into each hash.

The current source catalogue is session data and never writes the workspace during
a check or MCP read. Incomplete or unparseable source remains an explicit unavailable
or partial target, not evidence of deletion or successful verification.

## Save and review contract

The plan editor offers source components alongside retained records. Saving a plan
that selects source targets revalidates their captured file hashes, then atomically
retains a source-catalogue document and the plan in the same architecture checkpoint.
The catalogue is native metadata preserved by rolling imports. Each plan keeps its
own expected declaration hashes; refreshing another plan must not acknowledge
this plan's outstanding change.

Historical catalogue entries stay snapshots. Needs attention and MCP compare the
plan's expectations with a fresh read-only source catalogue, and propagate changed,
missing or unavailable dependencies to the linked plan. A check never silently
updates those expectations. Explicit review updates them when saving the plan.
The source record exposes the real file/symbol and a route to the source editor;
agents can follow the same project-relative ID to check or edit a proposal.

This records design relationships, not proof that a requirement is satisfied or
that handwritten code implements the design. Imported catalogue snapshots remain
unverified claims. Source parse/type errors and capture cancellation are visible.

## Bounded operations and acceptance

One ProjectIR feeds each source capture. Hash each declaration once; retain direct
edges and use a multi-source reverse walk for impact. Page catalogue metadata;
load full source/contract details only on demand. Use the existing worker/cancel
strategy and source limits. A partial inventory cannot claim complete coverage.

Closed-loop checks required:
1. Empty init → first plan → source component → link and save → agent follows it.
2. Edit a signature/body or referenced type → linked plan needs review; an unrelated
   source edit does not stale it. Existing expectations survive restart/import.
3. Parser failure, missing symbol, and stale capture stay distinct from a match.
4. Source reads and MCP calls leave the database bytes unchanged.
5. Move the initialized project, page a large catalogue, and cancel capture without
   corrupting saved plans or source.

Implementation is in progress. This document is a design contract, not a completion
claim for source-linked planning.

Per-plan source-file hashes now also identify the exact retained declaration text
used at capture/review. Semantic expectation hashes still ignore formatting.
This keeps a second plan's formatting-only recapture from replacing the first
plan's displayed reviewed source. Older records lacking this reference are
labelled as previously retained source, not an exact review version.

The current large-project path supports explicit file selection past the
10,000-file browsing cap. It rechecks the chosen path and import closure; omission
from a bounded inventory is not evidence of deletion. Combined source review is
bounded to 32 source files and 32 MiB, with explicit errors at those limits.
