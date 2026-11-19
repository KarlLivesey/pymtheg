# Current support matrix and semantics

`check` requests local analysis only. The requested analyses may each complete,
fail, or remain incomplete; there is no global verified badge. No external
backend exists; `check` starts no other program.

| Construct | Parsing/typing | Local analysis | Behaviour |
|---|---|---|---|
| Bool, mathematical Int/Nat, String, Unit | implemented | implemented | flows: explicit finite domains; machines: Bool/Int/Nat |
| Nominal records, tagged unions/payloads, List<T>, Result<T,E> | implemented | field/tag/signature/outcome checks | finite flow values supported; explicit lists/scalar domains required |
| Imports, duplicate/ambiguous names, cycles | implemented; cycles diagnosed unsupported | deterministic single parse/file | selected explicit machine only |
| Pure typed rules/calls | implemented; rule recursion rejected | exact alpha copies, effects, explicit cost overhead | flow evaluation with pre/postconditions; machine expressions exclude calls |
| Abstract op signatures/effects/cost/settles/stable | implemented | contracts are visible assumptions | finite contract results or linked explicit provider protocol |
| Structured flow call/let/if/match/return/propagate/assert | implemented | types, effects, costs, ownership | finite source graph; built-in search/sampler; replay |
| Cardinality and List iteration, bounded retry | implemented | work upper bounds; loop-local ownership | bounded loops/retry execute; initial attempt included |
| Single-owner resources/take/read borrow | implemented | states, moves, local exits, explicit cancellation | creation, transfer, terminal exits, cancellation |
| Fresh direct/Result resource return | implemented via creates result | per-outcome ownership through match | supported; owned collections/shared mutation unsupported |
| Unknown expression/statement | legal, dependencies retained | affected results incomplete; independent claims usable | affected entry incomplete |
| Scalar conjunctive entry constraints | implemented | integer interval/Bool witness or contradiction | machine initial state explicit |
| Call preconditions | implemented | branch-sensitive scalar/affine facts; supported abstract returns carry assumptions to consumers; other calls retain obligations | evaluated in finite flow execution |
| Concrete postconditions | parsed/typed | scalar/affine fragment; unsupported reasoning stays pending | evaluated on finite flow returns |
| Explicit finite machine/event/invariant | implemented | type checks; initial domain preflight | built-in exhaustive search and seeded sampler (CLI, Studio, MCP) |
| Machine recursion/parallel calls/records/strings | outside behavioural expression subset | local supported constructs remain usable | preflight rejects |
| Near-duplicate rule suggestions | deferred | exact copies only | not applicable |
| Latency/peak live memory | reserved metric names rejected | no additive-work pretence | unsupported |
| SMT/proof, liveness/fairness, code extraction/conformance, LSP, caches | deferred | no claims | no claims |
| Agent-facing MCP | implemented local stdio | same worker, root-confined reads, paged explanations/evidence | built-in search (verify) and sampler (simulate), source-mapped trace steps |
| Code graph and requirement links (Go, Rust, TypeScript/JavaScript) | `pymtheg graph`, `pymtheg link`; MCP `code_graph`, `graph_result`, `requirement_links`, `link_result` | definite, candidate-set and unresolved links with possible callers; source-only unless the Go toolchain route is turned on | not applicable; links record reviewed intent, never proof |
| TypeScript / Rust / Go scaffolds | one normalized contract document from checked IR | fail-fast stubs by default; optional empty bodies; arbitrary precision, explicit dependencies/omissions | no runtime implementation or conformance claim |
| Language emitter plugins | explicitly registered local module; versioned API | bounded process, validated output/identities; JavaScript example | trusted executable code; registered launch targets work in CLI/MCP/GUI; no automatic discovery |
| Local Studio | implemented | real compiler workers, typed scenario forms, source/durable-draft conflict saves | built-in search (verify) and sampler (simulate), same scopes; replay player; three cached runs |

The [grammar](grammar.md) is normative for accepted source syntax. Historical
`checkout.s15` remains an aspirational, incomplete sketch and is not accepted input.

`Result<T,E>` expands to `Ok(T)` plus the variants of the named error union E.
`match` is exhaustive over that closed domain. `propagate value;` forwards the
**whole** compatible result and terminates the flow, like `return value;`; it does
not unwrap success into an implicit continuation. Propagation requires the same
nominal result domain. No second throws/exception mechanism exists. Cancellation
is a separate declared control alternative with explicit cleanup, not a synthetic
payment error saying no effect happened. `Unavailable` has no automatic guarantee
about a provider's effects; model OutcomeUnknown whenever that is unresolved.

`retry A on Tag { body }` describes up to A total executions, including the initial
attempt. Tag must be a declared outcome. Structural accounting conservatively
bounds retry stops by A; explicit return/propagate terminates immediately. The source interpreter preserves retry stopping conditions. Link a provider protocol
when request, effect and response must interleave.

Loop count N is nonnegative and may be zero even when its upper bound is positive.
A list loop binds elements; an integer loop binds Nat indices. `bound xs <= 200`
is a cardinality assumption; `bound N <= 200` constrains a Nat size parameter.
Costs count the described operations, not host execution time. Concrete `overhead`
is added once per invocation. Abstract `cost` is the total summary; a concrete
body cannot also declare a total. `budget` constrains the inferred total only.
Absent abstract summaries for a requested metric remain unknown. Primitive
expressions have zero *declared counter ticks* unless overhead is annotated;
this does not mean they execute in zero CPU time. Metrics are independent additive
user counters; only metrics declared in the project are requested locally.

Cancellation cleanup is conservatively checked at statement boundaries and normal
completion boundaries. Missing cleanup for an owned resource is a pending
obligation. Handler resource transitions are conditional on acquisition and caller
ownership. A transferred obligation belongs to the callee and requires a per-outcome
settlement summary including cancellation. Marking a value moved is never evidence
of cleanup. Concrete callee bodies are checked; abstract settlements are trusted.
Owned collections and outer-resource changes in repeated blocks need richer
summaries/invariants. Resource-returning calls require explicit creates provenance.

Machine events are nondeterministically selected enabled atomic actions. All
assignments use the old state; omitted variables stay unchanged. Deadlock stutters.
Integer domains are author-supplied and remain in the report. Behavioural preflight
rejects literal/domain magnitudes outside +/-9007199254740991; local bigint
analysis retains larger integers. No source population or loop is silently reduced.
An optional scope JSON must exactly match source domains, e.g.
`{"domains":{"count":"0..2"},"assumptions":[]}`. It never silently narrows them.
The built-in search exhausts reachable states of this finite machine; the
built-in sampler samples traces up to the selected steps/samples. Neither proves unmodelled populations or production code.

Correctness tests do not use benchmark thresholds or startup sleeps. Deadline
classification uses controlled process boundaries; real process teardown starts
after readiness. The process-ownership tests (`test/process.test.mjs`,
`test/implementation-process.test.mjs`) wait for readiness and completion
handshakes and fire deadlines and grace periods explicitly. Their named 60-second
outer safety budgets only turn missing evidence into an unresolved failure; they
establish no timing property. They observe descendants through Linux `/proc` and
use a test-only preload and Unix socket to observe the supervisor's completion.
Source: [W2-T](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-T.md). Backend integration timeout is an explicit unresolved/skip,
not a successful assertion of the source property.

Flow lowering materialises at most 5,000 source states by default (explicit
`maxStates` may be 1..100,000), 100,000 edges and 10,000 input combinations.
Exhausting a construction budget yields incomplete evidence, never a smaller
successful graph. Scope examples and operation protocol restrictions are in
[the Studio guide](studio.md). Source graphs are a bounded checking method,
not a general compiler equivalence proof. No temporal liveness claim is made.

## Rebuild state: engines, storage and code graph (merged through W2-C2)

