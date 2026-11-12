# W2-E: storage boundary and project layout

Implements mega-plan 3.1, 3.2 and 3.4, under D5/D6/D7. Local storage only;
no synchronization and no old-layout migration.

## Layout and contracts

- `.pymtheg/project.json`: stable workspace identity.
- `.pymtheg/settings.json`: project configuration and scenarios.
- `.pymtheg/shared/architecture.sqlite`: requirements, links, decisions,
  retained observations, checkpoint history and architecture authoring drafts.
- `.pymtheg/shared/drafts.sqlite`: unsaved Studio buffers and form/context drafts.
- `.pymtheg/rebuildable/graph.sqlite`: code graph cache.
- `.pymtheg/rebuildable/runs.sqlite`: bounded recent Studio execution cache.

Unsaved drafts are authored data, even though the previous implementation called
all of this "recovery". They deliberately stay in `shared/`: deleting rebuildable
state must not discard an unfinished design. Recent run results are derived,
can be rerun, and disappear on cache deletion. Export a report to retain it
independently. This supersedes the old single Studio recovery database location.
Planning history and its imported source snapshots remain durable and unchanged.

`src/storage/layout.ts` is the dependency-free path catalogue shared with identity
values. `src/storage/local.ts` owns project path selection, directory creation,
legacy detection, regular-file/sidecar validation and SQLite connection creation.
Feature stores retain their schemas, queries and transactions. The graph core's
explicit-path constructor remains public and unchanged; project callers use
`openProjectGraph(root, projectId)` from `src/storage/graph.ts`. Temporary immutable
read snapshots and conformance scratch databases still use explicit paths through
the same connection boundary; they are execution scratch, not retained project data.
Graph indexing callers should exclude `.pymtheg` using the existing directory
exclusion option; the graph core's traversal interface is unchanged.

Read-only path resolution creates nothing. Existing symlink storage directories,
files and SQLite sidecars are rejected, including dangling links. Old top-level
settings/architecture/Studio layouts produce a clear error before writes, even
when new-layout files coexist. Preserve/export with the previous version, then
initialize a separate new project. No automatic moves, deletion or fallback reads.
Internal document names such as `.pymtheg-source-contracts.json` are logical
snapshot keys inside the planning database, not additional files in the project.

## Minimal call-site changes outside owned files

- `src/project/config.ts`: resolve settings reads through the boundary.
- `src/architecture/store.ts`: select the planning directory and open its database
  through the boundary, including existing read-only snapshot handling.
- `src/studio/service.ts`: planning presence checks and scenario settings writes
  use the boundary's paths.
- `src/graph/store.ts`: connection creation uses the boundary; no schema, query,
  indexing, language-module or public-interface changes.

## Explicitly deferred: all of 3.3

This chunk does not add machine/actor identity, a globally unique change/event ID,
author attribution, recorded-change events, causal order across machines or
cross-machine history ordering. Existing workspace UUIDs, graph IDs, content
hashes, checkpoint IDs, timestamps and local checkpoint sequence/parent order
retain their previous meanings. No two-machine correctness claim is made.
Auditing/normalizing every persisted path (including historical provenance and
Studio run/report paths) to project-relative paths also remains for 3.3. These
require a separate storage-format/history chunk rather than widening this one.

## Validation and follow-up

See `evidence/w2-e/README.md` and the complete command logs. The new tests prove
single-folder creation, idempotent identity, durable shared content and unsaved
drafts after cache deletion, identical graph regeneration, non-destructive old
layout refusal, symlink rejection and the absence of feature SQLite openers.

The initial required run had 2,189 passes and 31 failures caused by old layout
assumptions. Its complete output is preserved as
`evidence/w2-e/npm-test-initial-layout-failures.log`. The manager then authorized
existing tests, fixtures and test configuration to be updated on this branch.
The follow-up changes below only repoint physical storage and prepare its parent
directories; all original behavioural assertions remain. Exact root-directory
listings now check the single metadata directory and its complete file listing.
Old stored-format migration tests still exercise their original database versions
at the new path. Explicit old-layout refusal tests and historical import-inventory
fixtures remain unchanged. No production code changed during this follow-up.

User-facing hard-coded old configuration wording (including the forbidden
`src/reporting/explain.ts`) and current setup guides remain documentation follow-up.
All of 3.3 remains deferred, as accepted by the manager.

## Test and fixture file inventory

Every test/fixture/configuration file changed in this PR is listed below.
Browser controllers received only fixture-path edits and syntax checks; no browser
was launched.

