# R1-D: link requirements to code symbols (the minimal join)

Release item 3 of D19 ("link requirements to Go/Rust symbols"); mega-plan 5.1, and
5.3/5.4/5.5 in small. A planning record (a requirement, or any other native
planning record) can be linked to a Go, Rust or TypeScript/JavaScript symbol from
the code graph. Links are shared planning data. Their state is computed on
demand against the current graph.

## What existed before this chunk

- **Requirement.** A `PlanItem` (`src/architecture/schema.ts`, `planItemSchema`)
  of kind `requirement`, or another planning kind (decision, component, risk,
  milestone, test, evidence). It sits inside a `pymtheg.plan/v1` JSON document,
  normally `architecture/plan.json` (`nativePlanPath`), which is retained in an
  architecture checkpoint in `.pymtheg/shared/architecture.sqlite`. The model
  projects each item to an `ArchitectureEntity` with ID `plan:<id>`, key and
  name equal to the title, and a `planning` field (`src/architecture/model.ts`).
  Documents imported from Markdown give `heading` entities, not requirement
  records. Mega-plan 6.5 (section → record) is not built.
- **Links that existed.** `PlanItem.links[]` = `{kind: depends-on|satisfies|tests|
  implements|supersedes|supports, target}`. The target is an architecture entity
  ID: another plan record, a document, a heading, a catalogue function or type, or
  a `source:` component captured from observed TypeScript (W1-era capture, with
  source expectations and baselines). These links are projected to
  `ArchitectureEdge`s. Nothing linked to the new code graph (`src/graph`), and
  `.pym` declarations are not architecture entities. So there was no
  requirement ↔ `.pym` declaration link to extend.
- **How they were created.** Only in Studio: `StudioService.savePlanItem` writes
  a new checkpoint of the plan document. Documents are also imported with
  `import-architecture` / `init --import-docs`. There was no CLI command that
  creates a planning record. MCP architecture tools are read-only
  (`src/mcp/architecture.ts`).
- **Stable IDs and history** (W2-E2). `shared_record_ids` gives every
  registered `(kind, key)` a random UUID; `shared_record_lineage` holds the
  `previous` reference used when a removed key reappears; `recorded_changes`
  holds immutable receipts (sequence, origin, time, checkpoint, before/after
  hashes). `RecordedHistory.record(kind, key, value | null, checkpoint)` adds a
  receipt inside the feature's transaction. Every checkpoint registers documents,
  entities and links.

## What this chunk adds

### Storage (schema addition, additive)

`ArchitectureStore.open` (writable) now runs, in its existing migration
transaction, `CREATE TABLE IF NOT EXISTS code_links (id TEXT PRIMARY KEY, key TEXT
NOT NULL, body TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0)`. This is the
same pattern as the W2-E2 ledger tables. `PRAGMA user_version` stays 7, and older
readers ignore the table. A read-only store without the table reports no links.
Two methods were added: `codeLinkRows()` and `writeCodeLink(key, value | null,
onlyIfAbsent)`. A write runs in one `BEGIN IMMEDIATE` transaction with
`RecordedHistory.record("code-link", key, value, activeCheckpoint)`, so a receipt
and its row commit or roll back together.

