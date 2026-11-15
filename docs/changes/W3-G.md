# W3-G: pymtheg graph command

`pymtheg graph` is the first CLI entry point for the stored code graph. It discovers
all production language modules (currently Go, Rust, TypeScript/JavaScript); it
never executes project code or enables a language toolchain. Existing language
sources and the language-module/storage interfaces are unchanged. New concrete
store methods supply narrow queries, metadata and the approved completion record.
CLI dispatch/help edits are confined to dispatch and help entries. MCP/Studio
wiring and filesystem watching remain future chunks.

## Usage

All commands accept `--root DIRECTORY`, `--json`, `--no-sync`, `--depth N` and
`--limit N`. Defaults: nearest `.pymtheg`/Git project boundary from the current
folder, depth 5 (allowed 0–100), limit 1000 (allowed 1–10000).

- `graph index`: force a complete index invocation; unchanged files still skip
  per-file parsing according to core contracts. Prints counts, failed-file paths
  and reasons, and index-phase duration in milliseconds as an observation.
- `graph status`: read-only assessment of existence, versions, counts, failures,
  retryable files and changed/added/removed/context/version paths. It never syncs.
- `graph search TEXT`: case-sensitive substring search over names/scoped identities.
- `graph symbol NAME_OR_ID`: exact display name or full stable `symbol:…` ID.
- `graph callers SYMBOL` / `graph callees SYMBOL`: direct `calls` links only.
- `graph path FROM TO`: bounded breadth-first call-path search, preferring a
  definite path; otherwise returns a candidate route explicitly marked candidate.
- `graph impact SYMBOL`: bounded transitive callers, carrying candidate uncertainty
  through every hop; a later definite route can strengthen a candidate result.
- `graph file PATH`: symbols and links in an exact project-relative POSIX path.

A symbol name with multiple matches produces the matches, never an arbitrary
selection. Use a returned ID to disambiguate. Paths reject absolute, parent and
backslash forms. Positions are half-open UTF-16 offsets, not line numbers.
`--limit` bounds search/match/direct-link/file lists and traversal nodes/edges;
path's two passes share the node and edge budgets. `truncated`/reported bounds
always disclose omissions. A missing path is only “not found within bounds”,
never proof that no path exists. Candidate membership is preserved even when
there is only one remaining candidate; it is never promoted to a definite link.

Every known failed source/context/capture path is returned with a reason, in
stable path order, on every answer. A conservative warning names all failed
files because unseen declarations can affect answers beyond direct dependencies.
Partials remain explicitly partial/incomplete. Links retain the module's original
`data` (reasons, open-set qualifications, causes, assumptions and other facts).
The displayed certainty describes the stored relationship, not compilation or
production conformance. Unresolved links anywhere in the graph trigger an
additional completeness warning for callers, impact and path queries.

## Sync, storage and completion

Before queries, inventory and original-byte hashes (streamed, strict UTF-8) are
compared with the recorded state. Mtimes never establish freshness. Additions,
deletions, source/context changes, module versions/configuration and retryable
failures cause an index invocation. `--no-sync` returns stored facts with explicit
stale/unverified warnings instead. Indexing hashes again afterwards to report
edits made during the run. Freshness is as of captured reads, not an atomic
filesystem snapshot or a promise that the filesystem cannot change afterwards.

Manager-approved completion metadata uses the existing `graph_meta` table's new
`command-complete` key, **inside graph.sqlite**. No existing table columns or
language interface changed. The record is cleared before indexing and published
atomically only after stable completion with no capture/parser exception,
analysis/resolution error or retryable file. It includes the database project ID,
module IDs/versions/claims/context patterns, fixed exclusion/toolchain settings,
source/context hashes, compact file diagnostics/counts, and a SHA-256 fingerprint.
Fingerprinting proceeds one metadata record at a time. A self-check validates the
saved metadata before it is used; current inputs/configuration must also match.
Missing, unreadable, malformed, corrupted or mismatched metadata is a cache miss,
not a trusted answer. A replaced database cannot inherit a sidecar record: there
is no sidecar, and copying an old record into another project-ID database misses.

Additive SQLite triggers invalidate the key when files, contexts, symbols, links,
candidates or parse-failure provenance change through other API/database writers.
Publication checks the connection's SQLite data_version under a write lock;
interleaved commits from another connection prevent publication. Queries collect
their database answer in a read transaction. An interrupted run
or a failed resolver cannot leave a completed fast-path record behind. No
cross-process index coordinator is added: concurrent writers may get a SQLite
busy error or leave completion unverified; these are not reported as success.

Warm queries still walk/hash claimed source and context bytes, which is necessary
for content-based freshness. They load compact completion metadata and only the
matching/visited graph facts, not stored source bodies, all symbols or all links.
Tests reject even file-body metadata/count rescans on every warm query route.
Changed/incomplete indexes fall back to the existing full-snapshot indexer and
mandatory module phases; this chunk does not make that path faster or smaller.
TypeScript analysis-only failed files retain the core's existing retry behaviour.

