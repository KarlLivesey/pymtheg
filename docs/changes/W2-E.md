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

Existing tests and example/root configuration using `.pymtheg.json`,
`.pymtheg-architecture/` and `.pymtheg-studio/` must be repointed in a separately
owned fixture/documentation wiring change. This chunk cannot edit those tests.
Old-format tests can still exercise stored-format handling at the new paths;
old-layout migration expectations must become explicit refusal expectations.
User-facing hard-coded old configuration wording (including the forbidden
`src/reporting/explain.ts`) and current setup guides also need that follow-up.
The full-suite failures are retained, not waived or reported as a passing suite.

Final required run: 2,189 passed, 31 failed, zero skipped (2,220 total).
All failures were inspected and traced to old layout assumptions, including
ancestor discovery of the repository's tracked `.pymtheg.json` in the mixed-file
CLI test. The parser-owner test passed. Core build, formatting and all seven
new storage tests passed. Full logs are preserved; this is not a green-suite claim.