| File | Reason |
|---|---|
| `.pymtheg/settings.json` (moved from `.pymtheg.json`) | Preserve the repository's scenario fixture bytes at the current configuration path. |
| `test/architecture-agent-readonly.test.mjs` | Inspect the read-only planning backup and directory at the new shared path. |
| `test/architecture-checkpoints.test.mjs` | Inspect checkpoints and create the legacy-schema database under the new shared directory. |
| `test/architecture-long-record-search.test.mjs` | Mutate the retained legacy projection in the relocated planning database. |
| `test/architecture-readonly.test.mjs` | Keep byte, permission and worker-cancellation checks on the relocated database. |
| `test/architecture.test.mjs` | Build the legacy-schema migration fixture at the new planning location. |
| `test/branch-v6-readonly.test.mjs` | Downgrade and inspect the relocated local planning database. |
| `test/checkpoint-order.test.mjs` | Delete the actual planning directory when resetting the partial-lineage fixture. |
| `test/config.test.mjs` | Create and discover scenarios under the metadata directory. |
| `test/identity-rename.test.mjs` | Expect the shared configuration identity to name the new settings path. |
| `test/implementation-capture.test.mjs` | Read retained observation bytes from the relocated planning database. |
| `test/implementation-comparison.test.mjs` | Compare read-only HTTP access against the relocated database bytes. |
| `test/implementation-mcp.test.mjs` | Keep graph paging and read-only retained-history byte checks on the new database. |
| `test/implementation-versions.test.mjs` | Keep version-search immutability checks on the new planning database. |
| `test/locale-portability.test.mjs` | Inject the corrupted blob into the actual relocated database. |
| `test/mcp-init.test.mjs` | Expect one root metadata directory and verify its complete settings/identity file listing. |
| `test/mcp-inventories.test.mjs` | Prepare large-inventory scenario configuration at the new settings path. |
| `test/mcp.test.mjs` | Check that read-only MCP operations do not create the new planning directory. |
| `test/plan-source-code-journey.test.mjs` | Track retained source-review bytes in the new planning database. |
| `test/project-documents.test.mjs` | Check that preview-only document imports do not create the relocated database. |
| `test/recovery.test.mjs` | Crash the writer against the actual shared draft database. |
| `test/source-contracts.test.mjs` | Keep preview and atomic source-link persistence checks on the relocated database. |
| `test/source-inventory.test.mjs` | Prepare source selection settings in the metadata directory. |
| `test/storage-boundary.test.mjs` | Add the storage boundary, cache deletion/regeneration, legacy refusal and symlink safety acceptance tests. |
| `test/storage-v4.test.mjs` | Build the original v4 compaction/migration fixtures at the new planning path. |
| `test/studio-a11y.browser.mjs` | Copy the scenario fixture into the new settings directory. |
| `test/studio-entry-dirty-switch.browser.mjs` | Copy scenario settings to the new metadata location. |
| `test/studio-legacy-review.browser.mjs` | Downgrade the relocated local planning database for the legacy-review fixture. |
| `test/studio-scenario.browser.mjs` | Read saved scenario settings from the new configuration path. |
| `test/studio-unused-scope.browser.mjs` | Create the unused-scope scenario fixture at the new settings path. |
| `test/studio-version-search.browser.mjs` | Compare version-search reads against the relocated planning database. |
| `test/studio.browser.mjs` | Copy repository scenario settings into the new metadata directory. |
| `test/studio.test.mjs` | Repoint conflict settings, damaged draft storage and source-selection configuration fixtures. |
| `test/workspace-init.test.mjs` | Keep idempotence, configuration preservation, exact metadata listings and Git-ignore assertions on the new paths. |

## Current validation after fixture updates

The required foreground unit run passes: **2,220 passed, zero failures, zero
skipped**. The known abrupt-owner-death parser test passed in that run; no isolated
rerun was required. `npm run format:check` passes. The initial failed-run evidence
is retained under its historical filename; current logs use `npm-test.log` and
`format-check.log`. The 63-test targeted fixture run also passed. All modified
JavaScript controllers were syntax-checked, with no browser launched.

`PYM_TLC_JAR=/home/user/.t3/projects/pymtheg/evidence/project-fit/tools/tla2tools.jar npm run test:backend`
also completed in the foreground: **95 passed, zero failures, one skipped**
(96 total). The skipped case is `rust: real rich contracts compile with recursive
records, outcomes and arbitrary precision integers`; it reports compiler/dependency
unavailability or an exhausted resource budget. This remains unresolved compiler
conformance evidence, not a pass. All other backend cases ran successfully.
See `evidence/w2-e/backend-tests.log`. No check is left running.
