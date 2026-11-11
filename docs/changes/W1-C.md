# W1-C: code graph foundations and language author guide

This chunk implements mega-plan 4.0/4.1's graph foundations, independently of
`src/implementation/`. It adds no CLI, MCP or Studio entry point, real language
module, watcher, project layout or requirement join. The toy language is a test
instrument, not a supported production language. Passing this graph conformance
kit does not claim the Stage 7 contract/behaviour-output requirements are built.
The support/decision ledger consolidation can incorporate this fragment after
review; their shared files are deliberately untouched.

## Public boundary

Import from `src/graph/index.ts` (compiled as `dist/graph/index.js`). The precise
interfaces are in `types.ts`. Everything specific to a language belongs under
`src/graph/languages/<name>/`; the default export of `index.ts` is a
`LanguageModule`. `discoverLanguages()` enumerates immediate compiled module
folders and imports each `index.js`. There is no core list of language names.
A module folder can contain its own assets, templates, tests and fixtures.
Non-TypeScript assets must be explicitly located by the module (for example via
`createRequire(import.meta.url).resolve` for grammar package assets); `tsc` does
not copy arbitrary assets. Discovery also accepts a directory URL for testing or
alternative module collections. Missing/invalid modules fail discovery visibly.

A module supplies:

- `id`: stable unique lowercase identifier, matching `[a-z][a-z0-9-]*`.
- `version`: nonempty parser/resolver revision. Bump it when facts or resolution
  semantics change. Versions invalidate cached parses but are excluded from IDs.
- `extensions`: case-sensitive extensions including the dot; `filenames` can
  additionally claim exact basenames, including configuration files if required.
  At least one claim is required. Duplicate module IDs fail registration;
  overlapping claims fail for that file rather than choosing a winner.
- `parse({path, text})`: sync or async `ParseResult`, with `status`, diagnostics,
  symbols, links and optional JSON `data`. Parsing consumes supplied text and
  must not execute project code. Do not reread sources from disk.
- `resolve({files, symbols, links})`: sync or async definite resolutions, each
  `{linkId, targetId}`. `files` contains the entire captured project, including
  unchanged source text, statuses and saved module metadata. `symbols` contains
  globally identified symbols. `links` contains this module's links only,
  presented unresolved on every invocation. Return only definite targets.

`SymbolDraft` has a file-local `key`, `name`, open-vocabulary `kind`, `range` and
optional JSON `data`. Keys must be nonempty and unique within a file; a link's
`sourceKey` refers to one of them, or is `null` for a file-level link. No parser
knows a persistent symbol ID. Optional metadata on symbols, links and files can
hold scopes, qualified names, import paths, visibility, receiver facts and other
language-specific resolution inputs. Persist serializable facts instead of
native parser objects. The resolver works from those facts and the captured
snapshot; it must not reread or independently reparse sources for analyses.

Positions are **half-open UTF-16 offsets**, `0 <= start <= end <= text.length`,
relative to that file's exact stored text. File paths are project-relative POSIX
paths with no empty, dot or parent segments; no absolute host paths enter IDs.
A parse result is `clean`, `partial` or `failed`. Incomplete statuses require at
least one diagnostic; any recovered symbols and links remain available together
with that status. Thrown parsers or invalid facts become recorded failed files
with diagnostics, never clean empty graphs. Every consumer must inspect the
origin file's status before making a coverage claim.

## IDs and storage

`GraphStorage` is the backend-neutral storage boundary. Its methods return
`StorageResult<T>` (`T | Promise<T>`), and the indexer awaits every operation, so
a remote backend can substitute without changing indexing code. Callers using
that interface should await queries and close as well. `SqliteGraphStore` is the
Node 24 `node:sqlite` implementation, with a synchronous concrete API, foreign
keys and transactions.
Construct it with `new SqliteGraphStore(databasePath, projectId?)` and close it in
`finally`. The caller chooses the path and creates its parent directory. There
is no assumed project storage layout. The project ID defaults to a generated,
persisted UUID; supplying a different project ID when reopening is an error.
Preserve that project namespace when copying a database or rebuilding the same
project on another machine. A different project namespace gives different IDs.
This index is rebuildable current-state data, not author/time revision history.