- **Link ID** = the shared record UUID of `("code-link", key)`.
- **Key** = `[record, language, path, kind, identity, ordinal]` *as first
  linked*. It does not change for the life of the link. A refresh after a move
  updates the stored body, not the key, so the UUID is kept ("edits without
  removal keep the UUID").
- **Removal** sets `removed=1` (the row is kept for history) and records a
  `null` hash. **Re-adding** the same key gets a new UUID with `previous` → the
  old one (the storage ruling). There is no restore workflow.
- Nothing is stored in `.pymtheg/rebuildable/`. Deleting it loses no link (tested).

### Stored reference (`StoredCodeLink`)

```ts
{ id, record: "plan:R1",
  symbol: { language: "go"|"rust"|"typescript", path, kind, identity, name, ordinal },
  fingerprint: { signature: sha256, body: sha256 },
  hint: { line, graphId },          // hints only, never identity
  twins: { path, fingerprint }[] | null,  // same-identity symbols in other files
                                          // at link/refresh time; null = not recorded
  created, refreshed: string|null, note, removed }
```

`identity`, `kind` and `ordinal` are the graph's position-independent symbol
identity (`src/graph/identity.ts`: the graph ID digests `module, file, kind,
identity, ordinal`). The path is project-relative POSIX, taken from the graph.
The fingerprint is computed from the symbol's source range in the graph's stored
snapshot. **Exact rule:** CRLF is read as LF, and spaces/tabs at the end of a
line are dropped; every other character counts. So a whitespace change inside a
string literal is `changed` (never a false `ok`), and so is a formatter run that
re-indents or re-spaces the code: a false `changed`, cleared by `refresh` after
review. One consequence: trailing spaces inside a multi-line raw string literal
are ignored. `signature` hashes the text before the first `{`; `body` hashes the
text from the first `{` on (empty when there is none).

### States (computed on demand; the graph is synced first, as `pymtheg graph` does)

| State | Meaning |
|---|---|
| `ok` | Same language, kind and identity at the recorded path; fingerprint equal |
| `changed` | Found at the recorded path; `differs` lists `signature` and/or `body` |
| `moved` | Continuity established: see the rule below. `differs` is `["path"]` (the text is identical by construction) |
| `missing` | Not found at the recorded path, and no move is proven. `suggestions` always lists, first, same-kind symbols in the linked file whose body is identical (a rename in place), then every same-identity symbol elsewhere, each with its reason (already existed when linked; different text; identical text but the linked file still exists; not unique). `mayBeHiddenBy` names failed files of that language. Suggestions are never applied |
| `unverifiable` | The recorded file failed to parse (or parsed partially and the symbol is absent). `unverifiableFile` names it, with the reason |

**The `moved` rule.** Go and TypeScript identities carry no package or file, so
a shared name proves nothing. `moved` is reported only when **all** of these
hold:

1. The recorded file is no longer indexed. If it still exists and parses but no
   longer has the symbol, the link is `missing` (a rename or an edit in place),
   even when identical text appears in another file.
2. Exactly one same-identity symbol has **identical text** (signature and body
   fingerprints equal) at a path that held no same-identity symbol when the link
   was made or last refreshed (`twins`). A same-name symbol with different text
   is only a suggestion.
3. No recorded twin with the same text has left its own path. If one has, either
   could be the source of the new symbol, so the link is `missing` with both
   suggested. A twin still at its recorded path is excluded, and the single new
   same-text symbol is taken as the move (tested).
4. No failed or partial file of that language could hide another candidate.
5. The link has a `twins` record. Links made at the round-0 head have none, so
   they are never `moved`.

This covers a real move across Go packages (different directory, same text). A
move combined with an edit is `missing` with a suggestion.

A link is never dropped or retargeted by resolution. `refreshCodeLink` (an
explicit request, after review) re-records the current symbol for a `changed` or
`moved` link and keeps its ID. It refuses `missing` and `unverifiable` links:
remove them and link again. A refresh also re-records `twins`.
`checkCodeLinks` fails on `missing`, `changed`, `unverifiable` **and `moved`**,
because a moved link is not confirmed until someone refreshes it. `allowMoved:
true` (CLI `--allow-moved`) lets moved links pass. A link whose planning record
no longer exists is reported (`recordPresent: false`, `orphaned`), not dropped.

Creating a link refuses a symbol in a file that did not parse cleanly. This
follows the decision "Unreadable code is failed".

### CLI (`src/cli/link.ts`; dispatch and help lines only in `main.ts`/`help.ts`)

```
pymtheg link requirement ID --title TITLE [--text TEXT] [--kind KIND]
pymtheg link add RECORD SELECTOR [--note TEXT]
pymtheg link remove LINK_ID            # UUID or unique 8+ char prefix
pymtheg link refresh LINK_ID
pymtheg link list [--record R] [--symbol SELECTOR] [--file PATH]
pymtheg link check [--allow-moved]
pymtheg link touched SELECTOR | --file PATH [--impact] [--depth 5]
pymtheg link unlinked [--symbols] [--limit 200]
pymtheg link history
  common: [--root DIRECTORY] [--json] [--no-sync]
```

`RECORD` is `R1`, `plan:R1` or an exact title. `SELECTOR` is passed to the
graph's own `symbol` command, so it accepts exactly what `pymtheg graph symbol`
accepts: name, scoped identity, `symbol:…` ID, `path:line[:column]`. An ambiguous
or unmatched selector lists the matches, creates nothing and exits 1.

- **Exit codes.** 0 success. 1 when `check` finds failing links, when `add`
  did not create or find a link (any status other than `created` or
  `already-linked`), or when `refresh` was refused. 3 usage or other error
  (with `--json`: `{schema, command, status:"error", exitCode, error:{code,
  message}}`; text: `Link error [code]: message` on stderr). 130 cancelled.
- **`--json`** prints the function's result object below, plus `command` and
  `exitCode`. The schema tag is `"pymtheg.code-links/v1"`.

`link requirement` is the smallest sound creation path. It calls
`StudioService.savePlanItem` headless, so the record goes through the same ID
uniqueness, integrity and checkpoint rules as Studio and is registered in the
recorded history.

## Exported functions for the MCP wrapper (`src/architecture/code-links.ts`)

All are `async`, return JSON-safe data, and write nothing to stdout/stderr. All
inputs extend `CodeLinkOptions = { root?: string; noSync?: boolean; signal?:
AbortSignal; writer?: HistoryWriter }`. `root` is any directory in the project
(default cwd). `writer` is for tests; production uses `.pymtheg/local/writer.json`.
**Codes.** Outcomes that are answers, not failures, are returned in `status`
(for `createCodeLink`: `created`, `already-linked`, `ambiguous-selector`,
`selector-not-found`, `record-not-found`, `record-ambiguous`, `failed-file`).
Failures throw `CodeLinkError` with `code`:

| `code` | When |
|---|---|
| `invalid-input` | Bad arguments (root not a directory, neither or both of symbol/file, bad limit); CLI usage errors |
| `link-not-found` / `link-ambiguous` | Link ID or prefix matches no active link, or several |
| `ambiguous-selector` / `selector-not-found` | `list --symbol` / `touched` selector does not select exactly one symbol |
| `record-conflict` | `createRequirement`: the record ID already exists (Studio's integrity rules) |
| `locked` | A database stayed locked by another writer beyond the bounded wait (below) |
| `graph-changed` | The graph changed between selection and fingerprinting; retry |

Other errors (e.g. a malformed selector reported by the graph) are plain `Error`,
and the CLI reports them with code `error`.

| Function | Input (beyond options) | Output |
|---|---|---|
| `createRequirement` | `{id, title, text?, kind?, owner?}` | `{schema, status:"created", record:{id,title,kind,document}, checkpoint}` |
| `createCodeLink` | `{record, selector, note?}` | `{schema, status: created\|already-linked\|ambiguous-selector\|selector-not-found\|record-not-found\|record-ambiguous\|failed-file, link: StoredCodeLink\|null, matches: SymbolSummary[], records:{id,title}[], graph: GraphSummary\|null, message}` |
| `removeCodeLink` | `{link}` | `{schema, status:"removed", link}` |
| `refreshCodeLink` | `{link}` | `{schema, status: refreshed\|unchanged\|refused, before: ResolvedCodeLink, link, message}` |
| `listCodeLinks` | `{record?, symbol?, file?}` | `{schema, links: ResolvedCodeLink[], counts:{ok,changed,moved,missing,unverifiable}, graph}` |
| `checkCodeLinks` | `{allowMoved?}` | list output + `{passed, allowMoved, failing: linkId[], orphaned: linkId[]}` |
| `requirementsFor` | `{symbol? \| file?, impact?, depth?}` | `{schema, touched: {record,title,link,symbol,state,via:"direct"\|"caller",distance}[], records: string[], impactIncomplete, impactNotes, notFollowed: {graphId,identity,path,line,certainty:"candidate"\|"possible"}[] (first 20), notFollowedCount, graph}` |
| `unlinkedWork` | `{symbols?, limit?}` | `{schema, requirements:{id,title}[], symbols: SymbolSummary[]\|null, symbolsTruncated, publicRule, graph}` |
| `codeLinkHistory` | — | `{schema, entries:{link, previous, sequence, time, author, change: added\|updated\|removed, record, symbol}[]}` |

`ResolvedCodeLink = {link, state, recordPresent, current: SymbolSummary|null,
differs, suggestions: SymbolSummary[], unverifiableFile: {path,reason}|null,
mayBeHiddenBy: string[], message}`.
`SymbolSummary = {graphId, language, path, kind, identity, name, line|null,
reason?}`. `GraphSummary = {complete, syncMode, failedFiles, staleFiles,
warnings}`. A suggested wrapper mapping is one MCP tool per row. Pass `root` from
the MCP project directory and the request's abort signal. Also exported:
`failsCheck(resolved, allowMoved?)`, `fingerprintText(text)`, `CodeLinkError`
and `codeLinkSchema`.

`test/code-links.test.mjs` calls every function above directly, as a wrapper
would.

## Queries

- `requirementsFor({symbol})` lists the records linked to the selected symbol.
  `{file}` lists the records linked to symbols currently in (or recorded in)
  that file. With `impact`, it also follows the graph's own `impact` traversal
  (depth-bounded) and keeps only `definite` callers. `impactIncomplete` is set
  when the traversal was bounded or when candidate/unresolved callers exist,
  because callers may then be missing. `notFollowed` names the callers it did
  not follow: candidate-set callers, and the sources of possible (unresolved)
  calls the graph reports at each frontier. The first 20 are listed, and
  `notFollowedCount` gives the total.
- `unlinkedWork()` lists requirement-kind records with no active code link.
  With `symbols: true` (opt-in, `limit` default 200) it also lists public
  symbols with no link. "Public" is a per-language rule, stated in the output:
  - Go: the name starts with an upper-case letter. Exported methods are
    included.
  - Rust: the recorded `visibility` starts with `pub`, so `pub(crate)` counts.
    `pub fn` in an `impl` is included.
  - TypeScript/JavaScript: the declaration text starts with `export`, plus the
    methods of an exported class in the same file whose text does not start
    with `private`, `protected` or `#`.

  Kinds counted: function, method, struct, interface, type, class, enum, trait,
  union. Fields, properties and getters/setters are not listed, and test files
  are skipped.

## Concurrent writers

`openDatabase` in `src/storage/local.ts`, the storage boundary, now gives every
project database a bounded SQLite busy timeout (`writerWaitMs` = 30 s) unless
the caller sets its own. This covers the planning store (link writes, and Studio's
and `createRequirement`'s checkpoint saves through the same `ArchitectureStore`
open), the graph store and Studio recovery. Before this, the planning store's
existing save path had the same gap. A lock held longer than the bound is
reported as `locked`, never waited on forever.

Tested with a readiness handshake. A holder process takes `BEGIN EXCLUSIVE` and
signals ready. Two `link add` processes start, and the lock is released only
after both have the locked database open (`/proc/<pid>/fd`; no sleeps, no time
assertions). Both succeed. Without the timeout, the test fails.

Observed separately: 8 parallel `link add` runs on an indexed project succeed
8/8 (three rounds).

## Graph use

No change to `src/graph/**`. Used read-only: `executeGraph` (`symbol` for
selection, `impact` for callers, `file` for file membership, and a `file` call on
a fixed probe path purely to run the standard sync and read failed/stale files),
`SqliteGraphStore` opened read-only inside `readCommandSnapshot`
(`findSymbols`, `namedSymbols`, `getSymbol`, `getFile`, `fileSnapshot`), and
`GraphLocations` for line hints.

## Evidence

- `test/code-links.test.mjs`. It builds a fresh initialised project with small
  Go, Rust and TypeScript sources, creates a requirement, and links a Go
  function, a Rust method and a TypeScript function → all `ok`. It then edits a
  body → `changed` (`differs: ["body"]`), checks that the check fails, refreshes
  (same ID), renames → `missing` with the renamed symbol as a suggestion, moves a
  file → `moved`, breaks Rust syntax → `unverifiable` naming `rs/src/lib.rs`,
  deletes `.pymtheg/rebuildable/` → same links and states. It runs the
  direct/impact/file queries and the unlinked query, removes a link and re-adds
  it (new UUID, `previous` set), and checks the history sequence. An ambiguous
  selector creates nothing. A second test drives the CLI (JSON and text, exit
  codes).
- Review-round tests, each confirmed to fail without its fix (old head, or the
  single fix reverted):
  - rename in place with a same-named symbol in another package → `missing`,
    with the renamed symbol and the pre-existing twin suggested; refresh refused;
    same text moved to another file while the linked file still exists →
    `missing`;
  - deleting the linked file while an identical twin exists elsewhere →
    `missing`, check fails;
  - a genuine move to another package → `moved`; `check` exits 1 until
    `--allow-moved` or a refresh; a different-text same-name symbol → `missing`;
  - a move when a twin pre-exists → `moved` while the twin stays put, `missing`
    with both suggested once the same-text twin also moves;
  - the fingerprint rule (CRLF and trailing spaces `ok`; a space inside a
    literal and re-indentation `changed`);
  - the concurrent-writer handshake;
  - public TypeScript class methods in `unlinked`;
  - error codes and `notFollowed`.
- `evidence/r1-d/restic-run.txt` (re-run in round 2 on a fresh copy):
  - three made-up requirements linked to three real restic symbols; check
    passes;
  - after a body edit, `changed`, exit 1;
  - `touched --impact` lists four candidate callers it did not follow;
  - the reviewers' case: `splitPath` (internal/filter) and `PruneOptions`
    (internal/repository) are renamed in place. Both are `missing`, with the
    renamed symbol suggested and the same-named `cmd/restic` symbol labelled
    "already existed when the link was made". `link refresh` is refused.

## Not done (known limits)

- **`.pym` declarations** cannot be linked. They are not architecture entities
  yet, and no requirement ↔ declaration link exists to build on. Links start
  from planning records only.
- **MCP tools** are not wired (R1-C owns `src/mcp/**`). The functions above are
  ready to wrap.
- **Studio** neither displays nor edits code links.
- **Archive bundle export/import** (`exportHistory`/`importHistory`, bundle v3)
  does not carry `code_links` rows. Receipts are in `exportRecordedHistory()`
  (hashes only). A link survives a graph rebuild, but not a planning-archive
  round trip.
- **Fingerprint** follows the exact rule above. Any edit inside the symbol's
  range is `changed`, including comments and reformatting. Doc comments outside
  the range (Go `//` above `func`) are not covered. The signature/body split is
  at the first `{`, so a `{` inside a Rust generic default or a TS type-literal
  parameter moves the split; that affects only which of `signature`/`body` is
  reported. Mega-plan 5.3's "behavioural edit flagged but comment edit not" is
  not met.
- **Moves need identical text, and the linked file gone.** A move combined with
  an edit, a move out of a file that still exists, and a Rust item moved to
  another module (its identity includes the module scope) are all `missing`
  with suggestions.
- **Concurrent first indexing.** Several processes indexing a project with no
  graph at once can fail inside the graph indexer (`UNIQUE constraint failed:
  graph_links.id`, `FOREIGN KEY constraint failed`: 1 to 3 of 8 in two runs).
  This is in `src/graph` (not changed here). Parallel `pymtheg graph index` has
  the same issue. Once the graph exists, concurrent link writers succeed.
- **Several same-identity symbols in one file** (Go `init`, TS overloads) are
  matched by recorded ordinal. Reordering them can report the wrong sibling as
  `changed`.
- `createRequirement` uses the local writer identity (the Studio path), not an
  injected `writer`.
- The history view shows each link's latest body. Receipts for intermediate
  refreshes hold hashes only.
- Each call syncs the graph (an inventory hash of the project). `touched`
  without `--no-sync` makes several graph calls (one sync, the others with
  `noSync`). There is no cross-call cache.
- "Public symbol" is the per-language rule above. It is a heuristic: Rust
  `pub(crate)` counts as public; methods of classes exported only through a
  separate `export { Repo }` statement are not listed.
- Duplicate-link prevention is per key: the same record, and the same symbol
  as first linked. After a move, linking the same record to the symbol's new
  location again is refused only if the graph ID is unchanged.
