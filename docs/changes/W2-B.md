# W2-B: Go language module for the code graph

Mega-plan item 4.3 (S22). One new folder, `src/graph/languages/go/`, built only
against the frozen W1-C interface. No core file, CLI, MCP or Studio file changed;
nothing is wired into a command. No Go toolchain is used or needed: parsing uses
the installed `tree-sitter-go` 0.25.0 WASM grammar through the shared helper
(`createTagsParser`), and nothing shells out to `go`.

Done-when ("restic indexes; direct calls and imports resolve across files"): see
`evidence/w2-b/restic.md`. Every restic-internal import resolves, and direct
calls resolve across files and packages.

## Module shape

| Part | File | What it does |
| --- | --- | --- |
| Claims | `index.ts` | `*.go` (including `_test.go` and build-tagged files). Context: `go.mod`, `go.work` anywhere. |
| Parse | `extract.ts` | One Tree-sitter parse per file. The helper is given a minimal query; the module walks the whole borrowed tree in `secondPass` and stores only JSON facts. |
| Analyze | `index.ts` | Hosts exactly one `package` symbol per (directory, package clause name). See "Package unit" below. |
| Resolve | `resolve.ts`, `gomod.ts` | Go's scoping and import rules over the captured snapshot and `go.mod`/`go.work` text. Adds `implements` and package→file `contains` links. |

The parser is one process-wide reusable instance (the WASM grammar loads once).
It is never disposed, because the module object lives as long as the process.

### File facts

Each file has a `file` symbol whose `data` records `package`, `test` (`_test.go`),
`build` (the `//go:build` expression, or `+build …` for legacy lines) and
`goos`/`goarch` inferred from `_os`, `_arch` or `_os_arch` filename suffixes.
Test files and build-constrained files are indexed like any other file and are
told apart by this data and by their file. External test packages (`package foo_test`)
are separate packages.

Build constraints are **not evaluated**. All variants take part in resolution. When
two variants declare the same name (`f` in `x_linux.go` and `x_windows.go`), a
reference to it becomes a candidate set of all of them, never a pick.

### Symbols and identity scheme

| Kind | Identity (position-independent) | Range |
| --- | --- | --- |
| `file` | basename | whole file |
| `package` | package clause name | package name in the host file |
| `function` | name (`init` repeats get ordinals 0,1,… from core) | declaration |
| `method` (concrete) | `(T).M` or `(*T).M`; generic receivers drop type arguments (`(*Stack).Push`) | declaration |
| `method` (interface) | `I.M`, `data.interface: true` | method element |
| `struct`, `interface`, `type` (defined), `alias` | name | type spec |
| `field` | `T.f`; an embedded field is `T.Embedded` with `data.embedded` | name to end of field |
| `var`, `const` (package level) | name (blank `_` is not a symbol) | name to end of spec |

Generic functions and types have `data.generic`. Interfaces that contain type-set
elements (unions, `~T`) have `data.constraint`. Locals, parameters and type
parameters are not symbols.

### Links

| Kind | From → to |
| --- | --- |
| `contains` | package → each file of the package (added during resolution); file → top-level declarations; struct → fields; interface → its methods |
| `imports` | file → package symbol of the imported directory |
| `calls` | enclosing function/method/var → function, method, type (conversion), func-typed var/field |
| `references` | type references; package-level identifiers used as values; `x.f` selections whose base is not an untyped local; method values and expressions |
| `receiver` | method → its receiver type |
| `embeds` | struct/interface → embedded type |
| `implements` | named type → interface, added during resolution (`data.structural: true`, `data.pointerReceiver` when only `*T` satisfies it) |

Calls inside package-level `var` initializers come from that var. Calls inside
function literals come from the enclosing top-level declaration.

## What is resolved

"Definite" means a single `targetId`. "Candidates" means two or more possible
targets, never a guess. "Unresolved" keeps the target name.

