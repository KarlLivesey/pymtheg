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
`--limit N`; search additionally uses `--case-sensitive` to opt out of its default
ASCII case folding; impact additionally accepts `--include-possible`. Defaults: nearest `.pymtheg`/Git project boundary from the current
folder, depth 5 (allowed 0–100), limit 1000 (allowed 1–10000).

- `graph index`: force a complete index invocation; unchanged files still skip
  per-file parsing according to core contracts. Prints counts, failed-file paths
  and reasons, and index-phase duration in milliseconds as an observation.
- `graph status`: read-only assessment of existence, versions, counts, failures,
  retryable files and changed/added/removed/context/version paths. It never syncs.
- `graph search TEXT`: ASCII case-insensitive search over names/scoped identities
  by default, with `--case-sensitive` to opt out. Exact matches rank before prefix
  matches, then substrings; ties use folded name, display name, file, kind and ID.
- `graph symbol SELECTOR`: exact display name, recorded qualified/scoped identity,
  full stable `symbol:…` ID, or `path:line` (optional `:column`).
- `graph callers SYMBOL` / `graph callees SYMBOL`: direct `calls` links only.
- `graph path FROM TO`: bounded breadth-first call-path search, preferring a
  definite path; otherwise returns a candidate route explicitly marked candidate.
  A separate reverse walk reports unresolved suggestions and any `possiblePath`.
- `graph impact SYMBOL`: bounded transitive callers, carrying candidate uncertainty
  through every hop; a later definite route can strengthen a candidate result.
  Always reports possible unresolved callers at every visited frontier, including
  the depth boundary; follows those suggestions only with `--include-possible`.
  `distance` is the shortest observed distance within bounds, independent of
  strongest certainty (which can come from a longer route).
- `graph file PATH`: symbols and links in an exact project-relative POSIX path.

Every symbol-taking route (symbol/callers/callees/impact/path) accepts the same
selector forms. Name/identity selection remains exact and case-sensitive; only
search folds ASCII by default. IDs take precedence, then exact names/identities,
then positional syntax. `path:line` returns the innermost declarations covering
that indexed line; strict containers are removed, but same-line siblings and
equal ranges remain ambiguous. `path:line:column` selects ranges containing that
precise position. A selector with multiple matches lists them, never picks one.
Paths reject absolute, parent and backslash forms.

Every returned symbol, link and endpoint/candidate symbol carries 1-based `line`,
`column`, `endLine` and `endColumn` alongside the existing half-open UTF-16 `range`
offsets. Columns count UTF-16 code units, 1-based; end positions are exclusive.
Only LF (including CRLF) advances the line; lone CR, U+2028 and U+2029
do not. A leading BOM occupies an offset but does not count toward first-line columns. Text prints `path:line:column-endLine:endColumn [UTF-16 start..end]`, plus kind
and scoped identity where distinct; the opening path:line:column remains usable
by editors while both end coordinates and original offsets remain visible.
Positions are computed from the requested files' stored source snapshots, cached
once per answer, never from a newer edited file. `locationSource:"stored-snapshot"`
and `snapshotHash` identify that basis. With stale --no-sync, selectors and
positions describe the indexed snapshot; the stale warning explicitly says the
current file may differ. No guessed current-file line numbers are printed.
`--limit` bounds search/match/direct-link/file lists and traversal nodes/edges;
path's definite/candidate passes share node/edge budgets; its separate reverse
possible-path search reports its own `possibleBounds`. `truncated`/reported bounds
always disclose omissions, with `limit` and `resultCounts` in JSON and a final
`Truncated: returned …` line in text. A valid truncated answer exits 0. A missing path is only “not found within bounds”,
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

## Possible callers: suggestions, not resolution

Incoming queries include stored definite targets and candidate membership in
`links`. `callers` additionally returns `possibleCallers`, a **separate** list of
unresolved calls pointing toward the selected symbol. Every suggestion retains
its stored `data`/reasons and adds `matchKind`:

- `target-hint`: Rust's stored `data.targets` contains the symbol ID, or
  TypeScript's `{file,key}` target fact names it. Spelling need not match.
- `receiver-qualified`: the recorded selector/receiver type plus method name
  matches the recorded scoped identity (normalizing pointer parentheses and
  Rust `::` separators). Go uses `data.expr` selectors with recorded value/static types or named generic