Symbol ID version 1 is:

```text
symbol: + SHA256(JSON.stringify([
  "v1", projectId, moduleId, relativePath, kind, name, range.start
]))
```

The local key, content hash, module version and range end are excluded. Replacing
a file, changing a body/end offset, or changing a parser's local keys therefore
preserves an unmoved, unrenamed symbol's ID. Moving its start, renaming it,
changing its kind/module/path or changing project namespace produces a new ID.
This is positional identity, not rename/move tracking. Two declarations cannot
share kind/name/start in one file; overloads at different starts are distinct.
Link IDs hash `['v1', projectId, moduleId, path, linkArrayIndex]` with a `link:`
prefix. They are deterministic for unchanged parse output; stability across
insertions/reordering is promised only for symbols, not link IDs.

`replaceFile` atomically replaces one file's facts. Surviving symbol IDs preserve
incoming references; removed symbols and incomplete target files invalidate
incoming targets while keeping the link's original `targetName`. `removeFile`
cascades its own facts and similarly leaves incoming links unresolved. The
indexer then refreshes cross-file resolution using the full captured project.

Link kinds are open strings. Use `calls`, `imports`, `contains`, `implements`,
and `references` for those relationships; language-specific kinds need no core
edit. `GraphLink` always retains its target name and range. A resolved link has
`targetId` and `resolution: 'resolved'`; otherwise it has `targetId: null` and
`resolution: 'unresolved'`. Ambiguous/dynamic/unsupported links are omitted from
the resolver's answers, **not** from the parser's links. Never choose a candidate
just because its name matches. Core rejects unknown, duplicate, foreign-module
link resolutions and targets from incomplete files. Resolver failure leaves all
that module's links unresolved and appears in `resolutionErrors`.

Queries are exact-match `findSymbols({name?, kind?, file?})`, `outgoing(id, kind?)`,
`incoming(id, kind?)`, `unresolved()`, and `neighbourhood(id, depth, kind?)`.
Neighbourhood is bidirectional breadth-first traversal, depth 0 through 100;
it includes unresolved links incident to an expanded symbol but cannot traverse
their unknown target. File-level links with null source are accessible through
`links()` and through a definite target's incoming links. Results have stable ID
ordering. `files()`/`getFile()` provide source/status/diagnostic provenance.
`resolveLinks()` atomically validates and replaces the current definite targets;
an unchanged resolution set causes no SQLite writes.

## Indexing

```ts
const registry = await discoverLanguages();
const store = new SqliteGraphStore(databasePath);
try {
  const report = await indexProject(root, registry, store, {
    excludeDirectories: ["generated"],
    excludeFiles: ["caller-chosen-index.sqlite"],
  });
} finally {
  store.close();
}
```

An invocation inventories the entire supplied root. It skips `.git`,
`node_modules` and `.codegraph` directories and reports discovered symlinks
without following them. Explicit exclusions are additive. Keep the database
outside the root, or exclude its database/journal files explicitly. Reusing the
same store with a narrower root or exclusions removes records outside that
inventory: one store represents one caller-selected project scope. A traversal
failure throws before replacing files; a storage failure throws rather than
claiming completion. This is not a concurrent-writer coordinator or a watcher.

The indexer hashes text with SHA-256. A matching file hash/module/version avoids
parsing and replacing that file. Partial results can be cached with their status;
failed files are retried. Files no module claims appear in `unclaimed`; parser
failures in `failed`, recovered parses in `partial`, with corresponding numeric
`unclaimedCount`, `failedCount`, `partialCount`. `indexed`, `unchanged`, `removed`,
`discovered`, `claimed`, `symbols`, `links`, `unresolved` provide operation/current
graph counts. `errors` records claim/read/parser failures, and `resolutionErrors`
records resolver failures. An empty `errors` array alone is not a clean verdict:
inspect partial/failed counts and resolution errors as well. Unclaimed files are
reported each run, not stored as successful parses.

Resolvers run on every invocation, including unchanged inputs, so transient
resolver failures are retried. Unchanged successful runs do no parse/replacement
work or database writes. Changes to any file can change other files' resolution
without reparsing those files. Modules must resolve deterministically and must
not mutate their context. No speed threshold decides correctness.