Graph-only projects may create just `.pymtheg/rebuildable/graph.sqlite` and its
ignored rebuildable folder, without invoking init, creating a workspace marker,
or importing documents. This keeps indexing arbitrary source checkouts usable.
The storage boundary still refuses legacy layouts (including an old
`.pymtheg-architecture`) and symbolic/non-regular database paths consistently with
init/studio. `.git`, `node_modules`, `.codegraph` and `.pymtheg` directories are
excluded; discovered symlinks are not followed. Existing core inventory scope
rules otherwise apply; there is no new gitignore/build-configuration filtering.

## JSON contract: `pymtheg.graph/v1`

`executeGraph(request, options?)` in `src/graph/commands.ts` returns data without
stdout/stderr. `src/cli/graph.ts` parses arguments and renders it. Future MCP
wrappers can call the same function. Unknown/invalid requests and storage failures
throw to the caller; the CLI emits the error variant below.

Every successful execution, including incomplete/ambiguous answers, has:

```
{schema, command, root, indexExists, status, exitCode,
 sync: {mode, durationMs, report, complete},
 modules: [{id, version, indexedVersions, files}],
 counts: {files, symbols, links, failed, partial, unresolved, ambiguous},
 failedFiles: [{path, language, reason, range?}],
 staleFiles: [{path, change}], warnings: [{code, message, files}],
 truncated, data}
```

`sync.mode` is index/updated/unchanged/disabled/status; durationMs and the full
core IndexReport are null when no index ran. Duration measures indexProject only,
excluding preflight/postflight hashes. `complete` means a completed index matches
current captured inputs; it does not mean every link is resolved. Counts describe
canonical database records; failedFiles can additionally include capture/context
or claim failures absent from those records. `language` is null when there is no
single owning module. `change` is added/changed/removed/module-version/context/unreadable. A repeated known
encoding failure with the same byte hash is still failed/retryable, but is not
misreported as a content edit; a capture without a usable hash is unverified.

Command-specific `data`:

| Command | Data |
|---|---|
| index | null (report is in sync.report) |
| status | {retryableFiles} |
| search | {matches, limit} |
| symbol | {symbol} |
| callers/callees | {symbol, links, limit} |
| file | {path, exists, symbols, links, limit} |
| path | {from, to, found, certainty, symbols, links, observedLinks, depth, maxNodes, maxEdges, visited} |
| impact | {symbol, callers: [{symbol, certainty, distance}], links, depth, maxNodes, maxEdges, visited} |
| unresolved/ambiguous selection | {inputs: [{input, matches, truncated, totalAtLeast}]} |

Symbols retain all GraphSymbol fields. Links retain GraphLink fields and add
`certainty: definite|candidate-set|unresolved`, `source`, `target` (symbols or null),
and each candidate adds its symbol or null. Candidate lists are not claimed to
be exhaustive; the module's stored openness/assumptions still apply. Some
unresolved links have no explicit reason beyond stored facts; none is invented.
All candidates/reasons are retained
for every returned link. Path/impact certainty is definite/candidate; missing
paths have null certainty. `observedLinks` are exploration evidence, not a path.
The node count for path is unique across its two passes. Selection totalAtLeast
is a lower bound when truncated. On a missing index with --no-sync, data is null.

Status is ok/incomplete/ambiguous/not-found/bounded. Exit 0 means the request ran
without these warnings, not a completeness theorem; 1 means missing selection,
2 incomplete/ambiguous/bounded, 3 invocation/storage/internal error, 130 cancellation.
The CLI error variant is `{schema, command, status:"error", exitCode,
error:{message}}`; it never mixes progress with JSON stdout.

## Progress and limits

`graph index` emits deterministic inventory and parse file done/total counters,
module analyze/resolve phase start/end counters, and completion to stderr. It
cannot report inside a module's monolithic analyze/resolve callback; those phases
can be long. Parse totals describe the preflight snapshot; concurrent edits can
change subsequent work and are disclosed by postflight staleness. Automatic query
sync is quiet; explicitly run index for progress. Cancellation is cooperative
between storage/file/module operations; native synchronous module work is not
preempted. No continuous watcher, workers, module toolchain opt-in, MCP/Studio,
new language precision or missing dependency capture is implemented.

Search uses SQLite substring scans; warm work scales with source bytes plus compact
metadata, and queries with matching/visited facts. Metadata scales with file count.
Traversal is bounded, with no pagination/continuation tokens; narrow queries or
increase --limit up to 10000. Failed-file/stale lists deliberately are not truncated.
Future changes to indexing semantics/settings must change the completion schema
or enter its configuration fingerprint.
Graph namespaces are the persisted graph project ID, independent of a planning
workspace marker; joins are a later chunk. Full indexing retains the core's
snapshot memory and backend limits. The no-toolchain modules' existing known
limits and assumptions still apply; no universal accuracy claim is made.

Validation and the clean pinned restic trial, with three source checks and scratch
cleanup, are recorded under `evidence/w3-g/`.