This section folds the merged per-chunk notes under [changes/](https://github.com/KarlLivesey/pymtheg/tree/main/docs/changes) for
mega-plan Stages 1–4 and 6–7 as they stand on `main`. Open pull requests are not
described. Where this section and an older section below disagree, this one is
current.

### Built-in behaviour engines (CLI)

| Command | Engine | Result |
|---|---|---|
| `verify FILE --entry NAME [--state-budget N]` | Built-in exhaustive breadth-first search | One result per invariant plus `state-domains`; a violation has a shortest, source-replayed trace; `no_counterexample (finite_model_check, complete)` with `exhaustive: true` otherwise |
| `simulate FILE --entry NAME [--seed --max-steps --max-samples]` | Built-in seeded sampler | `no_counterexample` at best, with `exhaustive: false` in JSON (text output: `simulation, sampled, not exhaustive`), never an exhaustive pass; traces are replayed but need not be shortest; same seed and limits give the same result |
| `emit FILE --entry NAME --target json --out MODEL.json` | none (lowering only) | The lowered model the engines check: machine, source mapping, bounds, assumptions and, for flows, the finite source-state graph |

These are the only behavioural engines; the CLI, Studio and MCP all use them and
no external program, runtime or download is needed. TLC, Quint and every Java
dependency were removed in [R1-A](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/R1-A.md) (decision D2). `--state-budget N`
(positive safe integer, default 1,000,000 distinct states) bounds `verify`.
Exhausting it, a timeout, cancellation or a domain boundary leaves every
unviolated property inconclusive and incomplete with the limit named
(`stateBudget=…`, `timeoutMs=…`, exit 2); already replayed violations survive a
budget or domain boundary. A worker or engine error is a failure (`B104`,
completion `failed`, exit 3), never a verdict. Options that belong to another
command (`--state-budget` outside `verify`; `--seed`, `--max-steps`,
`--max-samples` outside `simulate`, unless supplied by a scenario; `--target`
outside `emit`) are rejected. Engine contract: [W1-B](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W1-B.md), wiring:
[W2-A](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-A.md), removal of the external engines: [R1-A](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/R1-A.md).

### `check` notices

- When the checked declarations include a machine, text output ends with
  `BEHAVIOUR NOT CHECKED`: `check` covers types, effects and outcomes only, did not
  run machine events or test any invariant, and is not behavioural evidence. It
  lists each machine (up to five, then a count) with its invariant count and the
  exact `pymtheg verify FILE --entry NAME` command. Text output only; JSON, `--out`,
  MCP and Studio are unchanged. Flows with `assert` are verifiable but not listed.
- A `T002 Expected Nat, got Int` caused by a subtraction gives the reason
  ("Subtracting from a Nat gives an Int, because the result may be below zero")
  and a fix; for machine state, the full replacement declaration with its range,
  for example `` `state n: Int in 0..3 = 3;` ``. The hint is part of the message,
  so it is also in JSON reports. It is lost when the subtraction passes through a
  local. Typing is unchanged: `Nat - Nat` is `Int`. Source: [W2-F](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-F.md).

### Project storage

Everything Pymtheg stores for a project is under one `.pymtheg/` folder; the
layout, what to commit and what is rebuildable are in
[project initialization](project-init.md#local-state-and-sharing). Shared data
(`.pymtheg/shared/`) holds requirements, links, decisions, history and unsaved
drafts; rebuildable data (`.pymtheg/rebuildable/`) holds the code graph cache and
the recent-run cache, and deleting it loses nothing that cannot be regenerated.
All features open their SQLite databases through one storage boundary
(`src/storage/`). Local storage only; no synchronization.

**Graph writes (C-6).** An index writes through SQLite's write-ahead log when
both of these hold:

- **A fixed SQLite.** `process.versions.sqlite` is a version with the fix for
  SQLite's write-ahead-log reset bug: 3.51.3, 3.53.0 or later, or the
  backports 3.50.7 and 3.44.6. An unknown version counts as not fixed. The
  check reads the SQLite actually running, so a Node linked to a system SQLite
  is judged by that SQLite. Node's own bundled SQLite qualifies from Node
  24.15.0 in the 24 line, from 25.9.0 in the 25 line, and in Node 26
  ([table](https://github.com/KarlLivesey/pymtheg/blob/main/evidence/c-6/sqlite-versions.md)).
- **A Linux local filesystem:** ext2/3/4, XFS, Btrfs, tmpfs, ZFS, F2FS,
  bcachefs, overlayfs container layers, JFS or ReiserFS.

What that gives:

- **Commits** are not synced one by one; the completion record is written
  last with a full sync.
- **Readers** (CLI queries, MCP, Studio) are not locked out by an index in
  progress, provided the index switched to the log. If another connection
  was reading at the moment it tried, it keeps the rollback journal for that
  run, and readers wait during its commits as before. A second writer waits
  up to 30 seconds either way.
- **Interruptions.** An index cut short by a kill or a power loss leaves
  either the previous completed index or a store that reports incomplete. The
  next sync rebuilds it.
- **At rest.** When the last connection using the log is a writer of this
  build and it closes, the file returns to SQLite's rollback journal, the
  format readers in a read-only directory expect.
- **When the log stays.** The file stays in log format, with `-wal` and
  `-shm` beside it, in two cases: the writer was killed, or a reader or
  another connection that has read since the log started is still open when
  the writer closes. Every open reads the same rows in that state, including
  a reader in a read-only directory while `-wal` and `-shm` exist. The next
  index that closes alone returns the file to the rollback journal.

Everywhere else the graph keeps the rollback journal with a full sync per
commit, exactly as before. That covers:

- Node 24.0.0 to 24.14.x and 25.0.0 to 25.8.x with their bundled SQLite, and
  any SQLite without the fix;
- macOS and Windows;
- NFS, SMB, FUSE, 9p and virtiofs mounts, including WSL drive mounts and
  Docker Desktop bind mounts;
- any filesystem whose type cannot be read.

A write-ahead log needs memory shared by every process that opens the file,
which these filesystems do not guarantee. There, a writer never writes in a
write-ahead log. If a killed run left one, the writer first folds it back into
the database and removes it, waiting for other connections for up to 30
seconds; otherwise the write fails as "database is locked".


Old layouts (`.pymtheg.json`, `.pymtheg-architecture/`, `.pymtheg-studio/` and
the old top-level `.pymtheg-*.json` files) are unused dead data: never read,
migrated or deleted, and their presence refuses no command. `init` and `doctor`
print one notice naming them (see [project initialization](project-init.md#local-state-and-sharing)).
Symbolic-link storage directories, databases and SQLite sidecars are refused.
Source: [W2-E](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-E.md).

**Stable global IDs and recorded history (first slice of 3.3).** Each checkpoint
registers its documents, projected entities (including requirements and
decisions) and relationships with a random UUID. Existing local IDs (`R1`,
`plan:R1`, content hashes, checkpoint IDs) keep their meaning and remain what
clients show. Edits keep a UUID; a recorded removal keeps the old UUID as a
tombstone; a key that reappears after removal gets a new UUID with a `previous`
reference; there is no restore workflow. Checkpoints, acknowledgements,
withdrawals and architecture-draft writes append receipts with a random change
UUID, author, machine and actor token, recorded time and a database-wide sequence.
Order is `(sequence, machine, actor, change UUID)`, never timestamp or author
name; across independent stores it is a deterministic presentation order, not
causality. The writer identity is `.pymtheg/local/writer.json` (local OS user name
as the default author; edit `author` there to change it). Not done yet: the
ledger is not carried in history archives or preserved by archive import; UUIDs
are not shown by CLI, MCP or Studio; no command sets the author; no move or
rename identity resolution, synchronization or merge; some imported-data path
fields still accept absolute paths; old records are not backfilled. Source:
[W2-E2](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-E2.md).

### Document import

The folder reader accepts a single file, a `doc/` folder and reStructuredText
(`.rst`): underline and overline/underline headings become linkable sections
(section recognition, not an RST renderer). `pymtheg import-architecture
FILE|FOLDER --into PROJECT` uses it. Include/exclude path patterns and the
structured summary of skipped files exist in the reader and summary renderer but
are **not yet exposed** by the CLI, MCP or Studio. Source: [W1-D](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W1-D.md).

### Code graph

The graph store, indexer and three production language modules (`src/graph/`)
answer the CLI command `pymtheg graph` (below), the MCP tools `code_graph` and
`graph_result`, and requirement links (`pymtheg link`, MCP `requirement_links`).
No Studio screen uses them; `observe` still uses the older TypeScript/JavaScript
reader. The store is `.pymtheg/rebuildable/graph.sqlite`, schema 4; a schema-3
(0.1.0) graph is migrated in place when opened for writing (its rows are kept
unchanged) and read as having no library targets when opened read-only. Any
other graph database is refused with a rebuild message; 0.1.0 refuses a
schema-4 graph the same way. Nothing runs project code.
Nothing runs a language toolchain unless the project opts in to the Go
toolchain route (below); nothing reads or writes `.codegraph/`. Language
modules are discovered from `src/graph/languages/*/`;
production discovery offers `go`, `rust` and `typescript` (the `toy` fixture is
test-only). Each module's current version, and the versions the index was built
with, are in every graph answer (`modules`: `id`, `version`, `indexedVersions`;
MCP section `modules`); a changed module version makes the next query sync the index. Interface: [W1-C](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W1-C.md), [W2-I](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-I.md).

Link outcomes:

| Outcome | Meaning |
|---|---|
| `resolved` | One definite target in the checkout |
| `library` | One definite target outside the project: a library unit (level 1) or a symbol in it (level 2), recorded with how the source proves it (see the design section in `runtime-map.md`). Rust records library paths with proven bindings. TypeScript and JavaScript record library targets at existing sites. |
| `ambiguous` | A candidate set, never a pick. It may mix checkout symbols and library targets. A set is **closed** only when it provably holds every possible target and every member is provably possible. Otherwise it is **open**, and `data.open` gives the reasons (for example a type outside the project could be the target); an open set still lists every project target |
| `unresolved` | No target; the written name is kept. The reason, when recorded, is in `data` (`reason` in Go and TypeScript, `uncertainty` in Rust). Rust may also list unverified would-be targets in `data.targets` (at most 16, else a count) |
| failed (`unresolved`, reason `invalid-code`) | The link depends on a file that could not be read. `data.cause` names the failed file(s). It has no target, no candidates and no would-be targets |

**Unreadable code is failed; the unit is the file.** A file with any syntax error
is reported in the index report's `failed` list with its syntax error located,
and contributes no symbols and no links. Nothing in a failed file is a target. A
link from a valid file that depends on it is failed with the cause recorded, and
`invalid-code` is asserted only when that dependence is certain. The failed
file's package, crate or program may contain unseen declarations, so lookups that
such declarations could change are not definite: they become open sets or
unresolved (Go, Rust) or are flagged unverified (TypeScript, below).
Grammar gaps (below) make some valid files fail.

**Failure caching and the broken-file report.** A content failure returned by a
module's `parse` (a syntax error) is stored and reused: while the file's
original-byte hash, module ID and module version are unchanged it is not parsed
again, and it stays failed with its diagnostics. Editing the file or bumping the
module version invalidates it. Go and Rust failures are cached this way.
TypeScript is analyze-only: its failures come from project analysis, and one
the module certifies as a content failure (`failureKind: "content"`, which a
syntax error is) is cached the same way, so an unchanged broken file is counted
`unchanged` on the next index and stays failed; other analysis failures are not
cached. Failures marked `failureKind: "transient"`, thrown parser
exceptions (crash, timeout, cancellation, resource budget), malformed parser
output, unreadable captures and project-analysis failures are never cached; they
are retried. `SqliteGraphStore.failedFiles()` lists the failed source files, ordered
by path, as `{path, language, reason, range?}` (reason and range from the first
diagnostic). Partial files are not in it. Derived links are compared and stored
one row at a time, so no single string holds a whole module's analysis; this
does not make an arbitrarily large snapshot fit in memory. Each module's
`resolve` receives its own independent copy of files, symbols, links and
context files, so a module that mutates its input cannot affect later modules
or stored facts. `SqliteGraphStore` declares `independentReads`: its file,
symbol and link reads (`files`, `getFile`, `filesAt`, `findSymbols`, `links`,
`moduleLinks`) decode fresh records from storage, and the indexer passes those
to the module without copying them again. Context files are always
deep-copied. For a storage backend that does not declare it,
the indexer deep-copies the module's input as before. The SQLite store keeps
no decoded file between reads and indexing holds no whole-graph copy from one
module to the next, so memory follows the largest single phase rather than the
number of copies.
Source: [W2-M](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-M.md),
[C-2](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/C-2.md).

**Internal errors are not invalid code.** An exception inside the TypeScript
module while reading one file, and the TypeScript compiler's stack limits, fail
only that file with wording that says it is a defect in Pymtheg or a resource
limit, not a problem in the file; the result is marked `failureKind: "transient"`
and is retried on the next index. An exception while building a project or
program is reported as an analysis error for the module. Links into a file that
failed internally are unresolved with no reason. In Go and Rust a thrown parser
exception is a parser error in the index report, not a syntax failure, and cannot
become an `invalid-code` cause. Source: [W2-U](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-U.md).

#### Go

Source-only by default: nothing runs `go` unless the project opts in to the
toolchain route below. Claims `*.go`; context `go.mod` and
`go.work`. One `package` symbol per directory and package clause, hosted in one
file (its ID can change when files are added or removed).

- **Definite:** imports of packages in the importing file's module, a `go.work`
  module or a proven local `replace`; package-qualified references; direct calls;
  calls and selections on a concrete receiver whose type is evident from the
  source, by Go's selector rule including promotion; the same on elements of
  slices, arrays, maps (value, and key for a ranged key) and channels, on range
  variables and index expressions over them, also through a named type written
  as a container (`type R map[string][]T`, also a generic defined type over
  one); fields and promoted members of anonymous struct types (every anonymous
  struct type with a field is a local struct symbol with its fields, its
  identity anchored to its owning declaration: table tests, nested
  `mu struct{…}` fields; ranked after named symbols in search) and of
  function-local struct types; field, type, receiver and embedding references;
  `contains`.
- **Candidates:** a name declared in several build variants (build constraints
  are not evaluated; a selection on a type declared in several variants is
  searched per variant and is definite only when all variants agree, otherwise
  the set of their answers); several equally shallow promotion paths; interface dispatch
  (the interface method plus every project type whose method set matches by name
  and parameter/result counts; always open, `structural-match-unverified`);
  calls on a receiver whose type the source does not show (name-only, open,
  `receiver-type-unknown`; with only one project method of that name it stays
  unresolved, and a receiver of a standard-library or third-party type is
  unresolved); reassigned function-valued locals.
- **Never definite:** `implements` links (unresolved, interface kept in
  `data.interfaceId`, `structural-match-unverified`; computed type identity is an
  annotation only). An interface that embeds two provably different
  declarations of one method (invalid Go) has no implementers.
- **Unresolved:** standard library, third-party and non-local `replace` imports and
  everything reached through them; imports Go forbids (`internal`, `package main`,
  `testdata`); unexported names from another package; builtins (`data.builtin`);
  elements of function containers; elements of a generic named container
  (`type L[E any] []E`); a field of an anonymous struct type declared in several
  build variants of its enclosing type; explicit generic-method instantiation
  `t.Map[C](x)`; `new(variable).M()`.
- **Not extracted:** locals, parameters and type parameters as symbols; keys of
  keyed composite literals; generic type arguments (`Stack[int]` methods resolve
  on `Stack`); cgo (`import "C"` is an unresolved import); imports into `vendor/`.

Grammar: the module loads `grammars/go/tree-sitter-go.wasm`, built by Pymtheg
from upstream `tree-sitter-go` v0.25.0 plus upstream PRs #202 (`new(expr)`, and
user-declared `new`/`make` called with values) and #198 (Go 1.27 generic methods).
The manifest records the upstream commit, patches, tool versions and sha256, and
`test/grammar-vendored.test.mjs` checks the file against it; rebuilding is a
maintainer step (`node grammars/build.mjs go`) that install and tests never run.
Still failing a valid file: an empty statement followed by another statement on
the same line (`{; G() }`), and a non-BMP character in an identifier that
straddles one of the parser runtime's 5,119-unit input chunk boundaries (the same
character in a comment or string there is read). Sources: [W2-B](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-B.md),
[W2-B2](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-B2.md), [W2-S](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-S.md), `grammars/README.md`.

#### Rust

No-toolchain module; nothing runs `cargo` or `rustc`, and macros are not expanded.
Claims `*.rs`; captures `Cargo.toml`, `Cargo.lock` and `.cargo/config.toml`
or `.cargo/config` as context, read by a snapshot-only
TOML reader (an unsupported or invalid manifest, including any TOML datetime,
makes that whole manifest unknown). Private items are ordinary symbols.

- **Cancellation:** the graph CLI can interrupt Rust analysis and resolution
  with SIGINT or SIGTERM. Interrupted syncs leave an incomplete index and can
  be retried. When an import path reaches the resolver's depth boundary, an
  unresolved link can report `import-lookup-depth-unverified`.
- **Definite:** module declarations and file modules; free-function, type, pattern
  and value paths from proven bindings written in the source; imports, including
  re-exports and globs where the binding is proven; associated calls such as
  `A::new` on a proven inherent impl; written `impl Trait for Type` links;
  `contains` (structure as written, not a claim that an item survives macro
  expansion).
- **Library paths** identify a sysroot or Cargo library unit
  and a symbol exported by that unit. The resolver follows proven imports,
  Cargo renames, inherited workspace dependencies, and written type, trait,
  and macro paths. Prelude links require an edition and a clear namespace.
  Associated calls require a proven declaring member or an explicit trait
  qualification. An exact manifest requirement or a lockfile entry selected
  by the dependency edge can supply a version. `graph uses` can query the
  recorded unit or symbol.
- **Dot calls** (`recv.m()`) are definite only for a unique inherent method at the
  first probe step of a proven receiver type (owned `T` with `self`, `&T` with
  `&self`, `&mut T` with `&mut self`). Every other dot call is unresolved with
  would-be targets and a reason (`later-probe-step`, `trait-dispatch`,
  `receiver-type-unverified`, …); no dot call has a closed candidate set.
  A receiver's type comes from a parameter or an annotated `let`; an
  unannotated `let a = A::new();` is not given a type. Even with an annotated
  `let b: A = A;`, a call of a `&self` method (`b.r()`) is a later probe step and
  stays unresolved.
- **Non-builtin attributes:** a link whose **target** is an item under a
  non-builtin attribute, or inside an item with one, is not definite (the
  attribute may replace the item; `item-under-opaque-attribute`, target kept as a
  would-be target), and so are `use` and `mod` declarations under one. Links
  written **inside** such an item (for example the body of a `#[tokio::main]`
  function) are resolved as written.
- **Macros:** a macro invoked as a statement of a block, or as the block's
  tail, withholds links in that block, including nested blocks and closures
  inside it (`opaque-item-may-shadow-name`), unless it is proved unable to
  define an item there; links outside that block are unaffected. Only lookups
  that an item defined by the macro could shadow are withheld (`helper()`,
  `A::new()`); paths anchored with `crate::`, `self::`, `super::` or `Self::`
  still resolve. A macro nested inside a larger expression (`let x = m!();`,
  `helper() + m!()`, `Some(m!())`, a match arm value) withholds nothing. The
  tail case is conservative: rustc treats a tail macro as an expression, which
  cannot define an item, so links there are lost, never wrong. Proved unable:
  the twenty standard statement macros (`print`, `println`, `eprint`,
  `eprintln`, `assert`, `assert_eq`, `assert_ne`, the three `debug_assert`
  forms, `vec`, `format`, `write`, `writeln`, `panic`, `todo`, `unreachable`,
  `unimplemented`, `dbg`, `matches`) unless a captured binding of that name
  could compete there (a captured `macro_rules!` of that name competes only
  where it is in textual scope, or through a path or import); audited
  ecosystem macros; and a workspace `macro_rules!` macro that the invocation
  names definitely and whose every arm is readable and emits, at its top
  level, no item keyword, `let`, attribute, `tt`/`item`/`stmt` fragment or
  metavariable used as a macro name, and invokes there only macros that are
  themselves proved unable at the same site (macro names in a transcriber
  resolve at the call site; `$crate::` in the defining crate). Tokens inside
  a brace group of the transcriber are in their own block and do not count.
  A child module file inherits its parent's textual macros at its `mod child;`
  declaration, so `#[macro_use] mod macros;` macros used in later child files
  resolve. A `#[macro_export]` macro of another crate in the project resolves
  (by path, `use` or `#[macro_use] extern crate`). Written library macro paths
  and proven prelude macros can produce library targets.
- **Outside Rust paths.** Written paths resolve through explicit imports,
  qualified names and unshadowed edition preludes. A module-level expansion
  cannot replace a definite explicit import in that module and namespace.
  Glob imports, prelude names, `#[macro_use]` and block-level expansions
  still need independent shadowing proof. A directory-source replacement
  from Cargo configuration uses a captured vendored crate as a checkout
  dependency when the source and selected version are proven. This covers
  crates.io, alternate registry indexes, and Git URLs with their ref selectors.
  A replacement with an unproven checkout target leaves the link unresolved.
  Receiver calls still require the declaring owner.
- **Clean expansion (both rules below).** A workspace `macro_rules!` arm is
  clean when the code it emits has no attribute anywhere (so no `#[cfg]` can
  remove a call) and no item other than a readable `use` (no `fn`, `mod`,
  `impl`, `const`, `static`, `struct`, `macro_rules!`, …). A nested macro it
  invokes must be harmless where the macro is invoked: a standard or builtin
  macro no captured binding rebinds, or a readable workspace macro that is
  neutral and clean and invokes only harmless macros. An unreadable nested
  macro is not harmless. Tokens inside a nested `macro_rules!` definition (a
  macro factory) are never read as calls. A `use` in the emitted code that
  binds a name heading a macro the expansion invokes (or a glob `use`) makes
  it unclean, and a nested macro whose name such a `use` in force could
  rebind is not followed. A bare name counts as the standard (or builtin)
  macro at a point (for a name in a transcriber: the invocation site, where
  rustc looks it up) only if, there:
  - the standard macro is available (no `no_std` without std, no
    `#![no_implicit_prelude]`);
  - no proc macro and no `#[macro_use(name)]` entry in the project has that
    name;
  - no `macro_rules!` of that name is in textual scope, and no unseen
    (failed) file is in that textual chain;
  - no `#[macro_use] extern crate` covers it (one for a crate outside the
    workspace fails closed);
  - no explicit `use` in scope binds a macro of that name. Each import is
    resolved: `use std::vec` and a workspace function or module do not; a
    path into a crate outside the workspace fails closed;
  - no item of the module is a macro of that name (for example a crate-root
    `#[macro_export]`).

  Globs are not consulted: one that brings in a std-named macro is an
  ambiguity error (E0659) in rustc. A crate that does `#[macro_use] extern
  crate tracing;` therefore gets no proven standard names, so its argument
  and body calls through format macros stay unresolved. For standard-named
  macros, ruling E4 (Assumption E4 below) governs only whether a statement
  macro withholds its sibling names, not these proofs; E4 also covers
  `derive` and `global_allocator`, as stated there. A macro exported with
  `#[macro_export(local_inner_macros)]` that invokes any macro by a bare name
  proves nothing: rustc resolves those names at its own crate root.
- **Calls in macro arguments:** calls written in an invocation's argument
  tokens are links, read as a format-style list: pieces separated by `,`
  (and `;` for `vec!`), each an expression or `name = expression`; only the
  first piece of `matches!`. A piece containing a closure, `let`, `match`,
  `for`, `while`, `loop`, an item keyword, `=>`, a label or a metavariable is
  not read (no links), nor are tokens inside a non-standard macro nested in
  the arguments, nor a brace block in the arguments that invokes any macro
  directly (it could define items there). Such a link resolves by the ordinary rules for a call at that
  place only when the invocation provably evaluates the tokens as expressions
  at the call site: a standard format macro (`print`… `writeln`, `format`,
  `format_args`, `panic`, `todo`, `unreachable`, `unimplemented`, the
  `assert` forms, `dbg`, `vec`) that passes the checks above, or a workspace
  `macro_rules!` macro whose every arm matches `$($x:tt)*` (or nothing), is
  clean, and passes all of it, unchanged, as the tail of the argument list of
  a standard format macro or of another such workspace macro. Forwarded
  tokens keep call-site hygiene, so `let` bindings and closures in the
  transcriber do not capture them; a name a `use` in a transcriber group
  around the forwarding binds is not resolved (a glob `use` there withholds
  every name). Every other link of this kind is unresolved with its
  would-be targets (`macro-argument-unverified`), for example calls inside
  `tracing::info!`, `serde_json::json!` or `$x:expr`-matcher macros.
- **Calls in macro bodies:** for each invocation that names one readable
  workspace `macro_rules!` definition, each path call written in its
  transcriber (outside pattern positions, nested non-format macro calls and
  nested `macro_rules!` definitions), and transitively in workspace macros
  invoked there, becomes a derived `calls` link (link origin `analysis`,
  `data.macroBody`). **The caller is the invocation site's enclosing symbol,
  not an item the macro generates:** a call inside a `fn` that the macro
  defines is attributed to the module or function where the macro is
  invoked. It is resolved as at the invocation (items at the call site,
  `$crate::` in the defining crate). It is definite only when every macro on
  the way has one arm and a clean, proved expansion, the call is not inside
  a `$( … )` repetition (each of these is a property of the whole path,
  carried through every nested macro), it is not read inside the arguments
  of a standard-looking macro that is not the standard one there, and
  nothing can rebind the head name: a `use` in an
  enclosing transcriber group, a generic parameter at the call site, or, for
  a one-segment name, a local the arm binds or a local in scope where the
  macro is defined (a macro defined inside a function body). Otherwise it is
  unresolved with would-be targets (`macro-arm-unverified`,
  `macro-expansion-unverified`, `macro-body-name-unverified`,
  `macro-repetition-unverified`). So a body that defines items (test
  generators such as ripgrep's `rgtest!`, a generated `mod` with `self::` or
  `super::` paths) or carries `#[cfg]` gives unresolved body calls. Body
  calls with no workspace target, sysroot paths, `Self::` paths and method
  calls are not derived.
- **Derives:** on stable Rust a `#[derive(Name)]` resolves among derive
  macros only, and those come from proc-macro crates (imported by `use`,
  named by path, or brought in by `#[macro_use] extern crate`) or from the
  standard prelude. A `macro_rules!` macro is function-like on stable:
  `macro_rules!` derives and attributes are unstable (rustc 1.98.1: E0658),
  and a bang `macro_rules! Debug` in scope coexists with
  `#[derive(Debug)]` without changing it. So a standard derive is opaque only
  when a `#[macro_use] extern crate` could bring a derive of that name into
  the crate (bare: any name; a list: the listed names), besides the existing
  checks on `use` imports and globs; `#[macro_use] mod m;` cannot change it.
  Known limit: a nightly crate enabling `macro_rules!` derives is not
  modelled.
- Cargo features and target platforms are not evaluated; `cfg` conditions are
  compared structurally.
- **Assumption E4:** unseen code (a bare `#[macro_use] extern crate`, opaque macro
  output) is assumed not to rebind `derive` or `global_allocator`; only a binding
  visible in captured source shadows them. Extended: unseen macro output, bare
  uncaptured `macro_use` exports and failed or unverified textual module entries
  are assumed not to define a macro named like one of the twenty standard macros.
  A counterexample can give a wrong definite link (for example a failed
  `macros.rs` that defines its own `println!` emitting an item); both are pinned
  as known limits (`test/graph-rust-round12.test.mjs`, the macro-recall tests).

Grammar: the module loads `grammars/rust/tree-sitter-rust.wasm`, built by
Pymtheg from upstream `tree-sitter-rust` v0.24.2 plus six upstream pull requests
and two patches of its own (`grammars/README.md`). It reads `&raw` borrows and a
variable named `raw`, `unsafe extern "C" { … }` with `safe fn`, and `#[cfg]` on
a struct-pattern field. It still rejects some valid Rust, which fails the whole
file (3 files of Vector): two or more attributes on one parameter or an
attribute on a closure parameter (a single attribute on a function or method
parameter parses), a turbofish on a function named like a primitive
(`char::<_, E>(…)`), and `impl A + for<'a> B<'a>`. Sources:
[W2-C](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-C.md), [W2-P](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-P.md), [W2-V](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-V.md).

#### TypeScript and JavaScript

Uses the TypeScript compiler over the captured snapshot. The only other input
is the installed compiler's standard-library declarations. The snapshot host
models checkout-local package links in a virtual `node_modules`. Claims
`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`; context
`*tsconfig*.json`, `*jsconfig*.json`, `package.json`, `pnpm-workspace.yaml`,
`deno.json`, `deno.jsonc` and conventional import-map filenames. Each file
is analysed under its owning config (nearest containing directory, then
`tsconfig` before `jsconfig`); genuinely tied configs are merged to the weakest
answer.

- **Definite:** module imports; import and export bindings to the original
  declaration through barrels, `export *`, renames and default exports; CommonJS
  `require` with a literal specifier; calls, `new`, JSX components, type
  references and heritage when the checker gives one graph symbol (overloads are
  one symbol); `contains`.
- **Lexical declarations:** nested functions, function-valued `const` and
  `let` declarations, and local classes and enums have scoped symbols.
  References record the first expression use per enclosing symbol and target.
  Existing `typeof` references to plain local bindings identify the enclosing
  symbol and record the binding name and declaration span in `data.localBinding`.
  Plain locals add zero symbol rows and zero new reference sites. Name lookup
  lists top-level and exported declarations ahead of scoped ones.
- **Generic references:** a recorded type reference to a type parameter links
  to its enclosing graph symbol. `data.localBinding` gives the parameter's name
  and declaration span, including when an inner signature shadows an outer
  parameter. Each reference uses the checker's binding.
- **Member chains:** the checker follows checkout receiver types through
  selections, factory results, `await`, optional access and literal element
  keys. Named object-literal members can be targets even inside a local binding
  or a returned object. Their identities use their enclosing declaration and
  member path, and search ranks them after named top-level declarations.
  A newly supported literal member needs a provable receiver producer.
  Multiple visible producers supply candidate declarations when each has a
  graph anchor. Opaque producers stay unresolved (`object-producer-unverified`).
  Several visible producers with missing anchors stay unresolved
  (`multiple-object-producers`).
  Factory fallthrough and bare returns can contribute `undefined`, including
  after `await`. Static object destructuring follows named properties,
  renames, nested patterns, and defaults that can run. Passing a produced
  object as a call argument preserves static links. A direct binding or
  property reassignment can change or withhold them. An indirect write through
  an open index signature or `Object.assign` in another function can leave
  the original member link in place. The graph uses static declarations and
  leaves interprocedural aliasing writes untracked, as it does for class fields.
- **Checkout packages:** npm, Yarn and Bun workspace lists, pnpm workspace
  member links, and checkout-local `file:` and `link:` dependencies expose
  manifests to the compiler. TypeScript applies its own package export
  conditions, subpath rules, `main`, `types`, `paths` and project reference
  redirects within the snapshot. The selected module file has an entry edge
  independent of any declaration augmentations. When ESM-mode resolution
  misses an extensionless relative import, the 0.1.0 extension lookup can
  still establish its module-file edge. Named bindings use the checker.
  Calls use the same declaration rule for relative imports, workspace imports
  and local aliases, including when TypeScript selects a `types` export.
- **Library targets:** checker-proven JavaScript or web declarations, captured
  dependency declarations with package evidence, and names directly proved
  by literal outside imports and re-exports. Deno imports use the nearest
  captured map and its applicable scope. A member of an untyped imported
  value or a directly rewritten module member names the package only.
  npm aliases name their registry package. An exact pin in the importing
  manifest or its captured pnpm catalog can supply its version.
  [TypeScript and JavaScript library links](changes/C-11.md)
- **Candidates:** several checkout or library targets for one callee (union
  receivers, merged declarations, duplicate JavaScript functions). Missing
  selected Node types can leave both DOM and Node targets possible for a shared
  global, type name or typed member.
- **Unresolved:** outside members whose receiver or declaration is unverified
  (`external`, `external-package`); computed `require` or `import()` specifiers;
  calls through parameters, import shadows, and reassigned local functions;
  member calls without a named target through `any`, `unknown` or an open index
  (`any-receiver`, `unknown-receiver`, `index-signature`);
  package specifiers whose workspace membership is unreadable
  (`workspace-manifest-unreadable`);
  unavailable Deno import maps, unmapped Deno bare imports and remote URL
  imports (`deno-import-unverified`);
  installed workspace bindings with no captured entry
  (`workspace-entry-unavailable` or `workspace-build-output-missing` when
  TypeScript probed a missing path under a configured output directory).
- **`partial` files** have complete but qualified facts, never syntax errors: an
  `extends` base that was not captured (`incomplete-config`; a package preset
  such as `@tsconfig/node20` leaves most cross-file links unresolved), compiler
  stack limits on some lookups, or `require`/`module`/`exports` uses that cannot
  be decided statically.
- **A program that contains a failed file:** the failed file is absent;
  `invalid-code` with a cause is best-effort attribution. Links computed
  without the failed file carry `assumes: ["no-unseen-declarations"]`.
  A lexical outside binding whose module selection is already established
  by the snapshot can independently prove its written library identity.
- Known limits: JavaScript early errors the compiler does not report without
  `checkJs` (`let let = 1`, top-level `return`) leave a file clean; AMD
  `define(…)` modules are not modelled; module augmentation turns imports of the
  augmented module into candidate sets. Sources: [W2-D](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-D.md),
  [W2-U](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-U.md).

#### Graph commands and the Go toolchain route

`pymtheg graph index|status|search TEXT|symbol SELECTOR|callers SELECTOR|callees SELECTOR|path FROM TO|impact SELECTOR|file PATH|uses UNIT [SYMBOL]`
(`--root`, `--json`, `--no-sync`, `--case-sensitive`, `--include-possible`,
`--depth` default 5, `--limit` default 1,000 and at most 10,000) and the MCP
tools `code_graph`/`graph_result` run the same commands. Every query first syncs
the index with the files by content (`--no-sync`/`noSync` answers from the index
as it is, with stale-file warnings); `status` never indexes. A selector is a
`symbol:` ref, an exact name, a recorded qualified name or `path:line[:column]`;
a selector that selects nothing returns up to five near matches, never selected.
Callers' class counts are totals whatever the limit: `definite` and
`candidateSet` are exact; `unresolved` (possible callers) is counted up to 1,000
or the limit, whichever is larger; `countsTruncated` marks that there are more
than that bound, so `unresolved` is a lower bound. `uses UNIT [SYMBOL]` lists
the project links whose target, or one of whose candidates, is library unit
`UNIT` (any ecosystem) or exactly `SYMBOL` in it, with exact `library` and
`candidateSet` counts (MCP: action `uses`, `query` the unit, optional `symbol`).
It finds only stored library targets: unresolved links may hide more uses. The MCP form, its
selector forms per language and its limits are in [the code guide](code-guide.md).

**Go toolchain route (opt-in, decision D17).** With the key
`"graph": {"toolchain": {"go": true}}` added to the existing
`.pymtheg/settings.json` (which must keep its `version: 1` and `scenarios`; a
file holding only the `graph` key is unreadable and the route stays off with a
`settings-unreadable` warning; full example in the
[code guide](code-guide.md#the-go-toolchain-route)), or an absolute path to the
`go` to trust instead of `true`, indexing also runs that `go` (`go list` and a `go/types` helper) in a
closed environment with network, cgo and telemetry off, and merges its facts:
it can upgrade unresolved or candidate links to definite, confirm source-only
links or verify candidate sets; such links carry `decidedBy: "toolchain"`.
Every answer reports `toolchain.go.state` (`used` with counts, `unavailable` with
the reason, such as no `go.mod` at the project root, `go.work`, no `go`, or Go
older than 1.22; `not-indexed`). Turning it on or off makes the next query sync.
No MCP tool changes this setting; edit the file. Sources:
[W3-L](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W3-L.md), [W3-L2](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W3-L2.md).

#### Not built yet

Toolchain-backed Rust links (`cargo`/`rustc`; investigation
[W2-L](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/W2-L.md)), `go.work` workspaces in the Go
toolchain route, the join with model declarations, the explore query, a Studio
screen for the graph, and Lua.

#### Requirement ↔ code-symbol links (R1-D)

Implemented: `pymtheg link` creates planning records and links them to Go, Rust
and TypeScript/JavaScript graph symbols. A link stores the symbol's language,
project-relative path, kind, scoped identity, ordinal and a source fingerprint in
shared planning data, and records history. States are computed against the synced
graph: `ok`, `changed`, `moved` (only with established continuity: the
recorded file gone, and identical text at a single new path that held no
same-name symbol before; never when identical copies existed at link time),
`missing` (with suggestions, never applied) and
`unverifiable` (failed file named). `link check` exits 1 on `missing`,
`changed`, `unverifiable` and `moved` (unless `--allow-moved`). The fingerprint
covers the symbol's text plus Rust outer `#[...]` attributes and Go `//go:` /
`//export` directives above it (not doc comments), and ignores only line endings
and trailing spaces. Project databases wait up to 30 s
for another writer's lock. A link identifies a symbol by project-relative path +
qualified name + kind and verifies it by the text fingerprint. Identical text
with that identity at the recorded path is the linked symbol (`ok`), whatever
file it came from. Also built: requirements touched by a
symbol or file (optionally through definite callers), and unlinked requirements
and public symbols. The MCP tool `requirement_links` runs the same functions; the
first planning write (CLI or MCP) in a project that was never initialised
initialises it as `pymtheg init` would (R1-J). Not yet built: `.pym` declaration
links, Studio display, carrying links in archive bundles,
comment- or format-insensitive fingerprints, and safe concurrent first-time graph
indexing. Source: [R1-D](https://github.com/KarlLivesey/pymtheg/blob/main/docs/changes/R1-D.md).

## Architecture and interactive authoring

Implemented: lossless retained text-document imports, supported function/type
catalogue navigation, native requirement/decision/risk/component/milestone/test/
evidence records, cross-record links, named immutable revisions, content search,
revision comparison, selected-revision export/reimport and agent read access.
Record search covers complete supported planning and catalogue records, retained
heading sections and source-contract records, including text after 64 KiB.
Older retained indexes rebuild from the originals without rewriting history.
Unknown foreign fields remain in original documents. Foreign type semantics and
recorded implementation/review statuses are not checked `.pym` evidence.

Implemented: direct deterministic input trials, real lost-ack retry recipe,
argument/outcome-aware call snippets, Find/bracket assistance and interface
scaffold preview. Trials refuse nondeterministic choices; use simulation for
those. Raw recipe previews are templates; saved/published source uses the real
formatter. Browser controls do not execute production effects.

Planning records preserve their own acceptance criteria and evidence notes;
automatic implementation conformance, arbitrary document schema import adapters,
semantic search, multi-user merge and cloud synchronisation remain outside the
current local workspace. Complete revisions are durable; live analysis models
remain bounded and may require rechecking after restart.

Working-tree authoring additions after the fourteenth review freeze: guided
cross-file type selection and new finite event-model declaration forms are
implemented, with source/API/MCP checks and passing Chromium, Firefox and
WebKit journeys recorded in the fourteenth follow-up. They were not part of
that frozen review. Later operation-rule controls have separate validation.
Event models support Bool/Nat/Int state, explicit finite numeric bounds,
simultaneous updates and safety invariants. Blank expressions remain unknown.
Creating a model or passing local checks does not establish behavioural safety.

Foreign architecture JSON numbers that are nonintegral, exceed safe integer
representation, or are negative zero are shown as `$exactNumber` literal records.
This preserves their source value without pretending the host number type is
exact. Original documents remain unchanged and exportable. This display encoding
is separate from `.pym` mathematical integers and compiler semantics.

Architecture review fixes in progress: source-scoped merge/refresh and reviewed
Studio import commits preserve native plans; record/document edits rebase across
unrelated changes. Same-target conflicts remain explicit. Index v5 includes
foreign type-reference impact with incomplete-coverage warnings; Studio pages
its impact lists and MCP accepts a record-kind filter. Closed legacy WAL backups
can be browsed without writes; an active legacy WAL needs checkpointing first.
These changes do not close every finding in the independent architecture review.

Index v8 provides linkable Markdown sections and supported catalogue routes,
replicated commands, review findings, profiles and release status. It retains
unsupported fields in source documents. Native planning gaps and changed linked
contracts can be inspected in Needs attention; unrelated revision changes do not
by themselves invalidate evidence. Portable history archives include named
revisions, deduplicated text and an unfinished draft, within a 64 MiB transfer
limit. Neither imports nor status labels establish semantic correctness.

Architecture refresh supports explicit per-document conflict review (keep current,
use incoming where safe, keep both), hash-bound choices and source relocation by
retained ID. Automatic semantic merging and concurrent separate native drafts
remain unsupported. Imported/native planning coexistence retains duplicate IDs
as conflicts; it never invents an ID rename to make the index appear clean.

Fourth-review refinements: storage v5 provides durable local sequence order and
explicit parent lineage for new checkpoints; old histories retain unknown lineage.
Portable v2 archives preserve branches, validate parents and reject cycles.
Unchanged imports retain identical content identity; keep-both tracks the upstream
copy across later refreshes. Renamed headings cannot acquire identity just because
their body text matches another section; explicit anchors support planned renames.

The component builder supports records, lists, named outcomes, success/error
Results, named reuse and declared effects (20 inputs/effects, 20 fields/outcomes,
depth 5 and 128 type nodes per input/output). Generated source is checked normally.
Studio/MCP can select user-registered language targets at launch. Plugin policy
confirmation remains a claim; arbitrary language correctness is not established.

Planning-heavy impact uses set membership to avoid repeatedly searching all
planning consumers. Historical evidence review retains only the linked target
hashes from each baseline, while preserving unknown, unscoped and stale states.
Neither improvement adds a semantic cache or changes the evidence judgement.

Go outputs map leading-underscore source declarations and fields to exported
identifiers, with collision-safe names. Their symbol metadata remains linked to
the original source declarations. The generated contracts are checked from an
independent consumer package as well as from inside their own package.

Continuing interface forms now edit checked signatures and shared record/outcome
fields, preview affected files/consumers and preserve handwritten bodies. Pending
edit forms survive a server restart. New components may reuse types from a
checked import closure through explicit imports, including through MCP. Unfinished new-component wizards also survive restart, including partial field
values. Automatic source refactoring remains outside the editing subset.

Routine identical source refreshes do not consume history checkpoints. Explicit
named saves still do. Native-link-breaking CLI imports require explicit acceptance;
unique unchanged Markdown file moves preserve heading targets. Separate saved
branches remain visible from the active head; importing history does not merge
its decisions. Plugin API/target/extension are checked at registration in a bounded
owned process; output correctness still belongs to the chosen emitter.

Studio local checks and MCP's default `check_design` use related scope: the
selected import closure and discovered reverse importers. Unrelated invalid
files do not poison these results; discovery limitations are visible warnings.
MCP also offers explicit `entry` and `project` scopes. The source policy in
`.pymtheg/settings.json` controls discovery (`sources.include` / `sources.exclude`).
Evidence/research and Rust target/Go vendor directories are excluded unless explicitly included. Include patterns with known directory prefixes prune unrelated trees.
Selected analysis is bounded to 2,048 files / 8 MiB; Studio's separate 10,000-path
inventory loads larger files on demand. MCP interface metadata uses relative
file/symbol IDs, paged search and on-demand definitions.

Storage v6 retains branch-review acknowledgements against specific checkpoints.
A reviewed tip is still a separate branch, not a merge; a new remote tip requires
review. Unknown legacy lineage is listed separately. Link review covers content
as well as titles. Shared type edits retain interior comments above the rewritten
type with a placement notice. Local source and MCP evidence remain unchanged by
those authoring actions until a new check is requested.

New history and selected-revision exports use format v3 with locale-independent
content checksums. Old history v1/v2 imports preserve IDs and validate the recorded
manifest. Legacy databases missing the new checksum remain readable with a
provenance warning if their old locale ordering is unavailable. Old bundle v1/v2
checksums use their originating locale; re-export as v3 before moving non-ASCII
bundles across locales. Source text and checkpoint IDs are retained.

Guided input metadata is limited to 512 expanded nodes per shape and 8,192 per
Studio run, with resolved-type reuse. A larger shape remains valid source when
supported by the language, but its form is explicitly unavailable. Metadata
preparation yields to cancellation. Completion uses resolved type identity;
unsupported display shapes do not make unrelated arguments compatible.

Output has `stubs` (default fail-fast) and `contracts` modes. Contracts mode emits
TypeScript/Go interfaces or Rust traits for separate implementation files.
Versioned manifest comparison reports declared-interface changes independently
of source coordinates and bodies. CLI, Studio and MCP share this boundary.
Plugins must confirm contracts mode; unsupported emitters fail explicitly.

Storage v7 adds auditable branch acknowledgements, optional reviewer/notes and
withdrawal. Imported v1–v6 stores remain readable; writable migration keeps original
bytes and marks old reviews unattributed. Archive merges preserve withdrawals.
Architecture overview contains review counts; detail pages contain at most 50
records. MCP offers `branches` and `branch_reviews` sections with normal paging.

MCP project inventories are paged by inventoryId; large configuration is exact
JSON text in Unicode-safe character pages. Long scenario-name previews are marked
truncated. Contract baselines with errors/omissions require --allow-incomplete;
comparison against an incomplete baseline remains incomplete.

Related checks separate selected entry/import results from consumer evidence;
Studio displays an Affected callers group and MCP has consumer_findings and
consumer_properties pages. CLI --check-scope selects entry (default), related or
project. Root sources are inventoried before deeper folders. Any discovery
warning marks interface impact previews incomplete.

`import-architecture --preview --format text` provides a human-readable path,
conflict and identity summary. JSON remains the default for compatibility.
Contract comparisons follow unique kind/name declarations across file moves;
ambiguous names remain unmatched. Rich output tests compile against real pinned
num-bigint 0.4.8 in addition to TypeScript and Go. Saved-form merging includes
parameter order, which can affect every caller.

## Ninth-review follow-up boundaries

MCP architecture search returns revision-pinned pages (up to 50 matches), total
and continuation. Property/trace provenance is project-relative, while original
model values remain exact. Markdown review ignores CRLF and prose wrapping in
mixed documents; code interiors remain sensitive. Edited moves offer explicit
repair candidates and never infer identity from a matching title alone.

## Retained-document reader (post-tenth candidate)

Markdown has a formatted view using CommonMark/GFM, with escaped HTML and no
automatic image requests. Internal links select retained documents in the same
revision; absent targets and unsupported protocols remain visible. Exact source
and full downloads preserve original text. Rendered previews stop explicitly at
128,000 UTF-16 units; exact-source pages use the common Unicode-safe pager. This
view is not interpretation or verification of document claims. Unit/render checks
pass; the browser journey awaits the independent review's shared browser release.

Budget comparisons are pointwise over the same nonnegative input variables. A
symbolic total remains available when the numeric maximum is unknown; an unresolved
budget produces K006 and incomplete evidence rather than a pass. The polynomial
comparison has caps of 128 terms, degree 16, 64 work alternatives and 100,000 total
arithmetic operations per analysis. It can prove coefficient-dominance and bounded
upper differences, and tests a bounded set of corner assignments for violations.
These are comparisons of abstract work bounds; feasibility of an overapproximated
path is not inferred. An exceeded upper bound is an inconclusive, unvalidated
budget finding with a path-feasibility obligation; it still fails acceptance.
It is not labelled a complete executable counterexample. The budget is never added
to work.

## Native plans linked to checked source

Plans can link project-relative `.pym` declarations through `source:file#name`.
The GUI offers checked source choices, retained/current source, dependency-change
review and navigation back to the source editor. Agents use `read_architecture`
sections `source_contracts` (paged metadata) and `source_contract` (bounded source
preview), including before any architecture has been saved. Reads never create
a database. Source links and per-plan expectations persist through restart.

For inventories above 2,048 files, select an explicit source file or linked
components; checks cover their import closures. A single review supports at most
500 selected source roots in one canonical snapshot, subject to the existing
2,048 loaded-file and 8 MiB source limits. Larger scope is refused, never reported complete.
Catalogue pages are snapshot-pinned and full source previews are explicitly
bounded. Source analysis is owned by a cancellable worker. Unknown/missing source
and changed dependencies remain separate planning issues, not failed proofs.

Source-linked plans now support explicit replacement after a component rename or
move. Suggestions use the captured source catalogue and never automatically
establish identity. A user compares old/new source, chooses the replacement and
saves against an exact source/dependency witness. Partial catalogues cannot claim
to list every possible replacement. Linked local import forks independently
monitor their tracked upstream document; acknowledging a relationship does not
merge its text or refresh evidence.

Output documents and plugin mappings use project-relative identities. Rust name
normalization preserves already-valid identifiers before allocating alternatives.
Non-actionable repeated-call observations are informational; warning severity is
reserved for a supported stability-based opportunity to investigate reuse. Both
remain heuristic evidence, not proof of an optimization.

## Post-twelfth evidence corrections

Contract exports preserve exact/upper cost quality, stability, atomicity, fresh creation and resource transitions. Expression comparison ignores syntax-only whitespace/comments/parentheses while retaining values and grouping. Recovered files contribute to standalone output roots. Trial responses preserve interpreter assumptions on successful and unresolved outcomes. None of these changes increases the set of proved claims. The focused GUI tests for assumption display and input-edit cancellation now pass; broader GUI validation remains pending.

## Existing-code observation (first slice)

`observe FILE.ts... --root PROJECT --label VERSION --out GRAPH.json` captures
selected TypeScript/JavaScript files with the real TypeScript parser and symbol
resolver. It does not execute their code. Sources, hashes, declaration spans,
body categories and resolved/unresolved edges form a portable content snapshot.
Syntax errors and unresolved relationships stay explicit; unsupported languages
are not treated as empty graphs. Git commit/dirty metadata is recorded when
available. `--retain` stores a named immutable observation in architecture history;
the graph views and explicit bindings described below use these observations.

## Visual blocks (initial working editor)

Studio's Blocks mode edits loop/retry bounds, call inputs, conditions, results,
local values, rule expressions and open questions in the same `.pym` buffer as
Text. It adds questions, decisions, loops, returns and component calls; moves and
removes steps with keyboard-accessible controls. Inputs/outputs use the existing
interface form. Calls offer complete declared-outcome handlers, yes/no decisions
and compatible result forwarding. Inserted decisions retain explicit questions.
Unanswered call inputs show their question as a placeholder while retaining the
exact unknown in source. Explicit buttons offer type-compatible local inputs;
the resolver scans at most 256 names and returns at most 20 suggestions. Limited
search is labelled, and choosing a name never bypasses ownership checks.
Resource cards show initial/cleanup states and allowed transitions; existing
creation, transfer and state-change steps have editable fields. A destination
list shows declared states, not proof that a transition is legal. The checker
still checks each path. Lifecycle previews show up to 40 items per list; state
selectors show up to 100. Larger definitions remain available in Text with notices.
The step menu creates declared resources and inserts state changes using the
canonical block scope (up to 100 resources, with exact totals). Cancellation
starts with an explicit open question. These actions use the shared source,
undo and checker; new work goes before a final return or propagation.
Existing record fields and outcome payloads have editable type cards. Finite
event models expose state types/initial values, event guards/updates and invariant
conditions. These consume the same bounded projection as flow blocks. Numeric bounds have a paired Minimum/Maximum form: unfinished inputs are
recoverable and Apply validates both bounds as one undoable source edit. Changed
states require explicit review/reset; renamed or removed states never inherit
a draft by position. Up to 32 range drafts are retained. A comment embedded
between a minus sign and its digits retains the Text fallback. Adding or
removing event members still requires Text. Existing resource lifecycle definitions can
be edited through their recoverable form.

Comments and unsupported/recovered syntax are retained. New unknowns remain
incomplete design evidence. Reordering carries leading notes with the next step;
removal preserves notes. Changes are drafts until saved. Text and Blocks share
undo and recovery. This is a supported subset, not yet the completed visual
builder required by the enlarged release scope.

## Plan / existing-code comparison (working first slice)

Named TS/JS observations and explicit plan-to-code bindings persist with architecture
history. Studio and MCP page the planned graph, observed graph and structural gaps;
CLI `observe --retain` saves a version. Old code snapshots remain inspectable after a
new capture. A present body is not a verified implementation. An unlinked record,
empty/fail-fast body, changed code/plan, missing covered declaration or unknown
coverage remains distinct. Native observation readers for Rust/Go/Apex and contract
conformance evidence are not delivered by this feature.

Bindings are many-to-many, with up to 20 code declarations per planned record and
100,000 bindings per workspace. Adding or removing a pair preserves other pairs
and earlier checkpoints. New bindings compare design intent separately from
administrative status/review metadata. Legacy bindings retain their previous
comparison semantics until explicitly renewed.

## Post-thirteenth authoring and recovery boundary

Standalone record/outcome forms can add and remove members using the shared
interface spelling/reference policy, preview affected declarations and retain
drafts across restart. Independent member edits merge; conflicting members
require an explicit choice. Create-only root declaration forms and existing
resource editing are available as described below. Finite event creation is
implemented and exercised through restart, counterexample and correction in
the GUI; see the current audit for engine-specific coverage.

Structural Blocks changes pass through the canonical formatter before entering
the shared buffer. Invalid syntax or failed formatting leaves the buffer
unchanged; fields remain available to correct it. A late response cannot apply
after switching editor or changing source. Move/remove/add retains keyboard
focus. Clearing a call input restores an explicit unknown, not a fabricated
value. An existing direct outcome step suppresses duplicate convenience actions;
this is authoring guidance, not outcome-coverage proof.

Implementation file browsing is metadata-only, paged and explicit about limits;
capture is still an explicit read of chosen files. Link drafts retain each
plan's target, reason and original version context separately, with at most 100
unfinished links and 2,000 characters per reason. Recovery never restores the
source-review checkbox. A changed plan/code version still needs fresh review.
Drafts are local recovery state, not saved architecture links or evidence.

## Create declarations in Blocks

**Add to this design** creates components, external operations, record/outcome
types and resource lifecycles in the current file. Shared type spelling,
name-collision checks and signature validation also serve interface edits.
Existing source is retained exactly and additions are formatted. Creation never
replaces an existing declaration, adds an implementation or settles a resource.

Preview and explicit application are separate. Source changes remain unsaved
buffers. One unfinished creation form survives restart, including blank fields;
it is resumed until explicitly discarded or successfully applied. Preview uses
a fresh checked snapshot on resume. Source changes or closing a pending form
invalidate its old preview. Creation has no complete-impact claim for previously
unresolved names.

Forms support at most 20 signature inputs/effects, 20 members per nested data
shape (128 type nodes and five levels), 40 resource states, 80 transitions and
20 constant work summaries. Larger or advanced declarations remain available
in Text; they are not silently truncated. Resource ownership and all caller
effects are still checked by the canonical analyses.

## Searchable retained versions

Plan and code version selectors search all retained checkpoint metadata before
paging, with separate filters and selections. Design changes, captures and link
updates are distinguishable, including duplicate labels. Catalogue changes
invalidate old page cursors rather than silently mixing versions. MCP exposes
the same query/category/selectedId/catalogHash fields. No graph bodies are read
per catalogue row.

New links retain their exact reviewed checkpoint. Older links without that
reference are preserved and labelled unavailable for baseline comparison.
Explicit per-link source/relationship comparison and review controls are
described below. They do not prove code conformance or alter earlier evidence.

### Reviewing linked implementation changes

Implemented for retained TypeScript/JavaScript observations: exact per-pair
review checkpoint, bounded source differences, body category changes, paged
static relationship deltas, readable native plan fields, and explicit guarded
acceptance in Studio/MCP. Legacy or missing baselines are unavailable rather
than inferred; source and relationship comparison do not prove conformance.
Full retained source can be read in pages when a diff is clipped. More language
readers and semantic implementation comparison remain open.

### Existing resource definitions

Studio and MCP now preview edits to states, initial/cleanup states and allowed
transitions of an existing resource. The resource name remains fixed, consumers
are reported, and ordinary ownership checking judges the resulting program.
Source and comments are retained; name migration and automatic rewriting of
state uses are not performed. The form supports 40 states and 80 transitions;
larger definitions explicitly remain available in Text. Unfinished edits use
the shared declaration recovery record and require an explicit choice if the
resource rules changed concurrently.

### Operation-rule authoring follow-up

New operation forms support optional caller preconditions and assumed return
guarantees. Empty added expressions remain unknown; absent rule arrays add no
contracts. Fields are bounded to 20 rules of 1,000 characters per kind, use the
same parser boundary as event-model expressions, and enter the ordinary checked
IR after application. Guarantees are explicit environment assumptions. Source,
MCP and restart tests pass; the operation-rule GUI journey also passes in
Chromium, Firefox and WebKit.
Existing operation rules/work summaries now have a separate recoverable edit form.
Provider/settlement authoring remains outside this creation slice.

### Event-model range violations

A source-replayed event that leaves a declared numeric state range is a design
error (`B011`), with the assigning expression and trace retained. Initial and
intermediate states must be in range; only a source-confirmed final violation
is accepted as this counterexample. Invented values, invalid mappings and
traces continuing past a range violation remain rejected backend evidence.
The existing requirement for at least one declared invariant is unchanged.

### Static CommonJS observation

The TypeScript/JavaScript reader now includes function and arrow assignments to
static `exports.name`, `module.exports.name`, and direct `module.exports` targets.
Their body calls belong to the observed function. Reassigned exports with more
than one possible body remain unresolved rather than selecting a runtime target.
Computed dynamic export names are not invented as declarations. TypeScript
constructor parameter properties count as initialization work even when the
written constructor body is empty. Reader identity is now `typescript-ast/v4` (with the same v3 CommonJS extraction); old
observations stay readable and new extraction cannot reuse a v1 snapshot ID.

### Unanswered authoring type choices (working tree after sixteenth freeze)

New value slots start with a visible type choice instead of assuming Text.
Incomplete selections are recoverable form data; preview rejects them with the
affected input/field name, and no incomplete type syntax is generated. Existing
selected drafts and labelled example templates remain compatible. Source,
recovery and MCP checks pass. Updated creation/restart/keyboard GUI journeys pass, including conflicts with
unanswered saved types. The full newer GUI suite has not yet been run.

The v3 reader additionally observes object-literal arrow/function properties,
including `module.exports = { run: () => ... }`, attributes body calls to that
property and resolves supported consumer calls. Calls through aliases after
CommonJS object replacement can remain unresolved; it does not guess which
runtime object an alias refers to. Existing v1/v2 observations remain readable.

Initial constant values outside a machine state's declared range are local
B012 design errors on the initial expression. The range form warns when proposed
bounds exclude the known starting value; applying the range does not change
that starting value or weaken an invariant.

Existing operation rules and symbolic cost summaries now have guarded MCP and
Studio API previews (`operation` / `preview_operation` in MCP). All other clauses
remain untouched. An embedded comment that would be erased requires Text editing.
The Blocks editor now opens a recoverable rules/work form. Its preview names
affected callers, shows changed clauses and preserves unrelated metadata.
Changes to the operation require explicit review of both source versions; the
form reloads current saved source before comparing. Partial expressions survive
restart, and Apply is one undoable source change. Chromium, Firefox and WebKit
journeys pass, including keyboard focus and 390-pixel layouts.

Unused flow-scope entries no longer erase a separately source-replayed failure.
They are B014 configuration warnings with an incomplete scope result. Other
properties cannot pass while that scope issue remains. Safe graphs with unused
entries and invalid used values are still refused; plain emission publishes no
artifact for the invalid scope.


### Local use of assumed scalar returns (after sixteenth freeze)

Local call checking retains declared scalar result types and narrows an abstract
operation result using supported conjunctive scalar guarantees. A later call's
report carries the upstream assumptions it uses, including through arithmetic
and branch selection. Failed or unresolved preconditions, blocked declarations,
and contradictory guarantees cannot justify that result. Concrete flow guarantees
are not assumed. Unsupported expressions remain pending, never a proof.

V002 reports inconsistent abstract guarantees in the same integer/Bool interval
fragment used for entry feasibility. This does not prove an implementation keeps
any consistent guarantee. The repaired boundary passes 632 local tests and 95 real compiler/backend
integrations, with no skips. All 101 GUI journeys pass in two recorded batches; the only inter-batch
change is a test that now makes the required input-type choice and waits for
its pointer target to be ready. Production files are identical.

### Retained code storage

New code captures share unchanged per-file graph/source blobs between named
versions. Legacy captures remain readable. Architecture documents retain their
4,096 count budget; reserved code parts have a separate 10,000-file budget.
Existing 32 MiB source, AST-work, 16 MiB part, 64 MiB snapshot/history-transfer
and 512 MiB retained-content bounds still apply. Limits refuse new work rather
than delete old versions. CLI/Studio/agent capture receipts report newly stored
and reused bytes including version metadata. The current 1,006-file mixed real
source retention/export probe passes; this is not a guarantee for every corpus
of that file count, since complexity and byte bounds also apply.

### Candidate call arguments and operation clause identity

A mixed safe/unsafe scalar call range can produce a C006 review warning showing
candidate arguments. Candidates are bounded, evaluated against the rule and
explicitly unvalidated for joint source-path reachability. The property stays
inconclusive, including when correlations might exclude the candidate. Unsupported
shapes still show their obligation without invented values. This does not extend
the proof fragment or validate external implementations.

Operation descriptions expose `origins` arrays for caller rules, guarantees and
work summaries. Keep each original index with its edited field; additions use
null. The GUI does this automatically and retains it in drafts. Unknown, reused
or reordered indices are refused. Removing a clause preserves/labels its inline
note, while surviving clauses keep their original source positions. Missing or
renamed operations return a useful conflict; drafts can be downloaded or discarded.

Reader `typescript-ast/v4` adds explicit target origins (project, builtin,
external-package, local-binding, unknown). These labels do not resolve a dynamic
call or establish complete relationship coverage. Old v1/v2/v3 observations remain
readable. New graph pages retain target names/origins and disclose list truncation.
CLI text separates unresolved counts by origin; realistic graphs can still have
partial relationship coverage and exit 2.

### Headless accessibility navigation evidence

A pinned development-only virtual screen reader exercises reading order, modal
isolation, reader-driven edit/preview/apply and focus in the real headless app.
Native browser accessibility trees independently cross-check the modal name and
background exclusion. These simulator/browser-tree checks augment keyboard and
axe tests; they are not native OS-reader or human-user evidence. The headless
policy remains unchanged and the virtual-display exception is not pursued.
Firefox's earlier native crash is diagnosed as failed software-compositor thread
creation under shared resource pressure; capped test-profile pools pass the same
focus journey without changing limits, desktop settings or browser security.

### Eighteenth-review repair boundary

- Early-return guard facts flow into continuation; feasible alternatives join
  conservatively. C006 candidates retain their unvalidated qualification.
- Existing components can edit caller rules, return obligations, budgets and
  input bounds in the recoverable contract form. Operations retain assumed
  guarantees; component guarantees are local proof obligations. Renaming inputs
  warns about unchanged body/rule/bound references before Apply.
- Plan/code graphs include live design-changed/design-unknown flags alongside
  retained-version comparisons and code change/missing/stub states.
- Transitive remote/io TypeScript callables return Promise and default to async
  fail-fast stubs. Pure/local callables remain synchronous. Rust/Go are unchanged.
- Code-reader syntax failures have real line/column locations and unknown body
  status. Per-file declaration/relationship coverage prevents an unrelated failure
  from concealing a deletion in a covered file.
- Code parts use dictionary/tuple v2 storage; legacy forms remain readable.
  Capture AST budgets are 2M–16M visits based on bytes, with per-file limits.
  Code capture uses 512–1024 MiB child-process heaps based on input bytes. The 32 MiB
  source, 16 MiB part, 64 MiB snapshot/archive and 512 MiB retained limits remain.
  Resource exhaustion is explicit; source count alone cannot guarantee completion.
Component work-summary rows edit `overhead`, not abstract-operation `cost`.
They are additional work, while budget rows constrain the calculated total.

### Nineteenth-review repair boundary

Loop variables follow resolved element types; `bound xs <= N` limits a list's
length, not its element values. Scalar count loops use indices 0..count-1 and
respect supported inferred count bounds. Assertions and supported Boolean aliases
refine continuing paths; unsupported relational/structural reasoning stays visible.
Negative constant expressions, reversed comparisons and Boolean alias comparisons
are supported. Disjunction joins retain bounded scalar exclusions conservatively.
An assertion with no feasible continuation emits C008 and an unresolved feasibility
result; the flow cannot silently pass because its remaining calls were unreachable.
C006 has candidate arguments only; C007 is a review warning for an unestablished
caller rule without inferred arguments. Neither is a confirmed counterexample.

Code capture has a 2 MiB per-file read bound and a 32 MiB captured-source budget.
Oversized files are named in discovery warnings and omitted with explicit partial
coverage, reason and observed size. Files known to be oversized are skipped before content reads. No source
content or hash is retained for an omitted file.
Other files are still captured; a partial CLI observation exits 2. Per-file AST and
worker-memory budgets also apply, so the source-byte maximum does not guarantee
that every project fits. The nineteenth review captured a 12.2 MB real corpus and
refused a 17.5 MB one at the bounded heap, with counts and narrowing advice. Those
are corpus-specific observations, not a portable size or timing assertion. Scope
large projects into meaningful captures; prior versions are never evicted to fit.

If the whole-scope code worker exhausts its bounded heap, capture now retries as
sequential whole-file parse partitions of at most 3 MiB (without raising worker
heaps). Their declarations and existing edges share one code version and one graph.
Relationships between partitions remain unknown and are disclosed as partial;
this fallback exits 2. Per-file, AST-work, node/edge, 64 MiB snapshot/archive and
retained-content quotas still apply. Failure or cancellation before retaining the
complete combined result leaves previous versions intact.

Large dictionary parts use an optional compressed v3 envelope. Legacy v1/v2 parts
remain readable. Expansion is limited to the existing 16 MiB per-part bound,
checks its byte count, and refuses nested compression. Compression does not raise
source, graph or archive quotas. A 64 MiB aggregate expanded-part bound is checked
before any decompression. A copied 23,190,539-byte / 1,453-file real corpus
retains 56,045 nodes and 346,449 edges in one partitioned code version; its portable
archive is 38,676,410 bytes and the production query worker reaches its final page.
These are observations for that corpus, not universal capacity or timing promises.

Source-only reviews can clear their source-change queue through the explicit
source review action. It does not clear unrelated evidence or document reviews.
The GUI can create a design in new nested folders on explicit Create/Save.

Folder inventory versions omit private/generated exclusion entries that can vary
between CLI discovery and a native browser folder picker. The preview still lists
the exclusions visible to its transport. A refresh with only this audit difference
preserves the prior inventory bytes; it does not create a planning revision.
Actual documentation changes and explicit source relocation remain visible.


## Twenty-first review: process isolation and import preflight

Code capture owns a bounded child process rather than a worker thread. Input is
per-file JSONL; output is the existing bounded manifest/parts representation.
Cancellation and deadline cleanup own the entire child process group. Native V8
allocation failure triggers bounded sequential partitions without aborting the
caller. Incremental snapshot hashing avoids one aggregate source string. Reader
v6 changes capture identity; old observations remain readable. Partition reader v2
withholds targets whose declaration names occur in multiple partitions, including
ambient/merged globals. All cross-partition relationships remain explicitly partial.

History validation decodes every distinct code document set before commit; bundle
preview applies the same decoder. Hash validity alone is insufficient. Plan-only
metadata and a selected code checkpoint decode independently, so unrelated damaged
legacy code cannot block a new capture or healthy historical read. Existing byte,
count and retention quotas remain unchanged; no data is evicted automatically.

C009 qualifies a violated condition on an unvalidated source path. Branches,
iterations, caller requirements and concrete calls may overapproximate reachable
states; a false condition there is pending, never a complete counterexample.
Abstract operation results retain their explicit assumption provenance. Supported
single-variable affine comparisons refine integer ranges with sign reversal and
floor/ceiling division. Safety established over those conservative ranges remains
valid; no general nonlinear or source-reachability proof is claimed.

Folder discovery excludes dotfile documents consistently across CLI and browser
transports. Hidden content retained by an older folder import is preserved on
refresh rather than interpreted as deleted. Individual explicit file imports and
ordinary document editing remain available. Runtime exclusion metadata is normalized
at every path segment; visible document edits/removals remain reviewable.


## Twenty-second review: source witnesses and capture ownership

Capture now separates the source owner, an IPC-connected supervisor and the parser.
Only the parser performs TypeScript work. The supervisor reaps its process group
and removes the transfer on owner disconnect or cancellation; it stays alive while
the owner reads the completed receipt. Unexpected supervisor exit also triggers
owner-side parser cleanup. New transfers have a small owner marker. Startup cleanup
checks directory ownership, regular bounded marker files and a demonstrably dead
PID; active and unknown legacy paths are never inferred to be removable.

There is no fixed wall-clock capture cutoff. Existing source, AST-work, graph,
heap and storage bounds remain, and users can cancel. Resource exhaustion still
cannot become a successful complete observation. Native allocation failure uses
the existing bounded partition fallback. Reader v7 leaves unresolved computed keys,
mutable callable bindings, callback parameters and dynamic function choices unknown;
TypeScript structural signature compatibility is not runtime target identity.
Partition reader v3 also withholds ambiguous owner-qualified methods.

Contract witness search uses the canonical typed source executor, never reparsing
or running application code. It tries at most 64 source input combinations for a
condition and 64,000 executed source steps per condition, with at most 1,000
steps per trial. Unrelated flows do not share or consume this allowance. A bounded
256-entry replay cache charges cached steps to the same per-condition allowance. Samples include scalar path bounds, source/condition
literals, Booleans and bounded simple compound examples. Unsupported or exhausted
search remains pending. Only a replay that fails the exact call and required
condition promotes a finding to C004/source_replayed with its inputs and assumptions.
It is one concrete counterexample, not proof for every input. A previous assertion
or call failure cannot confirm a later condition. MCP translates only witness
provenance; modelled input values remain exact.

Architecture and Design editor are explicit, idempotent destinations. Connection
labels use retained record/declaration names while keeping stable IDs as data.
Malformed requests remain 400, export quota refusal is 413 with narrowing guidance,
and store contention is 503. Validator locations are retained without raw Zod arrays.


The same bounded replay also confirms return-guarantee failures as C005. Its
finding points to the exact failing guarantee, with source inputs and assumptions;
it does not attribute an unexecuted return to another path's witness. Unreachable
returns remain qualified. A previous failing assertion or call cannot confirm a
return guarantee that execution never reaches.


Report comparisons also inspect session completion, and Studio comparisons inspect
the containing run status. A cancelled typed-only report is incomplete even when
all properties it emitted finished. A missing shared work estimate is reported as
missing comparison evidence, not unchanged work. The investigation journey waits
for exact submitted run IDs and includes coordinator-event-controlled cancellation.

Nested type and recipe forms compose pending accepted edits before a parent
render, preserving a field rename when its type changes next. Committed parent
values and the existing source/conflict checks remain authoritative. The dedicated
pending-render regression exercises the actual form and generated source; this
does not change the supported language or make incomplete designs complete.


## Twenty-fourth review follow-up boundary

Contract witness dimensions follow lexical parameter-use roles, tracking shadowed
loop, match and local bindings. Unused parameters use one representative; input
names and declaration order do not set sampling priority. Search remains bounded
and incomplete. MCP `try_inputs` returns the exact failed call/return span and
condition under `result.violation`; only provenance paths are made relative, and
model values (including fields named `file`) remain unchanged.

Reader `typescript-ast/v9` withholds targets from dynamic destructuring, default
and typed receiver parameters, receiver mutation, repeated `var` declarations,
some CommonJS export aliases and direct prototype mutation. Review 25 found gaps
in reflective and forwarded receiver writes; the v10 boundary below supersedes
those v9 coverage claims. Class-call coverage is qualified by later mutation
and provenance findings, including the review-34 instance-field repair below. This is conservative observation,
not complete JavaScript runtime dispatch analysis. Older graphs remain readable.

New observations retain lexical module bindings and `references` edges. Explicit
implementation reviews save an observed dependency fingerprint, calculated once
per graph through cycle-aware component hashes. Constants and transitively resolved
callees can produce `dependency-changed` even when the linked function's own text
is unchanged. Comparisons include retained dependency source excerpts (2,000
characters per side, first 100 changed dependencies). Captured lexical references
and resolved calls/types are the scope: dynamic, external and cross-partition
relationships remain unknown. Old reviews have no inferred dependency baseline;
a new explicit review starts this tracking. Neither an unchanged fingerprint nor
review acceptance establishes behaviour or conformance.

Architecture index v18 searches decoded field values and full retained source
rather than escaped JSON/schema keys; literal retained-document search remains
separate. v17 bundles remain accepted, and read-only reindexing preserves original
bytes and database contents. Missing architecture revisions/documents return 404;
invalid search bounds return 400. Capture memory attribution requires a native
abort plus a fatal V8 out-of-memory banner. A filename containing `heap` does not
trigger fallback, and an unexplained signal keeps its unknown cause.


### Bounded import recovery and lossless code-part storage

Partition reader v4 resolves explicit named/default/namespace ES module imports
against captured export identities and the complete selected file inventory.
TypeScript's module resolver uses that inventory; no uncaptured file is read and
no application code is executed. Dynamic exported function choices and unobserved
relationships remain unresolved. Import-syntax names are not runtime references.
Recovered targets are checked against a full parse on retained real source.
Other cross-partition relationships remain unknown, so the combined graph stays
partial. Existing source, AST, heap, graph and retained-byte limits are unchanged.

The reader no longer borrows a structurally compatible call signature to choose
a runtime target. Static object destructuring follows the actual initializer;
literal-key methods use their declared property symbol. Unsupported values remain
unresolved instead of borrowing another function's signature.

Code dictionary parts v4 can derive a declaration hash from its exact retained
signature when the hash matches, rather than storing a duplicate digest. Provider
hashes that differ remain explicit. Older v1/v2 and compressed v3 parts remain
readable; the v3 compression envelope can contain one v2 or v4 dictionary part,
never nested compression. The same 16 MiB per-part and 64 MiB aggregate expanded
bounds are enforced before decoding. This is lossless storage, not raised quotas.
Lexical references retain only their first source site per owner/target pair;
call-site counts remain separate from these dependency-pair counts.


Receiver annotations and casts are not runtime target identities. Their method
calls, typed spreads, getter-returned functions, replacement constructors and
virtual/inherited receivers remain conservative where the actual callable cannot
be established. An isolated parse partition does not assume a `this` receiver has
no overriding class elsewhere. Static function initializers and ordinary concrete
object/class calls retain their controls. These limits affect relationship coverage,
not retained declaration/source completeness.


## Review 25: mutation provenance, scoped partitions and witness priorities

The review-25 reader was `typescript-ast/v10`; partitioned captures use
`typescript-ast-partitioned/v5` and dependencies use `lexical-v2`. Imported live
bindings share canonical mutation identities. Captured direct Object/Reflect
mutation APIs, destructuring write targets and writes forwarded through local
helper parameters withhold uncertain callable targets. This is a bounded analysis
of captured syntax, not complete JavaScript alias/escape analysis or execution of
external helpers. Budget exhaustion withholds targets and reports partial coverage.

Namespace constant reads, whole-enum declarations and captured binding writers
contribute dependency evidence. Writer changes retain concrete source excerpts;
module-level writes do not substitute a whole-file hash. Dynamic or uncaptured
writes remain unknown. Mutable exports can retain dependency references without
being recovered as confident call targets across partitions. Type references identify
declarations independently of runtime mutation; they do not establish dispatch.

Private declarations in external modules retain their resolved relationships when
another partition contains a private declaration with the same name. Global scripts
and global/module augmentations retain the ambiguity safeguard. Legacy captures
without scope metadata keep the older conservative treatment. No missing global
or cross-partition relationship is claimed absent. Code dictionary v4 retains the
optional scope flag and omits unused edge slots losslessly; all existing expansion,
heap, source, graph and storage bounds remain unchanged.

Witness dimensions now use canonical self-marked expression contexts, flattening
and sorting Boolean conjunction/disjunction contexts. Numeric and text candidates
are relevant to each input's uses and the target condition. Unused literal lets
no longer fill candidate slots. Lexical aliases/shadowing remain explicit. The
64 examples, 64,000 source steps per condition and 1,000 steps per trial are
unchanged; bounded misses still remain unresolved. Only execution of the original
typed IR at the exact condition confirms a counterexample. The retained fuzz runs
exercise renaming, parameter order, conjunction swaps, unused literal padding and
unrelated earlier flows; they are not a proof of arbitrary program equivalence.

Architecture index v19 includes located planning-schema warnings (first four
fields plus an omitted count). Older indexes rebuild from retained originals
without rewriting them. Explicit unknown implementation and review-history
revisions return 404; the default empty implementation workspace remains empty.
Historical index v18 bundles remain readable.

Captured writes through static imports are retained as explicit provenance across
partitions. Merging withholds calls into the affected exported declaration and
connects its dependency baseline to the captured writer. Top-level write excerpts
remain separate from unrelated module source. Global collision checks remain
conservative; private module names do not become global merely through partitioning.


## Review 26: escaped receivers and canonical source-witness priorities

The review-26 observations used reader `typescript-ast/v11` and partition reader v6.
A receiver that escapes through an array/object container, argument, constructor,
return value or captured `this` write no longer supplies a confident method target.
This is deliberately conservative: even a read-only helper can make its receiver
unresolved unless the reader establishes the binding remains local. Scalar copies
are not object escapes. Passing a callable does not change its direct callable
identity; mutable properties of that callable remain separate. Static direct calls,
ordinary local receivers and unambiguous CommonJS aliases retain controls.
Captured imported escape metadata propagates across partitions without inventing write
provenance. Old observations remain readable. No application code is executed.

This supersedes v10's narrower helper/reflection coverage: v10 did not cover
constructors, destructured/arguments parameters, callback/container propagation
or every Object/Reflect alias. The new boundary is escape conservatism, not an
enumeration claiming complete mutation or JavaScript runtime analysis. Dynamic
and uncaptured relationships remain unknown; source/body presence is not conformance.

Module-level destructured bindings retain their initializer dependencies. Captured
class-static member writers contribute fingerprints and exact retained excerpts.
Linked records state when their declaration has unresolved outgoing calls whose
changes cannot be tracked; that information does not fabricate a changed dependency
or prevent an explicit review of the available evidence.

Witness priorities use canonical atomic comparison contexts, independent of
Boolean nesting, mirrored operand order and negation. Bounded pure-rule expansion
uses resolved declarations from the same typed IR. Shared integer-affine semantics
supplies normalized comparison keys and inverse boundary candidates, including
related-input boundaries. Candidate ranking gives these boundaries precedence
over incidental arithmetic literals. A target-input marker avoids ties with
unrelated earlier calls. Boolean companions and related boundary assignments fit
inside the same 64 attempts, 64,000 source steps per condition and 1,000 per trial.

These transformations affect sampling only: the original typed source executor
must still reach and fail the exact reported call/condition before a finding is
confirmed. No canonicalized guard is substituted into execution or proof.
Rule/context traversal is deterministically bounded; arbitrary logic, large
candidate spaces and exhausted search remain unresolved. The tested invariances
are not a claim of complete semantic equivalence or universal proof.

Canonical witness-context collection permits 12,000 fact visits (depth 32) and
12,000 equation visits (depth 16), with at most eight varying relevant input dimensions.
These are sampling bounds, independent of machine speed; they grant no proof
when exhausted. Related boundary propagation is bounded by those dimensions.
The original 12 numeric choices per input and source-trial limits are unchanged.


## Review 27: classified object uses and resolved guard facts

Reader v12 classifies every runtime expression use: only recognized local reads,
aliases, scalar copies and captured call receivers retain method certainty. An
unclassified object use withholds it. Logical/concise returns, defaults, fields,
yield/template/JSX positions therefore do not rely on a separate escape-position
allowlist. An escaped or patched instance invalidates internal class `this` dispatch;
constructor origins propagate across partitions (v7). This is a bounded, conservative
source reader, not complete JavaScript runtime analysis. Read-only-looking helpers
can still produce unknown targets; unresolved edges are visible on linked records.

Direct require alias paths share captured CommonJS ambiguity checks before cached
resolution. Review 28 found that CommonJS barrels bypassed those checks; the
current boundary and repairs are recorded below.
Older captured graphs remain readable. Destructured initializer calls, literal
static element writes and captured instance-field writers now contribute dependency
evidence. Comparisons show a declaration's own edit when a captured dependency
cycle makes that edit part of its fingerprint, avoiding an unexplained empty list.

Local range refinement now projects bounded resolved pure-rule bodies from the
same typed IR, after checking the rule's own preconditions. It does not reparse or
replace source execution. The existing guard refinement and exact source replay
consume consistent rule meaning. Projections are bounded at 12,000 visits/depth 64;
unsupported or exhausted cases remain unknown. No proof comes from sampling.

Witness search varies at most eight relevant input dimensions, prioritizing the
condition's inputs, and holds other declared inputs at valid representative values.
Unused formal parameters no longer consume that allowance. Context keys are only
built for source-mentioned parameters. The 64 trials, 64,000 source steps per
condition, 1,000 per trial and numeric candidate caps remain unchanged; unsupported
representative values or larger relevant spaces can still leave a bounded miss.

Captured module namespaces propagate escape to exported mutable values, including
anonymous default classes. Whole CommonJS module escapes also invalidate other
require consumers. An escaped import lacking a retained export identity withholds
that source's callables conservatively. Class expressions remain unknown instead
of borrowing an enclosing class's this identity. These limits are independent of
method body presence and remain visible as unresolved relationships.


## Review 28: implicit mutation channels and CommonJS barrels

Reader `typescript-ast/v13` withholds constructor/method certainty for decorated
classes, and decorated members expose their containing class as escaped. This
is conservative: decorators are never executed or assumed to preserve a value.
Methods of a class with a captured class decorator retain references to that
application and its captured decorator dependencies, so decorator-body edits
have retained before/after excerpts even when dispatch is unresolved. External
decorator bodies remain unknown.

Literal dynamic `import()` namespaces (including literal templates) conservatively
expose the captured module's mutable exports, even for a read-only import. This
does not rely on Promise library types: await, then callbacks and destructuring
share the same source identity, and escaped module metadata crosses partitions.
Nonliteral module specifiers are not resolved. No runtime module is loaded.

CommonJS checks follow captured require forwarding through barrel chains and
check the resolved declaration's file before a cached target can be used. Review 29
found a remaining shared-object member-write case in that boundary; the current
qualification is recorded below. Single unconditional callable controls remain. Arbitrary runtime loaders and external
module changes remain unknown, and direct eval is outside static dependency
tracking. Observing a body is not evidence of complete runtime call coverage.

Literal-typed string/number element keys contribute their actual binding writers
to dependency fingerprints. These changes preserve old observations as historical
evidence; they do not retrofit new relationships into them.

Namespace collection includes default-export assignments themselves, recursively
following object/instance values rather than losing unnamed default object
identities. Captured CommonJS namespace escapes invalidate its mutable default
exports object for require consumers; named ES module callable identities remain
distinct from receiver mutability. These are captured-source boundaries, not
runtime loading or a guarantee about arbitrary module specifiers.

Partition reader v8 retains opaque default exports even alongside named exports.
A captured module span is an uncertainty marker for such a value, not a resolved
call/reference target; the combiner uses it to withhold affected methods when
the namespace escapes in another part. This includes API and consumer files
sharing one partition while the patching import belongs to another.


## Review 29: shared CommonJS exports objects and decorator dependencies

Reader v15 records captured whole-module forwarding via literal require calls,
including local variable aliases. A file that both forwards module.exports and
writes one of its members qualifies the shared exports objects in both
directions. This covers direct source consumers and barrel consumers, without
assuming the source contains a second textual write. The analysis is conservative
and flow-insensitive; it does not execute modules or infer loader order. A write
through the detached exports alias is not treated as a write to the forwarded
object. Pure forwarding still has resolved callable controls.

Whole-module alias paths and explicit module-object escape qualifiers are retained
in observation metadata. Partition reader v9 followed that alias closure across
parts for recorded qualifiers. Review 30 found that writes through an out-of-part
require could lack those qualifiers; the v16/v10 repair below closes that gap. moduleObject denotes uncertainty about a mutable
CommonJS exports object, not a confirmed write to every declaration in the file.
Older observations without this optional metadata remain readable. Arbitrary
loaders, nonliteral specifiers and runtime mutations outside captured source
remain unknown.

For a class declaration with captured member decorators, its members retain
conservative references through the class to those decorator applications.
Sibling runtime dispatch remains unresolved, while edits to captured decorator
bodies have exact retained dependency excerpts. Other classes stay separate.
Within the decorated class, a sibling edit may conservatively flag more than
one member. Class expressions remain outside this dependency reconstruction.


## Capture startup cleanup across PID namespaces

Capture-owner markers v2 retain the Linux boot identity and PID namespace as well
as the owner PID. Startup cleanup deletes a marked transfer only when that scope
matches the cleaning process and the owner is absent there. Different namespaces,
different boots, v1 markers without a scope, and unavailable scope information are
preserved. A missing PID in one namespace is not evidence that an owner in another
namespace died. The IPC supervisor still cleans its own transfer on normal close,
cancellation or owner death; scoped startup recovery is an additional safeguard.

Pre-delegation hardening also qualifies assignment to the exports binding in a
whole-module forwarding file. Reattaching exports (including the chained
exports = module.exports = require form) can expose the shared object, unlike
merely writing through a detached exports alias. Pure and detached controls
remain. Earlier thirtieth and browser records remain preserved but superseded;
only the final source fingerprint and thirtieth-final input are authoritative.

Shared-object qualification also propagates uncertainty from reflective writes
and unclassified module.exports escapes through the same alias closure. It is
not restricted to textual member assignments: Object.assign, Reflect.set and
passing the shared object to a helper must qualify direct source consumers too.
The retained probe exposed those neighbours; executable full/grouped/split
regressions cover all three, without resolving uncertain calls.


## Review 30: CommonJS writes outside a parse partition

Review 30 found that v15/v9 dropped a CommonJS write when its required module
was outside the writer's parse partition. The earlier shared-object propagation
claims applied to retained metadata, not all syntactic writes; that gap is fixed
in reader `typescript-ast/v16` and partition reader
`typescript-ast-partitioned/v10`.

Literal require origins retain a resolved source path even when no local
SourceFile exists. The mutation collector retains syntactic write targets without
a TypeScript symbol. CommonJS writes and escapes carry module-object uncertainty;
the merge seeds its shared-object alias closure from both records before recovering
imports. The immediate-require writers tested for review 30 qualified API and consumer
files in another partition. Review 31 found late-assignment and member-forward
gaps plus an unreported resolution cost; the v17/v11 repair below supersedes
that coverage claim.
This is conservative, flow-insensitive uncertainty about shared objects, not a
claim that every member was written. Older observations remain readable.

Regressions execute 28 retained runtime fixtures and check every set partition,
six isolated writer forms and six production fallback layouts. Pure forwarding,
detached exports and unrelated-write full-parse controls remain. Three previously
withheld control fixtures remain withheld. Dynamic/nonliteral loaders and mutations
outside captured source remain unknown; this repair adds no general claim of
cross-partition call-resolution completeness. Partial captures remain labelled.
No Pymtheg language analysis, witness search, evaluator or emitter changed.


## Review 31: scoped CommonJS mutation provenance and stable analysis tabs

Reader `typescript-ast/v17` records all captured literal-require assignment sources,
including late assignments, without treating rebinding a local as a write to its
initializer. Nested access keeps the first exported member. `moduleMemberAliases`
records captured member forwards, and partition reader v11 propagates matching
member mutations through those forwards and whole-module aliases. `moduleObject`
qualifies an actual namespace mutation/escape; `memberObject` qualifies an object
reached through a member. Ordinary reads and passed callable values do not become
whole-file mutations. Unknown exported objects retain conservative method coverage;
file-private helper functions remain separate. Declared classes whose runtime body
is unavailable remain uncertain when their member value escapes; constructor
identity controls for implemented classes remain.

The pinned TypeScript binder's CommonJS source-module symbol supplies export-slot
identities even when getSymbolAtLocation(SourceFile) does not. Nested metadata
follows source object literals, not arbitrary inferred type trees. `commonjsFiles`
and member qualifiers are optional, strictly validated metadata; earlier observations
remain readable. This is bounded, flow-insensitive observation, not runtime dispatch
completeness. Arbitrary or aliased loaders, module.require, eval and uncaptured
runtime effects can leave otherwise static consumer targets resolved. Capturing
such source does not prove their absence or implementation conformance.

Review 31 measured 1,211 lost resolved calls despite equal edge totals. That cost
was omitted from the parent summary. Repair evidence now records resolved-to-
unresolved, unresolved-to-resolved, retargeted and added/removed edges by kind,
plus strict full/split precision on identical real CommonJS scopes and byte groups.
Current numbers live in review-31-follow-up; no blanket claim of zero recall cost.

Analysis tabs precede content that arrives after a check. The contract-regeneration
journey gates the initial report with a readiness handshake and asserts the bar's
position before and after it. The old WebKit assets fail the same assertion by
98 px; focused tests of the new layout pass in both engines. The historical click
failure's exact cause remains unproven. Browser limits and Firefox exclusion remain.

Export metadata uses the reader's deterministic visit budgets. If that pass
exhausts a budget, the file is explicitly listed in optional opaqueExportFiles
metadata with a located diagnostic and partial coverage; its call targets stay
uncertain during partition merging. This exceptional budget state can also
withhold private helpers. Ordinary known export mutations retain their narrower
export-root scope. No wall-clock threshold decides correctness or raises limits.


## Review 32: one qualifier for default and partitioned observations

Reader `typescript-ast/v18` and partition reader v12 share the captured-origin
qualifier closure. Default observations apply it without partition import recovery
or a partition limitation. This closes the tested late-assigned member-holder
write regression and helper/reflective holder neighbours. Direct object-literal
exports retain member aliases, including shorthand properties. These are captured
source relationships, not runtime loader-order or arbitrary alias completeness.

An incomplete origin pass still withholds namespace/import-dependent calls across
the observation, including otherwise unrelated parts, because the missing origin
could write them. Direct same-file lexical function/class/arrow identities remain
when the parser already resolved them; no discarded target is invented. The same
lexical exception applies inside mutable class spans, keeping local functions and
constructors separate from exported object members. Unknown export budgets still
have an explicit partial limitation. The earlier review-31 claim that arbitrary
private helpers survive incomplete-origin merging was too broad.

The single analysis navigation bar now precedes the toolbar and source panes,
including their mobile stacked layout. The controlled initial-report regression
covers 1440, 768 and 390 px in both engines, with pointer and keyboard navigation.
The sealed v17 WebKit assets reproduce a 272 px shift at 390 px; v18 assets keep
the bar fixed. Historical incident causes remain unproven.

Current repair evidence is in review-32-follow-up, including every set partition,
production full/fallback cases, conservative controls and resolved-call deltas.
No language semantics, witness search, evaluator or capture lifecycle changed.


## Review 33: visible mobile activation and explicit default-reader cost

At stacked workspace widths (up to 920 px), activating an analysis tab moves
focus to its named analysis region and scrolls that selected content into view.
Every navigation button identifies its controlled region. Desktop activation
keeps focus on the navigation button. No automatic check or report moves focus.
The initial-report position handshake remains; the 390 px regression additionally
requires visible, focused content for pointer, Enter, Space and the current tab.

Editor type tokens use an explicit darker palette against both plain and active
line backgrounds. The highlight tag dependency is pinned directly at the already
installed version. Accessibility checks now include a separate project whose
first/current line contains Int and Bool at 1440 and 390 px. Connected header
actions wrap within the tablet viewport; 768 px is checked in workspace and
architecture modes, including WebKit.

Reader v18 / partition v12 behavior is unchanged. Shared provenance qualification
can withhold existing full-parser targets, not just partitioned ones. In the
retained public package scopes, default full parsing v17 -> v18 loses 6 resolved
super() calls in ajv (1150 -> 1144) and 69 in Quint (995 -> 926), with no gains or
retargets. These are separate from the combined large graph's +929 calls / 0
losses versus v17. The earlier 429/429 ajv figure compares v18 full and partitioned
outputs on a smaller 64 KiB-group scope; it does not establish zero default-path
cost. Same-file super() is outside the bare-name lexical exception. Captured
links retain their unresolved-call caveat. The inaccurate source comment is fixed.

Other conservative limitations remain: object-literal module holders can withhold
all calls even without a writer, full and partitioned paths can differ on a bare
local callable, and incomplete-origin limitation text can be duplicated. No
confidently wrong target is claimed repaired by these UI-only changes. Current
evidence lives in review-33-follow-up; semantic differential and capture/graph
scale evidence are explicitly carried when the implementation is unchanged.


## Review 34: usable editing surfaces and instance-field provenance

Text editing retains an 18rem minimum (over ten current code lines). Source
panes contain their scroll overflow; stacked rows use natural content heights.
At tablet widths the work area scrolls while navigation/Save stay outside it.
Phone layouts retain page scrolling. Interface guidance is collapsible and its
Edit inputs and output action stays directly available. Header wrapping includes
601–719px; the registered journey sweeps 320–1440px every 20px in workspace and
Architecture, edits at common laptop/tablet sizes with current/expanded hints,
and checks that focused analysis content is not covered by the source pane.

Reader typescript-ast/v19 and partition reader v13 distinguish lexical instance
fields from constructor identity. Known instance-member assignments mark the
actual declarations, including JavaScript synthetic-property cases. A write to
this.x does not itself rebind the constructor. The v19 repair intended to keep unknown keys, reflection, escaped receivers,
static/dynamic this and changed constructor/prototype chains conservative.
Review 35 found cast/constructor-alias gaps in that exception; the v20 boundary
below supersedes this claim. Method dispatch still needs
a stable captured receiver; there is no general runtime dispatch guarantee.
Declaration-budget incompleteness qualifies namespace provenance; independent
local targets survive, while incomplete files cannot supply definite targets.

Fresh full-parse v18 -> v19 call changes on identical scopes: own src +9/-0;
ajv +105/-16; Quint +58/-1, with zero retargets. The losses are super calls newly
withheld by constructor-chain uncertainty. Large partitioned capture gains 1,256
calls and withholds 35, with zero retargets;11 edges disappear and130 appear, and
57 binding nodes are added. Every call change is retained with its source span.
All 1,256 gains agree with separate full parses: 1,181 single-file and 75 cross-file
contexts (including full ajv for 24 unresolved reduced-context cases). An initial
whole-package diagnostic exceeded its memory bound; the refusal is retained.
The earlier ten residual same-file super calls still remain unknown.

On identical 64KiB groups, full/split resolved calls are ajv 447/447, Playwright
client 268/268 and utils 655/655, with zero invented/conflicting targets. These
counts are scope-specific and do not establish complete coverage. The actual
refund regression now has constructor, cancelValue and refund dependencies and
flags the fee change. 23 runtime/dependency regressions accompany this boundary.

Info findings retained: an MCP race loser can receive SQLite's busy message
while store integrity remains protected; WebKit's native selection can paint
type tokens at4.31:1 despite the higher plain/current/finding-line palette.
Object-literal holder over-qualification, conservative full/split differences,
duplicate limitations and earlier documented semantic limits remain.

The final constructor-return guard also covers unnamed default-exported and expression classes using the class type symbol. A constructor returning a different object cannot lend its original method target. Two additional runtime controls cover TypeScript and JavaScript. The initial thirty-fifth seal is preserved as superseded evidence; the corrected review input is thirty-fifth-final.


## Review 35: conservative write provenance and bounded comparison working sets

Review 35 found wrong positive method targets in v19. Its earlier claim that
constructor/prototype mutations always stay conservative was too broad. Reader
`typescript-ast/v20` / partition reader v14 require positive instance-member
classification before exempting a receiver from class uncertainty. Casts,
non-null and satisfies wrappers share instance-origin unwrapping. Constructor,
prototype/destructuring controls covered the retained v20 cases. Review36
found remaining assignment-only containers and subclass-to-base gaps; v21 below
supersedes the broader inherited/container claim. Twenty-one negative runtime controls include the thirteen reported
regressions, an older destructured-constructor case and seven adjacent shapes.
These checks establish those captured-source cases, not arbitrary dispatch
completeness. A positive computed-receiver control also prevents unrelated
function identities from being discarded. Instance-origin scanning is cached by
source node; an interrupted walk clears its cache before propagating the budget
refusal. Known scalar instance-field initialization still keeps constructors.

Nested type editors now send edit functions to one owning draft. No nested
per-editor pending ref is reset from a potentially older parent prop. Recipe,
declaration, signature and shared-type forms compose accepted edits from that
owner's latest value. A deterministic stale-parent control reproduced the exact
Quote -> Outputsuccess loss with the old source and preserves Quote with the
new source. This establishes the lost-update mechanism; the precise scheduling
of the original registered WebKit failure remains unconfirmed.

Comparison decoding preflights all part hashes and expansion bounds, then
validates one part at a time. Assembled graph provenance/count checks reuse
validated objects rather than cloning all nodes and edges again. After full
validation, comparison retains the selected declaration's entire dependency
closure and direct relationships as an internal working set; graph paging,
retained observations and exported history keep the complete graph. Fingerprint,
cycle, dependency-excerpt and whole-comparison equivalence regressions cover this
projection. Exact path/text-identical documents can share a decoded graph;
matching revision IDs alone cannot bypass decoding or tamper checks. Production
workers retain the 512 MiB cap. Diagnostic hooks report decoded graph counts and
phase heap observations, and tests can only lower the cap. Heap samples are
observations, not proof that every accepted graph fits within the cap.

The editor precedes supplementary actions and interface guidance. Short desktop
layouts compact the mode selector. The header journey now measures viewport and
ancestor clipping, not only editor height: ten lines on tested default desktop
screens down to 600px height, and ten lines after reaching the scrollable stacked
editor. It also checks expanded hints and analysis occlusion. Smaller physical
viewports still require scrolling; no universal minimum visible-line claim.

The earlier instance-field regression count was 23, not 21. Review-35 evidence,
failed/insensitive diagnostics and subsequent checks live in review-35-follow-up.
Known semantic, conservative graph, SQLite-busy and native-selection limitations
remain. No manual-later project pilot or real-software descriptor test was started.


## Review 36 repair: inherited prototype uncertainty

Reader `typescript-ast/v21` and partition reader v15 retain `inheritanceOrigins`
for captured classes and class-valued bindings. Escaped/mutated subclass values
qualify their captured bases transitively, including bases imported in another
parse partition. ES re-export forwarding is retained separately as
`inheritanceForwards`; it qualifies class chains and does not turn ordinary
function exports into writes. Local source initializers, later assignments and
binding elements feed the cached instance-origin scan. Constructor/prototype
values escaping through containers retain the receiver's uncertainty.

The 38 review-36 runtime cases are regressions, checked in full parsing and every
set partition in both merge orders. Existing instance-field and stable-call
controls remain. Optional provenance survives retained storage/history and has
identity validation. This is conservative source observation; dynamic loaders,
uncaptured runtime mutation and implementation conformance remain outside it.
Older observations stay historical and are not rewritten.

Routine saves update the reserved file-state slot instead of inserting a notice
above the editor. It preserves an explicit Unsaved state for newer buffered edits
and announces successful saves when the workspace is active. Short stacked
701–920px screens up to650px high use page scrolling so the text area can be
reached without clipping. Registered layout checks measure actual visible lines
before and after real saves, including1024x600 and720x500. Errors and recovery
notices still retain their own messages.

See review-36-follow-up for final validation, resolution costs and preserved
failed checks. Review36's eight9.5 areas remain the latest independent result;
graphs are awaiting a focused repair/sign-off recheck. No new project pilot,
theoretical descriptors or exploratory audit has been started.

Final review-36 repair validation: the 2,107-file corpus loses four resolved
calls in Playwright sw.bundle.js inside escaped-base-class scope; zero
calls are gained or retargeted. Scoped full src/ajv/Quint have zero
resolution changes. All 38 reported wrong targets are withheld, and
established acceptance checks pass. Exact deltas and checks are in
evidence/product-audit/review-36-follow-up/validation.json. Independent
sign-off is pending; unchanged reviewed areas carry review36 evidence.
