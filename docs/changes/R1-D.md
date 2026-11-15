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
  created, refreshed: string|null, note, removed }
```

`identity`, `kind` and `ordinal` are the graph's position-independent symbol
identity (`src/graph/identity.ts`: the graph ID digests `module, file, kind,
identity, ordinal`). The path is project-relative POSIX, taken from the graph.
The fingerprint is computed from the symbol's source range in the graph's stored
snapshot, with whitespace runs collapsed. `signature` covers the text before the
first `{`. `body` covers the text from the first `{` onwards.

### States (computed on demand; the graph is synced first, as `pymtheg graph` does)

| State | Meaning |
|---|---|
| `ok` | Same language, kind and identity at the recorded path; fingerprint equal |
| `changed` | Found at the recorded path; `differs` lists `signature` and/or `body` |
| `moved` | Not at the recorded path. Exactly one symbol with the same language, kind and identity elsewhere, and **no** failed or partial file that could hide another. `differs` starts with `path` and may add `signature`/`body` |
| `missing` | Not found, or the move is ambiguous. `suggestions` lists same-identity symbols elsewhere and same-kind symbols with an identical body in the linked file (a rename). `mayBeHiddenBy` names failed files of that language. Suggestions are never applied |
| `unverifiable` | The recorded file failed to parse (or parsed partially and the symbol is absent). `unverifiableFile` names it, with the reason |

A link is never dropped or retargeted by resolution. `refreshCodeLink` (an
explicit request, after review) re-records the current symbol for a `changed` or
`moved` link and keeps its ID. It refuses `missing` and `unverifiable` links:
remove them and link again. `checkCodeLinks` fails on `missing`, `changed`,
`unverifiable`, and on `moved` whose content also differs. A plain move is
reported but passes. A link whose planning record no longer exists is reported
(`recordPresent: false`, `orphaned`), not dropped.

Creating a link refuses a symbol in a file that did not parse cleanly. This
follows the decision "Unreadable code is failed".

### CLI (`src/cli/link.ts`; dispatch and help lines only in `main.ts`/`help.ts`)

```
pymtheg link requirement ID --title TITLE [--text TEXT] [--kind KIND]
pymtheg link add RECORD SELECTOR [--note TEXT]
pymtheg link remove LINK_ID            # UUID or unique 8+ char prefix
pymtheg link refresh LINK_ID
pymtheg link list [--record R] [--symbol SELECTOR] [--file PATH]
pymtheg link check
pymtheg link touched SELECTOR | --file PATH [--impact] [--depth 5]
pymtheg link unlinked [--symbols] [--limit 200]
pymtheg link history
  common: [--root DIRECTORY] [--json] [--no-sync]
```

`RECORD` is `R1`, `plan:R1` or an exact title. `SELECTOR` is passed to the
graph's own `symbol` command, so it accepts exactly what `pymtheg graph symbol`
accepts: name, scoped identity, `symbol:…` ID, `path:line[:column]`. An ambiguous
or unmatched selector lists the matches, creates nothing and exits 1.

- **Exit codes.** 0 success. 1 when `check` finds failing links, when `add` was
  ambiguous, not found, refused (unreadable file) or had an unknown record, or
  when `refresh` was refused. 3 usage or other error (with `--json`:
  `{schema, command, status:"error", exitCode, error:{message}}`). 130
  cancelled.
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
They throw `Error` (with a message for the agent) on invalid input: an unknown
link ID, a malformed selector, a selector for `list --symbol`/`touched` that
selects other than exactly one symbol.

| Function | Input (beyond options) | Output |
|---|---|---|
| `createRequirement` | `{id, title, text?, kind?, owner?}` | `{schema, status:"created", record:{id,title,kind,document}, checkpoint}` |
| `createCodeLink` | `{record, selector, note?}` | `{schema, status: created\|exists\|ambiguous\|not-found\|record-not-found\|record-ambiguous\|unreadable, link: StoredCodeLink\|null, matches: SymbolSummary[], records:{id,title}[], graph: GraphSummary\|null, message}` |
| `removeCodeLink` | `{link}` | `{schema, status:"removed", link}` |
| `refreshCodeLink` | `{link}` | `{schema, status: refreshed\|unchanged\|refused, before: ResolvedCodeLink, link, message}` |
| `listCodeLinks` | `{record?, symbol?, file?}` | `{schema, links: ResolvedCodeLink[], counts:{ok,changed,moved,missing,unverifiable}, graph}` |
| `checkCodeLinks` | — | list output + `{passed, failing: linkId[], orphaned: linkId[]}` |
| `requirementsFor` | `{symbol? \| file?, impact?, depth?}` | `{schema, touched: {record,title,link,symbol,state,via:"direct"\|"caller",distance}[], records: string[], impactIncomplete, impactNotes, graph}` |
| `unlinkedWork` | `{symbols?, limit?}` | `{schema, requirements:{id,title}[], symbols: SymbolSummary[]\|null, symbolsTruncated, publicRule, graph}` |
| `codeLinkHistory` | — | `{schema, entries:{link, previous, sequence, time, author, change: added\|updated\|removed, record, symbol}[]}` |

`ResolvedCodeLink = {link, state, recordPresent, current: SymbolSummary|null,
differs, suggestions: SymbolSummary[], unverifiableFile: {path,reason}|null,
mayBeHiddenBy: string[], message}`.
`SymbolSummary = {graphId, language, path, kind, identity, name, line|null,
reason?}`. `GraphSummary = {complete, syncMode, failedFiles, staleFiles,
warnings}`. A suggested wrapper mapping is one MCP tool per row. Pass `root` from
the MCP project directory and the request's abort signal. Also exported:
`failsCheck(resolved)`, `fingerprintText(text)` and `codeLinkSchema`.

`test/code-links.test.mjs` calls every function above directly, as a wrapper
would.

## Queries

- `requirementsFor({symbol})` lists the records linked to the selected symbol.
  `{file}` lists the records linked to symbols currently in (or recorded in)
  that file. With `impact`, it also follows the graph's own `impact` traversal
  (depth-bounded) and keeps only `definite` callers. `impactIncomplete` is set
  when the traversal was bounded or when candidate/unresolved callers exist,
  because callers may then be missing.
- `unlinkedWork()` lists requirement-kind records with no active code link.
  With `symbols: true` (opt-in, `limit` default 200) it also lists public
  symbols with no link. "Public" is a per-language rule, stated in the output:
  Go upper-case name; Rust recorded `visibility` starting with `pub`;
  TypeScript/JavaScript declaration text starting with `export`. Kinds counted:
  function, method, struct, interface, type, class, enum, trait, union. Test
  files are skipped.

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
- `evidence/r1-d/restic-run.txt`: three made-up requirements linked to three
  real restic symbols, check, one edit, check again.

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
- **Fingerprint** = whitespace-normalised source text. A comment edit inside the
  symbol's range, or a whitespace change inside a string literal, still shows as
  `changed`. Doc comments outside the range (Go `//` above `func`) do not. The
  signature/body split is the first `{`, so a `{` inside a Rust generic default
  or a TS type-literal parameter moves the split. Mega-plan 5.3's "behavioural
  edit flagged but comment edit not" is not met.
- **Moves that change identity are `missing`.** For example, a Rust item moved
  to another module (its identity includes the module scope) is reported
  `missing` with suggestions, never `moved`. Go and TypeScript identities do not
  include the file.
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
- "Public symbol" is the per-language heuristic above. TypeScript class members
  of exported classes and Rust `pub(crate)` both count as public.
- Duplicate-link prevention is per key: the same record, and the same symbol
  as first linked. After a move, linking the same record to the symbol's new
  location again is refused only if the graph ID is unchanged.