constraints; Rust may
  record `receiverType`. This is a spelling match, not a type-resolution proof.
- `name-only`: otherwise, the last call-name segment matches the symbol's name
  exactly, after removing generic argument suffixes. Same-language matches only;
  other packages/types with the same name are expected noise.

`hasPossibleCallers:true` explicitly signals these suggestions even when `links`
is empty and status is `ok`. Text prints “Possible callers (unresolved): present”.
`classCounts:{definite,candidateSet,unresolved}` keeps the classes separate;
callers counts describe returned lists and `countsTruncated` says if more exist.
These are additional hints, never updates to stored resolution/candidate sets.

Impact's `possibleCallers` contains `{symbol,distance,links,classCounts,truncated}`
for every visited frontier node. Each unresolved link has `matchKind`; per-node
class counts are observations capped at limit, with omissions flagged. The
separate possible-report budget is at most `maxPossibleLinks=limit` associations
across frontier nodes. `--include-possible` follows the reported hints with route
certainty `unresolved`; those traversed edges are in `possibleTraversalLinks`,
not the ordinary definite/candidate `links`. Following an ordinary edge after an
unresolved hop remains unresolved. Without the flag no such hop is followed.
Global class counts count unique reported edges per class, not whole-graph totals.
Route states retain certainty and distance independently so a longer strong route
does not create an imaginary short strong route during traversal.

Path always reports possible hints during a bounded reverse walk from its target.
`possiblePath` is null or `{certainty:"unresolved",symbols,links}`. It is separate
from `found`/`certainty`/`links`, which only describe definite/candidate routes.
`possibleBounds` reports its separate depth/node/edge/report limits and truncation.
The reverse walk and impact report the depth-boundary frontier without following
further hops. No path result claims absence beyond its bounds. SQL scans unresolved
call rows using spelling/target prefilters and decodes only relevant rows, one at
a time; reports cache each frontier's hints. This adds scan cost per frontier,
not a new full-graph/source reload. No module or stored graph fact is changed.

## Sync, storage and completion

Before queries, inventory and original-byte hashes (streamed, strict UTF-8) are
compared with the recorded state. Mtimes never establish freshness. Additions,
deletions, source/context changes, module versions/configuration and retryable
failures cause an index invocation. `--no-sync` returns stored facts with explicit
stale/unverified warnings instead. `status` and query `--no-sync` open SQLite
read-only through the storage boundary, installing no schema/index/trigger or
completion record. A main-written schema-3 database is assessed unchanged;
without a completion record, no-sync queries remain unverified and exit 2. Indexing hashes again afterwards to report
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
matching/visited graph facts, plus only the stored source snapshots needed for
returned locations/selectors. They do not reload every stored source body, all
symbols or all links. Tests reject project-wide file-body metadata/count rescans
on every warm query route.
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
 truncated, limit,
 resultCounts: {matches, symbols, links, callers, observedLinks}, data}
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
| search | {matches, limit, caseSensitive, caseFolding: "ASCII" or "none"} |
| symbol | {symbol} |
| callees | {symbol, links, limit} |
| callers | {symbol, links, limit, possibleCallers, hasPossibleCallers, classCounts, countsTruncated} |
| file | {path, exists, symbols, links, limit} |
| path | {from, to, found, certainty, symbols, links, observedLinks, possibleCallers, hasPossibleCallers, classCounts, possiblePath, possibleBounds, depth, maxNodes, maxEdges, visited} |
| impact | {symbol, callers: [{symbol, certainty, distance}], links, includePossible, possibleTraversalLinks, possibleCallers, hasPossibleCallers, classCounts, maxPossibleLinks, depth, maxNodes, maxEdges, visited} |
| unresolved/ambiguous selection | {inputs: [{input, matches, truncated, totalAtLeast}]} |

Symbols retain all GraphSymbol fields and add the position/snapshot fields above.
Links retain GraphLink fields, add those same location fields, and add
`certainty: definite|candidate-set|unresolved`, `source`, `target` (symbols or null),
and each candidate adds its symbol or null. Candidate lists are not claimed to
be exhaustive; the module's stored openness/assumptions still apply. Some
unresolved links have no explicit reason beyond stored facts; none is invented.
All candidates/reasons are retained
for every returned link. Path certainty is definite/candidate; impact additionally uses unresolved for a
route through a possible call. Missing
paths have null certainty. `observedLinks` are exploration evidence, not a path.
The node count for path is unique across its two passes. Selection totalAtLeast
is a lower bound when truncated. On a missing index with --no-sync, data is null.

