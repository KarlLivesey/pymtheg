# W1-C: graph storage and language-module author guide

This is the contract for mega-plan 4.0/4.1. All code is under `src/graph/` and
exports through `index.ts` (`dist/graph/index.js` after compilation). It does not
wire commands, choose a project database layout, implement production languages,
watch files, join requirements or implement Stage 7 output. Existing observation
code is untouched. The fixture language is marked `testOnly` and is excluded from
production discovery. Graph conformance alone is not a full language-support
claim: Stage 7 contract and behaviour output remain separate requirements.

## Adding a language: complete recipe

1. Add one folder `src/graph/languages/<name>/`. Default-export a `LanguageModule`
   from `index.ts`. Core contains no language-name list or language switch. Keep
   grammar integration, compiler integration, resolution, fixtures and tests in
   that folder. No core registration edit is necessary.
2. Supply a unique stable lowercase `id` and nonempty `version`. Bump version
   when parser, analysis, resolution, claims or context semantics change. Versions
   invalidate file caches but do not enter symbol IDs.
3. Declare file claims (`extensions`, `filenames`, `patterns`) and, separately,
   `contextFiles` required for project analysis or resolution. See claims below.
4. Implement `parse`, `analyze`, or both. Simple languages parse each changed file.
   Compiler-backed languages can implement only `analyze`, constructing one
   compiler program over the supplied complete snapshot. Never read project
   files from disk inside a module, execute project code or silently ignore a
   requested analysis failure.
5. Emit a `SymbolDraft` for each declaration, with a file-local `key`, display
   `name`, `kind`, position-independent scoped `identity` and exact UTF-16 `range`.
   Use container-qualified identities for methods and nested declarations.
6. Emit every observed `LinkDraft`, even when its target is unknown. Its
   `sourceKey` refers to a symbol in the same file, or is null for file-level
   relationships. Preserve `targetName`, `kind`, `range` and useful resolution
   facts in optional JSON `data` on symbols, links or the entire result.