## Optional Tree-sitter helper

```ts
const tags = await createTagsParser(
  await tagsFromPackage("tree-sitter-go", "tree-sitter-go.wasm"),
);
try {
  const result = tags.parse(sourceText);
} finally {
  tags.dispose();
}
```

This is a helper example, **not a registered Go module**. `tagsFromPackage`
resolves the package's WASM and reads `queries/tags.scm` (an alternate query path
is accepted). `createTagsParser({wasmPath, query, mapDefinition?})` initializes the
shared WASM runtime, loads the grammar and compiles the query. `parse` pairs
`@name` with `@definition.<kind>` captures within each query match. The default
symbol uses the definition's span and the name node's text; duplicate keys are
suppressed. `mapDefinition(match, defaultSymbol)` can add scope metadata, map
kinds or return `undefined` to exclude a capture. Tree/query nodes are borrowed
only during mapping; retain plain facts, not live nodes. The parser/query are
reusable until `dispose()`, which is idempotent; every temporary tree is freed in
`finally`. Syntax recovery returns `partial` and a diagnostic. Loading/query
errors throw. The helper emits definitions only; each language owns reference
extraction and resolution. Go's doc directives are not doc transformations here.
A TypeScript/compiler-backed module need not import this helper at all.

## Conformance kit and adding a language

`checkLanguageConformance(module, fixtures, expected)` is exported from
`graph/conformance.ts` and the barrel. Fixtures are `{path, text, status?}` (status
defaults to `clean`). Expected symbols are exact `{file, name, kind}` arrays;
expected links are exact `{file, kind, targetName, source, target}` arrays.
`source` is `{name, kind}` or null; `target` is `{file, name, kind}` or null.
Include at least one unresolved control (`target: null`). The kit validates
claims and positions, deterministic parses, exact symbol/link/source/target
results, unresolved retention, unchanged re-indexing, forced per-file replacement
ID stability and deterministic resolution. Each call creates a unique temp
project/database and removes both in `finally`. Failures throw assertions.
The executable invocation is in `test/graph.test.mjs` under “toy passes the
reusable language conformance kit”. Run it with:

```sh
npm run build:core
node --test test/graph*.test.mjs
```

To add a graph language without editing core:

1. Create **only** `src/graph/languages/<name>/` and export a `LanguageModule` as
   the default from its `index.ts`. Use the toy folder as the minimal template.
2. Define its claims and stable ID/version. Keep configuration rules, grammar or
   compiler integration and all resolution rules in that folder.
3. Parse supplied text into local keys, UTF-16 spans, explicit statuses and
   serializable scope/import/reference facts. Preserve every unresolved edge.
4. Resolve cross-file relationships from captured facts, returning only definite
   symbol IDs. Handle overloads, visibility and ambiguity explicitly.
5. Put fixtures and a `.test.mjs` conformance caller in the same language folder.
   Build with `npm run build:core`, then run
   `node --test src/graph/languages/<name>/*.test.mjs`; such a test can import its
   module from `dist/graph/languages/<name>/index.js`. No central test list is
   needed to execute it. The project's default `npm test` currently discovers
   top-level `test/*.test.mjs`; integrating a generic folder-test glob is future
   test-runner wiring, not necessary for discovery or language registration.
6. Rebuild and call `discoverLanguages()`. The module is now present without a
   registry, indexer, store, query, CLI or package edit. Language assets must
   already be available or live in that folder. Adding a dependency still needs
   its separately owned dependency chunk.

Full production-language support also needs Stage 7 contract and behaviour
output through the existing emitter mechanism; this foundation does not invent
that later output contract or claim those modules have already landed.

## Evidence and checks

The toy fixture has two functions, two file symbols, one file import, three
calls and one unresolved call. Tests cover discovery of an additional synthetic
folder, exact queries/neighbourhoods, persistence, project namespace identity,
unchanged database bytes and parse/replacement counts, one-file edits, target
rename/deletion/partial invalidation, parse and resolution failures, recovery,
claim collisions, exclusions, conformance and the real installed Go WASM plus
complete bundled tags query. The Unicode helper case validates UTF-16 spans.
No browser, native grammar build or real language module was used.

Final command output and results are recorded under `evidence/w1-c/`.