Status is ok/incomplete/ambiguous/not-found/bounded; it describes the result,
not only execution success. Exit codes:

- **0:** a valid answer, including truncation, ambiguity, no matches and bounded
  path absence. Ordinary unresolved-link warnings are not errors. Status without
  an index is a successful assessment; stale no-sync answers from a completed
  historical index also succeed with explicit warnings.
- **2:** actual capture/parser/analysis/resolution failure, partial/failed files,
  an index run that cannot certify completion, or a query with no usable completed
  index (including missing index with --no-sync). Returned partial facts and
  failure names remain available; this is not caused by truncation alone.
- **3:** invalid arguments, refused project state, storage/internal error.
- **130:** cancellation.

`resultCounts` counts only primary data lists: search/selector matches, explicit
symbol(s), ordinary links, impact callers and observed links. Possible-caller
counts are separate in `data.classCounts` and frontier reports. Nested endpoint/candidate
symbols are not double counted. Project-wide `counts` remain separate; selection
`totalAtLeast` remains a lower bound when truncated.

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
metadata, and queries with matching/visited facts plus stored source snapshots for the
locations actually returned. A positional selector reads only the matching file's
source and overlapping symbols; all overlapping declarations are needed before
innermost selection and output bounds can be applied. Metadata scales with file count.
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

## Pre-review usability follow-up

Normally merged the documentation fold: merge abb26889f7683a7d7c6d3bbc2b846c595d898d92,
actual second parent faff7a311d271cfbef4a0b3e27328861d84598e5. Added the positions,
ranked search, scoped/positional selectors, result counts and exit semantics above.
An additive identity expression index supports scoped lookup without a project-wide
fact reload. Tests include Unicode/BOM/CRLF, stale snapshot positions, ASCII-only
folding, ranking, qualified Go/Rust names, all positional routes and truncation's
zero exit/final text notice. No Go toolchain opt-in is wired here. Superseded local
iterations were removed from the branch tip; history retains them. Final evidence
is one pinned clean shallow restic transcript, with path:line:column text views and
source verification, plus the final check logs and a short change summary.

## PR 34 round 1 follow-up

Normal merge `2b089566a03cce66d0ad17e515d59e33f887f28c` includes main
`0977992a2ee99ecc30fb1974c27071a99477ee67` (actual second parent). The Go
toolchain opt-in remains unwired. All installs/builds/tests/corpus work in this
round run on the dev server via `pymtheg-dev --name w3-g-r1-ce94`; git/edits stay
local. The new read-only regression fixture is the schema emitted by that main
commit's actual store, not a W3-G store with objects removed. Provenance, final
checks, mutation kills and pinned-restic before/after/source audit are in
`evidence/w3-g/round-1/README.md`.

Final round-1 foreground validation: 2,595 full-suite tests passed, zero failures,
cancellations or skips; formatting and all 25 graph-command tests passed. The
known abrupt-owner-death test passed without a rerun. Five controlled certainty/
possible-call mutations were killed by explicit assertions (passing controls).

Pinned restic B1 comparisons (same store, ce94 query baseline): ToNode 0 ordinary
links → 13 separately reported possible calls; MakeReadable 0 → 6 possible;
SaverUnpacked.SaveUnpacked 0 → 2 possible. Default impact retains its 3 definite
callers and reports 2 unique possible sites across two public-wrapper frontiers;
opt-in additionally reaches SaveJSONUnpacked (distance 2), SaveSnapshot and
SaveConfig (3), all with unresolved route certainty. An unresolved possible path
is reported separately from found/definite/candidate paths. All 11 queries stay
warm/complete and exit 0; bounded opted-in impact/possible-path results explicitly
say truncated. The stratified 15-call audit finds 10 matches to the selected
declared receiver, 5/15 conservative name-only noise on the distinct fs.File
interface; this does not refute its structural compatibility with toNoder or
estimate corpus-wide precision. The source and exact audit criterion are retained.