7. Implement optional `resolve` over identified graph facts (and any compiler
   state explicitly reconstructed by this invocation's `analyze`). Return only
   definite target IDs or explicit candidate sets. It may also add derived links.
   Never guess a candidate or drop an unsupported reference.
8. Call `checkLanguageConformance` with fixtures and exact symbol/link position
   expectations, including Unicode-before-declaration and unresolved controls.
   Add language-specific tests for scope, imports, overloads and ambiguity.
9. Compile with `npm run build:core`. `discoverLanguages()` finds the new compiled
   folder relative to its own module URL, independent of the process directory.
   A test inside the language folder can import its compiled module and kit and
   run via `node --test src/graph/languages/<name>/*.test.mjs`; no central list is
   needed. The existing default npm test glob covers top-level `test/*.test.mjs`.

Grammar packages must already be installed through the separately owned
dependency process. Use package-resolved WASM/query assets for now. **Backlog
only (Part B): copying grammar WASM/assets from a language source folder into
`dist` requires a separate build change; this PR does not implement it.**

## Claims and discovery

`extensions` includes dots and is case-sensitive (for example `.ts`).
`filenames` matches exact basenames. `patterns` accepts `*` (within a path
segment), `?` (one non-slash character), and `**` (across path segments);
`**/` may match zero directories. A pattern with a slash matches the full
project-relative path; otherwise it matches basenames anywhere in the project.
Thus `*.d.ts` and `tsconfig.*.json` need not claim every `.ts` or `.json` file.
Absolute paths, parent/dot/empty segments and backslashes are rejected.

A module can optionally `accepts(path)` to decline a matching path. This
path-only predicate must be deterministic. Selection first removes declined
modules, then chooses exact basename over pattern over extension. Within a tier,
the match with the greatest number of literal UTF-16 code units wins (extension
length for extensions). An equal remaining specificity across modules produces
a located claim error for that file; other files continue. Registration order
and language IDs do not break ties. No winner is selected silently.

`contextFiles` uses the same glob rules but is independent of ownership claims.
Several modules can need the same config; it is captured once per invocation.
A context-only path is not counted as unclaimed. Configs can also be claimed as
source if a module intentionally wants graph facts for them.

Each immediate language folder exports its default module object. Invalid or
missing exports fail discovery visibly. Production discovery skips objects with
`testOnly: true`. Tests opt in with
`discoverLanguages(undefined, {includeTestOnly: true})`, or explicitly construct
`new LanguageRegistry([fixtureModule])`. No core file names the fixture language.
An alternative directory URL is accepted as the first discovery argument.

## Parsing and the explicit project phase

`parse({path, text})` returns a `ParseResult` synchronously or asynchronously.
It receives exact captured UTF-8 source decoded without replacement. Results have
`status: 'clean' | 'partial' | 'failed'`, diagnostics, symbols, links and optional
JSON data. Partial/failed results require diagnostics. Recovered symbols and
links may remain with their incomplete status. Thrown parsers and malformed
facts become failed records, not clean empty graphs.

All ranges are **half-open JavaScript UTF-16 code-unit offsets**, including
non-BMP characters: `0 <= start <= end <= text.length`. They are never UTF-8 byte
offsets or code-point counts. Use `text.slice(start, end)` to inspect a range.
Paths are project-relative POSIX paths. Metadata must survive JSON persistence;
retain plain facts rather than compiler objects, Tree-sitter nodes or cycles.

`analyze(context)` is an explicit whole-program phase. It receives:

- `projectId` and `files`: all this module's captured `GraphFile` records, each
  with exact text/hash, module/version and last canonical file facts. This
  includes every unchanged file and all files loaded from a reopened database.
- `contextFiles`: every existing snapshot path matching that module's declared
  patterns, with text, original-byte hash, clean/failed capture status and
  diagnostics. Missing configs are absent, never read implicitly from disk.
- `changedFiles`: changed/added/deleted source paths for this module (including
  version invalidation), and `changedContextFiles`: changed/added/deleted context
  paths. Both are hints; empty lists never imply native compiler state exists.

It returns `AnalyzedFile[]`, each `{path, result}`. These results are authoritative
replacements of that file's canonical facts, not additive patches. An
analyze-only module must return every readable file; a module also implementing
parse may return just the files it needs to replace. Preserve needed per-file
metadata in returned results. Returning foreign/duplicate files is an error.

**Cold-start rule:** analyze runs on every index invocation, even if every file
hash matches and no parse ran. Native AST/program/checker state is never persisted
or assumed to survive reopening. An analyze-only compiler module can construct
`ts.createProgram` once from all captured texts with a snapshot-only host, then
use its checker to emit declarations and reference facts. It does not need a
per-file parse implementation. If both phases are used, avoid independently
reparsing per analysis: build and reuse one program in this explicit phase.

**Invalidation rule:** a context-file addition, content change or removal always
appears in `changedContextFiles`; analysis and resolution run with the complete
new snapshot even when no source changed. A module can recompute all results.
There is no disk fallback for missing configs. Failed context capture prevents
that module's project analysis/resolution and is reported. Project analysis
errors produce failed file facts and explicit `analysisErrors`; unsupported or
missing context cannot leave a stale clean success. Unreadable/non-UTF-8 source
cannot be turned into a clean analysis result.

The executable compiler fixture in `test/graph-review.test.mjs` uses the real
TypeScript compiler with a completely virtual host: `api.ts` -> barrel export ->
config path alias -> `main.ts` call. It proves resolution after cold reopening
with zero file reparses and retargeting after only `tsconfig.json` changes.
No production TypeScript module is registered by that test.

## Scoped symbol IDs

Symbol ID version 2 is:

```text
symbol: + SHA256(JSON.stringify([
  'v2', projectId, moduleId, relativePath, kind, identity, ordinal
]))
```

The module supplies `identity`: examples are `(*B).String`, `impl B::new`, or
`Class.method`. It must encode semantic scope/container, not a byte offset,
line number, local key or source hash. A flat language may use its declared name.
Display `name` can be short; identity carries the qualification. Rename changes
identity and therefore ID; changing display spelling alone without changing the
supplied identity intentionally preserves ID, so modules must maintain that
identity contract.

The core assigns a zero-based ordinal within `(kind, identity)` groups **in
source order**, independently of array emission order. Source start, then end,
then locale-independent local key order breaks exact source-location ties.
Ordinals separate genuinely repeated declarations, such as two Go `init`
functions. Duplicate query captures should instead be filtered by the module.

Edits/comments/imports above a declaration, changed start/end offsets, changed
bodies, local-key changes, module-version changes and reordering declarations
with different scoped identities preserve IDs. Renaming/reparenting the scoped
identity, moving to another file, changing kind/module or changing project
namespace changes ID. Reordering two same-kind, same-identity declarations makes
IDs follow their ordinal slots: the declarations exchange IDs. Inserting or
removing a repeated identity shifts later ordinals in that group. This limitation
is explicit; no claim of semantic move tracking among indistinguishable repeated
identities is made. Methods named `f` on `A` and `B` have different identities and
both use ordinal zero.

The project namespace is a persisted UUID by default. Supply the same project ID
when rebuilding the same project elsewhere; distinct project namespaces have
distinct symbols. Parsed link IDs still hash project/module/file/link-array index
and are deterministic for unchanged facts, not stable across inserted links.
Derived-link IDs hash project/module/file/`analysis`/module-supplied link key.
Schema version 2 intentionally refuses an old v1 database with a rebuild message;
this graph was not frozen or joined to shared requirements yet.

## Resolution, added relationships and candidates

`resolve` receives all captured graph files, this module's declared context files,
all identified symbols and only this module's **parsed** links. Parsed links are
presented unresolved on every invocation. Derived links are reconstructed, never
fed back recursively. It can return a `LinkResolution[]` shorthand or:

```ts
{
  resolutions: [
    { linkId, targetId },                    // definite
    { linkId: other, candidateIds: [a, b] }, // possible targets, never a guess
    { linkId: third, targetId: null },       // explicitly unresolved
  ],
  links: [{
    key: 'implicit-satisfaction', file, sourceId, kind: 'implements',
    targetName, range, targetId,
  }],
}
```

Added links use a stable per-file key and global source ID (or null). They can
have `candidateIds` instead of `targetId`, or neither for unresolved links. Their
source must belong to the stated file/module. Their ranges obey the same rules
as parsed links. Core validates the entire output before writing it. Duplicate,
unknown or foreign parsed-link decisions and invalid target IDs fail the module's
resolution. Omitted links remain unresolved. An exception discards that module's
old derived links and target decisions, records `resolutionErrors`, and retains
its parsed unresolved references. Storage exceptions propagate separately.

Kinds are open strings; use `calls`, `imports`, `contains`, `implements` and
`references` for those relationships. Graph links retain `targetName`, range,
`origin: 'parse' | 'analysis'` and a resolution state:

- `resolved`: a definite `targetId`, `targetStatus`, no candidates.
- `ambiguous`: null definite target and `candidates: [{id, status}, ...]`.
  Input needs at least two distinct candidates; IDs are sorted deterministically.
- `unresolved`: null target, empty candidates, original target name retained.

Removing one candidate does **not** turn the survivor into a definite target;
it remains ambiguous (possibly with one candidate) until a module explicitly
recomputes a definite result. Losing all candidates becomes unresolved.
`incoming` includes possible candidate mentions, clearly marked ambiguous.
Neighbourhood traversal includes candidate endpoints as **possible** neighbours;
its returned links preserve ambiguity and must not be treated as proven paths.
`unresolved()` returns wholly unresolved links; `ambiguous()` is separate.

Partial files remain flagged partial, but their successfully extracted symbols
are legal targets. `GraphSymbol.status`, `GraphLink.sourceStatus`,
`GraphLink.targetStatus` and each candidate's status expose this qualification
on query results. A resolved target in a partial file proves only that particular
relationship, never complete file coverage. Failed-file symbols are not legal
targets. Consumers must inspect statuses before claiming complete analysis.

## Store, indexing and failure boundaries

`GraphStorage` is backend-neutral: methods return `StorageResult<T>`
(`T | Promise<T>`); indexer operations await them all. `SqliteGraphStore` has a
synchronous concrete API, using Node 24 `node:sqlite`, foreign keys and
transactions. Construct with `(databasePath, projectId?)`, close in `finally`.
The caller chooses the path and creates its parent; this chunk chooses no layout.
`contexts()`/`replaceContexts()` persist captured project context; `files()` and
`getFile()` expose exact source, canonical facts and diagnostics.

Per-file replacement is atomic. Surviving symbols preserve incoming links;
removed symbols invalidate definite targets and candidate membership without
losing reference names. `replaceAnalysis(module, result)` atomically replaces
that module's derived links and target decisions. `resolveLinks()` is a direct
all-link target replacement API. Invalid results leave old facts intact;
unchanged successful runs leave database bytes unchanged.

Queries: exact-match `findSymbols({name?, kind?, file?})`, `outgoing(id, kind?)`,
`incoming(id, kind?)`, `links()`, `unresolved()`, `ambiguous()` and bidirectional
`neighbourhood(id, depth, kind?)` (depth 0–100). Unknown symbols have an empty
neighbourhood. Results use locale-independent ordering; no `localeCompare`
affects identities, ordinal assignment, walking, registration or reports.

`indexProject(root, registry, store, options?)` inventories before replacing
anything and reads storage outside source/module failure catches. In particular,
a `getFile` failure propagates before writes and cannot replace valid source
facts with an invented parser failure. All storage calls propagate backend
failures; `errors`, `analysisErrors` and `resolutionErrors` describe source/module
failures, not swallowed database failures.

The walker skips `.git`, `node_modules` and `.codegraph` directories and does not
follow discovered symlinks. It merges explicit `excludeDirectories` and exact
`excludeFiles` options. Keep the database outside root or explicitly exclude its
files/journals. One store represents the supplied inventory scope: narrowing the
root or exclusions removes out-of-scope records. Traversal failure throws before
writes. There is no concurrent-writer coordinator or whole-project transaction.

Hashes cover original file bytes. Strict UTF-8 decoding rejects invalid bytes,
records failed source/context diagnostics and reports the path; replacement
characters are never silently indexed as clean. Unclaimed paths are reported,
not represented as successful empty parses. Files matching hash/module/version
skip per-file parsing/replacement unless their last result failed. Partials can
be cached with diagnostics; failed parses are retried. Project analysis and
resolution still run as specified above.

Reports include `discovered`, `claimed`, `indexed`, `unchanged`, `removed`,
`analyzed` (project-phase file results), `contextFiles`, graph symbol/link counts,
`unresolved`, `ambiguous`, plus `unclaimed`, `failed`, `partial` path lists and
corresponding `*Count` fields. `indexed` counts source capture/parse replacements;
a context-only edit may reanalyze/replace canonical facts while indexed is zero.
Inspect all three error arrays and incomplete counts; an empty parser-error list
alone is not a clean verdict. Timings are never correctness criteria.

## Optional Tree-sitter helper

`tagsFromPackage(packageName, wasmName, queryPath?)` resolves installed package
assets; query defaults to `queries/tags.scm`. `createTagsParser(options)` loads
the WASM runtime/grammar and compiles the full tags query. It returns reusable
`parse(text)` and idempotent `dispose()`; dispose in `finally`. Temporary trees
are freed even when callbacks throw. Loading/query failures throw visibly.

Default mapping pairs each `@name` with `@definition.<kind>` in its query match.
It uses the definition span, name text, and a flat default identity equal to name.
`mapDefinition(match, symbol)` can qualify identity, add scope data, change kinds,
or return undefined to filter duplicates. Language modules must supply proper
scoped identities for nested/member symbols. Rust's bundled query can capture
both method and function for `new`; Rust's module selects the desired capture,
not the core. Tests prove this filtering with the installed Rust grammar.

`@reference.*` captures are exposed with kind, name, range, live node and match:
`mapReference(reference, symbols)` may turn each into a `LinkDraft`.
`secondPass({tree, matches, references, result})` receives the entire live tree,
all query matches and references plus mutable plain result facts. It can walk
nodes to recover containers/imports, derive scope-qualified identities, add links
or filter symbols. Both callbacks are synchronous and borrowed: **never retain
a tree, node or match beyond the callback**. Persist JSON facts instead.
Syntax error/missing nodes leave the file partial; callbacks cannot clear that
syntax flag into clean. Successful definitions remain usable with partial
provenance. The helper does not interpret doc directives or invent resolution.

## Conformance and validation

`checkLanguageConformance(module, fixtures, expected)` creates a unique temp
project/database and removes it in `finally`. Fixtures are `{path, text, status?}`
(default status clean); `{context: true}` marks declared context-only fixtures.
Expected symbols include file/name/kind/identity. Expected links include file,
kind, targetName, source selector, target selector (or null), and optional
candidate selectors (compared as a set, independent of array order). **Every symbol and link must supply `at` exact source text
and/or an explicit `range`.** The kit compares these with the actual captured
`text.slice(start, end)` and exact offsets. Use explicit ranges where the same
text occurs more than once. Nonempty expected definition/reference text rejects
zero-width and off-by-one captures, not just out-of-bounds positions.

Include an unresolved link control and Unicode before a declaration. The kit
also checks claims, deterministic parsing, exact graph facts, incomplete status,
unresolved retention, hash skipping, forced replacement ID stability and
resolution determinism. Self-tests prove zero, off-by-one and UTF-8-byte-offset
variants fail despite in-bounds spans. Compiler-only modules can use the same kit.

Run `npm run build:core`, then `node --test test/graph*.test.mjs`. The review
regressions additionally cover the snapshot compiler case, comment insertion,
repeated identities, equal method names on different containers, storage fault
injection, candidate persistence/invalidation, derived links, claim specificity,
invalid UTF-8, partial Tree-sitter targets, locale independence and production
fixture exclusion. Required final install/test/format commands run sequentially;
results and prior historical evidence are preserved under `evidence/w1-c/`.