| Construct | Result |
| --- | --- |
| Call/reference to a package-level name in the same package, any file | **Definite**. Candidates when build variants declare it more than once |
| Same, from a non-test file to a declaration in a `_test.go` file | Unresolved (Go hides it) |
| `_test.go` (same package or external `_test`) reading test-file declarations in the same directory | Definite |
| Import of a path in the importing file's own module (nearest `go.mod`), or in any module `use`d by a `go.work` that lists it | **Definite** to the package symbol |
| Import of a path covered by a local `replace … => ./dir` in the importing file's own `go.mod` (or its `go.work`, which wins) | **Definite** to the package in the replacement directory. A version-specific `replace path vX => ./dir` applies only when the captured `go.mod` (every `go.work` main module that requires it) requires exactly `vX`. Otherwise, including when no requirement is captured, it is not applied, because the selected version is not established. An unversioned `replace` applies to all versions |
| A directory mapped through one module that actually belongs to a nested `go.mod` (`example.com/m/sub` when `sub/go.mod` exists) | Unresolved (it is another module's package) |
| Another project module reached without `replace`/`go.work` | Unresolved (Go would take it from the module cache, possibly another version) |
| Directory with two importable package names | Candidates (package symbols) |
| Standard library, third-party, non-local `replace`, missing directory | Unresolved, import path kept in `targetName`/`data.path` |
| Import of `…/internal/…` from outside the internal parent's tree | Unresolved (illegal in Go) |
| Import of a `package main` directory, or of a `testdata`, `_x` or `.x` directory | Unresolved |
| `pkg.F`, `pkg.T`, `pkg.V` through a project import, including an alias | **Definite** (exported names only) |
| Same, by the original package name while aliased, or an unexported name | Unresolved |
| Dot-import names | **Definite** (exported only). With an external dot-import, an otherwise unknown exported name is treated as external |
| A qualifier `q` in `q.T`/`q.F` that is neither local, nor package-level, nor a project import | External: unresolved with the name kept, never project candidates. In Go such a qualifier can only be one of the file's imports. Project imports are matched by their real `package` clause name, so no package name is ever guessed from an import path to decide project versus external (`github.com/minio/minio-go/v7` is `minio`, `gopkg.in/yaml.v3` is `yaml`) |
| Method/field selection `x.M` where x's type is syntactically evident: declared `var x T`, typed parameter, receiver, `T{}`/`&T{}`, `new(T)`, `make(T)`, `x.(T)`, `x := pkgVar`, a field of known type, the result of a project function or method with a declared result type, of a value of a literal func type (`func() T`) or of a **named** func type (`type mk func() T`, read from the type's declaration), of the builtins `new(T)`, `make(T, …)` and `append(s, …)` (only when no declaration shadows the builtin; otherwise the declared function's result), a conversion `T(v)`, an element/key of a written slice/array/map/channel type (`range`, `x[i]`, `<-ch`), a type-switch variable in a case with exactly one type | Go's selector rule (below) |
| Type-switch variable `switch v := x.(type)` | Per case clause: one type → that type (external → unresolved, project → resolved by the selector rule); several types, `nil` or `default` → the switched operand's own description |
| Calling an element of a function container: `handlers["a"]()`, `fns[0]()` | A `references` link to the container plus an **unresolved** `calls` link (`targetName` `handlers["a"]`). The functions stored in a literal initialiser are not tracked as candidates. `F[int](x)` (explicit instantiation, same syntax) calls `F` definitely |
| **Selector rule** (members, `implements`, dispatch): own fields/methods at depth 0, then promoted members breadth-first by embedding depth, counting every embedding path | Exactly one path at the shallowest depth: **definite** (candidates if that declaration has build variants). Several paths (including the same method reached via two embedded types): **candidates** of the distinct declarations, unresolved if they are one declaration. A field at a shallower or equal depth shadows or ambiguates a method of that name |
| An embedded type outside the project (or not resolvable) at a depth at or above the first project match | Unresolved: the external type may declare or shadow the name |
| Unexported field/method selected from another package (including an external `_test` package), directly or promoted | Not visible: unresolved (Go treats it as a different identifier) |
| Method expression `(*T).M` / `T.M`, method value `x.M` | Definite (`references`); `calls` on a local that holds it see "reassigned locals" |
| A local holding a function or method value | **Definite** when never written after its declaration. When written again (`=`, multi-assign, `:=` redeclaration, inside a closure): **candidates** of all values ever assigned if each is a known function/method; unresolved if any is unknown, if its address is taken, after `op=`/`++`, after a `range`/receive `=` assignment, for parameters (incoming value unknown) and for assignment cycles (`f, g = g, f`) |
| `x.M()` where x's static type is an interface declared in the project | Candidates: the interface method plus `M` (by the selector rule) on every project type, in any package and test files included, that implements the interface or cannot be refuted as an implementer. Open (`data.open.reason: "external-implementers-possible"`) unless the interface has an unexported method (see "Candidate sets: closed or open"). When an implementer's `M` is itself an embedded interface's method, that is expanded in turn (it is already covered when it is the method being dispatched). Unresolved when no implementation is known, when a needed interface's implementations cannot be established (it is generic or embeds an external interface), or over 50 (`data.overflow`, never truncated) |
| Interface method value assigned to a local and later reassigned (`f := i.M; f = a.M; f()`) | Each interface method among the values expands to its dispatch set before combining, so no implementation is omitted. Unresolved if any part is unknown |
| `x.M()` where x's type is a type parameter with a single named project interface constraint | The same interface dispatch on the constraint (the constraint method is always among the candidates). Unresolved for `any`, unions, inline constraints and constraint-less receiver type parameters |
| `x.M()` where x has no evident type: ranging over or indexing a **named** project container type (`type List []T`), anonymous interface or struct types (`[]interface{ Close() error }`, a field of type `struct{ sync.Mutex; … }`), results of builtins other than `new`/`make`/`append`, values from dynamic code (`reflect`) | Name-only candidates: every concrete project method named `M` that a value could carry, in **any** package, test files included. An unexported `m` is taken only from the caller's own package, because elsewhere it is a different identifier. Always open (`data.open.reason: "receiver-type-unknown"`). Unresolved with fewer than 2; over 20: unresolved with `data.overflow` (never truncated) |
| `x.M()` / `x.f` where x's type is known to be external: parameter, field, variable, result or composite literal of an external type; result of calling an external function or method (`os.Open`, `context.Background`, `errgroup.WithContext`); element of an external container; a predeclared type (`error`) | Unresolved, name kept; never project candidates |
| A local shadowing an import or function (`fmt := printer{}`, `helper := func(){}`) | The local wins. Methods on its evident type resolve |
| Builtins (`len`, `append`, `new`, …) | Unresolved, `data.builtin: true`, set only when no package-level declaration visible to the caller shadows the name. A user-declared `new` or `len` is resolved to that declaration without the flag, and a test-file declaration shadows only for that package's test files. The flag is recomputed by `analyze` on every index, so it follows shadowing declarations added or removed in other files |
| Implicit interface satisfaction | **Definite** `implements` link when every interface method is selected uniquely (selector rule) as a method with an identical canonical signature. An unexported interface method keeps its declaring package through embedding (`type J interface{ p.I }` with `p.I{ hidden() }` needs `p`'s `hidden`, never `q.hidden`). An interface's method set merges identical methods inherited along several paths (`L{J; K}` with `J`, `K` both embedding `I`); the same method with different signatures makes the interface unsatisfiable, so it gets no links. Cycles are detected per embedding path. `data.pointerReceiver` is set when only `*T` satisfies it: a pointer-receiver method counts for the value `T` only when reached through an embedded `*E`. Named types are compared by package import path |
| Interfaces that embed an external interface, are generic or are constraints | No `implements` links (their method set is unknown or not a method set) |
| Struct embedding, type references, receiver types | **Definite** for project types. External types unresolved |

### Not extracted (documented scope, not dropped evidence)

- **Declarations containing a syntax error** (Tree-sitter ERROR or missing nodes
  anywhere inside them) keep their symbol, `contains` and `receiver` links, but emit
  no `calls` or `references` links: their identifiers cannot be bound reliably.
  Top-level ERROR fragments emit nothing. The file stays `partial`.
- References to predeclared types (`int`, `string`, `error`, `any`, …) and
  predeclared values (`nil`, `true`, `iota`). Conversions to predeclared types
  (`string(b)`) are not calls. A package that redeclares one of those names is
  not followed.
- Keys of keyed composite literals (`T{Field: v}`): the composite type is often
  not known.
- Field/method selections on locals without an evident type, except calls (calls
  always get a link). For a selector, only the full expression is linked. The base
  identifier `pkg` in `pkg.F` is not linked separately.
- Calls of function literals (`func(){}()`).
- Functions stored in map/slice/array containers are not tracked: calling an element
  is an unresolved call (see the table).
- tree-sitter-go reads `new(` as the builtin's syntax. A user-declared `new` called
  with a non-type argument (`new(1)`) therefore misparses, and its declaration
  yields no call/reference links (the file is `partial`).
- Local declarations (variables, local types, labels) as symbols.
- Struct fields of anonymous struct types, and fields of a defined type's
  underlying struct (`type A B`); element types of named container types.
- Generic type arguments are not tracked: `Stack[int]` methods resolve on `Stack`.
- Type aliases are not expanded when comparing method signatures for
  `implements` (a missed link, never a wrong one; backlog).
- cgo (`import "C"`) is an ordinary unresolved import. Vendored directories are
  indexed as source files, but imports are not resolved into `vendor/`.

## Package unit

A Go package is a directory's files sharing a package clause. The interface has
per-file symbols only, so the `analyze` phase hosts ONE `package` symbol per
(directory, name). The host is the first file by path among clean non-test files,
then partial non-test files, then test files. The package symbol has
`data.directory` and (for non-`_test` packages under a `go.mod`) `data.importPath`.
Resolution adds `contains` links from it to every file of the package.
`analyze` is idempotent: it strips the previous host symbol before re-adding it,
and it returns only files whose facts changed.

## Interface gaps

1. **Core test A10 forbade any production language. Resolved on `main` (PR 15).**
   A10 now checks that production discovery omits test-only modules instead of
   requiring an empty list. With this branch merged, the whole suite passes.
2. **No multi-file symbol.** A Go package spans several files, but a symbol lives
   in one file with one range. Instead, the package symbol is hosted in a
   deterministic file. Consequence: adding a file that sorts before the host (or
   deleting the host) moves the package symbol, so its ID changes and incoming
   import links retarget to the new ID on the next index.
3. **A single unproven possibility cannot be recorded.** Candidate sets need at
   least two IDs. When exactly one project method could be the target of an
   unknown-receiver call, the link stays unresolved: the module will not promote
   it to definite.
4. **Candidates cannot say "or something outside the project".** The core's
   candidate model has no "possibly none of these" state. The module records it
   itself: `data.open` (written by `analyze`) marks every set that may omit a target
   outside the project. See "Candidate sets: closed or open". A consumer must read
   `data.open` before treating a candidate list as exhaustive.
5. **Resolution cannot annotate parsed links.** `resolve` cannot add `data` to
   parsed links, so the reason a link is unresolved is mostly only in the module's
   logic. Two reasons are recorded. Builtins are flagged at parse time. Over-cap
   candidate sets are recorded by `analyze` (see "Candidate caps"), which may
   replace a file's facts and runs on every index. The other reasons
   (internal-package violation, external type, nothing found) are not recorded.

## Candidate sets: closed or open

Every candidate set is one of two kinds. A **closed** set contains every possible
target. An **open** set contains every possible target that is in the project, but
the true target may also be outside it. `analyze` writes `data.open = {reason}` on
open sets (the same mechanism as `overflow` and `builtin`); closed sets have no
`open`.

| Kind of set | Contains | Closed or open |
| --- | --- | --- |
| Build variants (a name declared in several build-constrained files) | Every declaration of the name visible to the caller | Closed |
| Ambiguous selector (several embedding paths at the shallowest depth) | The distinct declarations reached | Closed (Go rejects the program) |
| Interface dispatch (`x.M()`, `x` of a project interface type; also type-parameter constraints) | The interface method, plus `M` on every project type (any package, test files included) that implements the interface **or cannot be refuted** as an implementer. A type is not refuted when every interface method is either matched or possibly supplied by an external embedded type at the deciding depth (for example a test mock embedding `sync.Mutex` and a project interface). Only proven implementers get definite `implements` links. Expanded through implementers that hold an embedded interface | **Open, `external-implementers-possible`**, when a type outside the project could satisfy the interface: all of its methods, including embedded ones, are exported, or its method set is not fully known. Also open when an implementer's method comes from an embedded interface that is open, and when a possible implementer's `M` itself may come from an external embedded type. **Closed** when the interface has an unexported method, because only its own package can implement it, unless an expansion opens it |
| Reassigned function/method values | Every value ever assigned, each interface method expanded to its dispatch set | Closed, unless an included dispatch set is open |
| Name-only (receiver type not evident) | Every concrete project method of the name a value could carry: any package, test files included; unexported names only from the caller's package | **Always open, `receiver-type-unknown`**: the value may be of a type outside the project |

Precision trade-off: because external types' method sets are not in the graph, a
project type that embeds an external type (for example `io.ReadCloser` or
`sync.Mutex`) cannot be refuted as an implementer of an interface whose other
methods it lacks. It joins those dispatch sets, with only its own declared method,
and the set is open. Sets can therefore list types that a compiler would rule out,
but they never omit a project type that can be the target.

Dispatch and name-only sets use the same rule for test-file and cross-package
methods: both include them (a test binary can pass any project type, including one
from a `_test.go` file, through an interface or an untyped value). The
"declared in a `_test.go` file is visible only to test files" rule applies only to
naming a declaration (identifiers, selectors on known types), never to which
dynamic type a value can hold.

Over a cap, any kind of set becomes unresolved with `data.overflow` and no `open`
(the cap rules are below).

## Candidate caps

| Decision | Cap | Over the cap |
| --- | ---: | --- |
| Interface dispatch (interface method plus every structural implementer's method; also type-parameter constraints) | 50 | Unresolved, `data.overflow = {candidates: N, cap: 50}` |
| Name-only guess for an unknown receiver (methods of that name in reachable packages) | 20 | Unresolved, `data.overflow = {candidates: N, cap: 20}` |
| Build variants, ambiguous selectors, reassigned function values | 20 | Unresolved, `data.overflow = {candidates: N, cap: 20}` |

Two conditions hold and are tested in `test/graph-go-review.test.mjs`:

1. **Never truncated.** A set over its cap becomes a wholly unresolved link with its
   `targetName` kept and no candidates. The module never returns a partial list,
   because a partial list could omit the true target. Under the cap the complete set
   is listed.
2. **The reason is visible.** `data.overflow` on the link records how many possible
   targets there were and the cap. An agent can therefore tell "too many candidates"
   (`overflow` present) from "nothing found" or "external" (no `overflow`).

How the reason is recorded: `resolve` cannot write link data (gap 5), so `analyze`
runs the same resolver over the snapshot with provisional IDs, finds the
over-cap links and writes `overflow` into those files' facts. `analyze` runs on
every index and first strips any previous `overflow`, so the note follows changes
in other files. The test adds methods in another file, takes an unchanged file's
link over the cap, and then removes them again. The note never affects which target
is chosen: `resolve` computes the same decision independently.

## Module version 2 (first review)

The first review found confidently wrong links and candidate sets missing the true
target. All of them are fixed, with positive, negative and ambiguous regressions in
`test/graph-go-review.test.mjs`:

1. Reassigned function and method values: locals are tracked as bindings with
   every write.
2. Promoted method sets: the breadth-first selector rule, with ambiguity and field
   shadowing.
3. Embedding-path multiplicity.
4. External embedded types at or above the match depth.
5. Embedded `*T` read from the grammar's sibling `*` token.
6. Imports resolved in the importer's module, `go.work` and `replace` context, with
   nested-module ownership.
7. Package visibility of unexported members.
8. Values known to be external, including the audit of parameters, fields, results,
   ranges, assertions, conversions and composite literals.
9. Type-parameter receivers.
10. No call/reference links from declarations containing syntax errors.

Two design consequences:

- Embedded project interfaces now promote their methods, as Go does, so wrapper
  structs (for example restic's backends embedding `backend.Backend`) implement the
  interface.
- Interface dispatch therefore has its own candidate cap of 50. Unknown receivers
  keep 20.

The module version is 2, so cached version-1 facts are re-parsed. Version 3 adds
the overflow note (re-review conditions on the candidate caps).

## Module version 4 (second review)

Each fix has positive, negative and, where relevant, ambiguous regressions in
`test/graph-go-review2.test.mjs`:

1. Unexported interface methods keep their declaring package when method sets are
   flattened and compared.
2. Interface method values in reassigned locals expand to their dispatch sets.
   Dispatch also expands implementers whose method comes from an embedded interface
   (the same bypass one level down), and implementations are taken only from
   interfaces whose method set, and therefore implementer list, is complete.
3. Version-specific `replace` directives.
4. Interface method sets merge identical inherited methods, with cycle detection per
   path. The selector rule treats an interface's method set as flat. A project
   declaration of a name is selected even when an embedded external interface
   might also declare it (identical methods merge). Only a name the project does not
   declare is unknown.
5. Type-switch variables typed per case clause.
6. Unmatched qualifiers are external.
7. Element calls are not calls of their container.
8. `builtin` is set only when the builtin is called. `analyze` derives it from the
   stable parse fact `builtinName`.

Found during the restic re-run and fixed:

- My first version of the per-case type switch linked each case type twice (it
  compared Tree-sitter node wrappers by identity). Regression: "each type in a
  type-switch case is linked exactly once". A restic-wide check now finds no
  duplicate links.
- My first version of the flat interface lookup also treated a project interface's
  own methods as unknown when it embedded an external interface.

The module version is 5.

## Module version 6 (third review)

Regressions are in `test/graph-go-review3.test.mjs`.

1. Candidate sets say whether they are closed or open (above). Name-only sets now
   come from every package, test files included, instead of the caller's import
   closure filtered by test-file naming visibility. Dispatch and name-only paths
   agree on test-file and cross-package methods.
2. A builtin's result type (`new`, `make`, `append`) is decided at resolution, only
   when no declaration shadows the builtin. Otherwise the declared function's result
   is used, for package-level shadowing in any file and for local shadowing.
   Shadowed builtins whose results the module never types (`len`, `min`, …) use
   the declared result as any call does.
3. Versioned `replace` directives are checked against the version Go selects, the
   maximum required version across the build's main modules (every `use`d module
   in a workspace). An unparsable version means selection is not established, so
   the dependency is unresolved.
4. Named func types: `type mk func() T` records its result types, so calls through
   values, fields and parameters of that type are typed.
5. Predeclared values (`nil`, `true`, `false`, `iota`) are never extracted, in type
   positions either (`case nil:`).

The module version is 6.

## Core after PR 11 (W2-I)

The branch is merged with `main` after PR 11 (the linear-time core, on-disk schema
3). No module change was needed:

- The stricter conformance kit re-indexes every sample source with a blank line
  inserted at the top and requires unchanged symbol IDs. It passes with no
  `identityEditExclusions`, because Go identities hold no offsets: package and
  file symbols use names, and methods use receiver-qualified names.
- restic now indexes in 15.6 s, and an unchanged re-run takes 6.7 s (observations;
  see `evidence/w2-b/restic.md`), with identical results.
- Graph databases from before schema 3 must be rebuilt.

## Observations on a real project

restic at `c734245f` (shallow clone in scratch; no source copied):
`evidence/w2-b/restic.md` and `evidence/w2-b/restic-summary.json`.
