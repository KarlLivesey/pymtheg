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
| Import of a path covered by a local `replace … => ./dir` in the importing file's own `go.mod` (or its `go.work`, which wins) | **Definite** to the package in the replacement directory |
| A directory mapped through one module that actually belongs to a nested `go.mod` (`example.com/m/sub` when `sub/go.mod` exists) | Unresolved (it is another module's package) |
| Another project module reached without `replace`/`go.work` | Unresolved (Go would take it from the module cache, possibly another version) |
| Directory with two importable package names | Candidates (package symbols) |
| Standard library, third-party, non-local `replace`, missing directory | Unresolved, import path kept in `targetName`/`data.path` |
| Import of `…/internal/…` from outside the internal parent's tree | Unresolved (illegal in Go) |
| Import of a `package main` directory, or of a `testdata`, `_x` or `.x` directory | Unresolved |
| `pkg.F`, `pkg.T`, `pkg.V` through a project import, including an alias | **Definite** (exported names only) |
| Same, by the original package name while aliased, or an unexported name | Unresolved |
| Dot-import names | **Definite** (exported only). With an external dot-import, an otherwise unknown exported name is treated as external |
| Method/field selection `x.M` where x's type is syntactically evident: declared `var x T`, typed parameter, receiver, `T{}`/`&T{}`, `new(T)`, `make(T)`, `x.(T)`, `x := pkgVar`, a field of known type, the result of a project function, method or func-typed value with a declared result type, a conversion `T(v)`, an element/key of a written slice/array/map/channel type (`range`, `x[i]`, `<-ch`) | Go's selector rule (below) |
| **Selector rule** (members, `implements`, dispatch): own fields/methods at depth 0, then promoted members breadth-first by embedding depth, counting every embedding path | Exactly one path at the shallowest depth: **definite** (candidates if that declaration has build variants). Several paths (including the same method reached via two embedded types): **candidates** of the distinct declarations, unresolved if they are one declaration. A field at a shallower or equal depth shadows or ambiguates a method of that name |
| An embedded type outside the project (or not resolvable) at a depth at or above the first project match | Unresolved: the external type may declare or shadow the name |
| Unexported field/method selected from another package (including an external `_test` package), directly or promoted | Not visible: unresolved (Go treats it as a different identifier) |
| Method expression `(*T).M` / `T.M`, method value `x.M` | Definite (`references`); `calls` on a local that holds it see "reassigned locals" |
| A local holding a function or method value | **Definite** when never written after its declaration. When written again (`=`, multi-assign, `:=` redeclaration, inside a closure): **candidates** of all values ever assigned if each is a known function/method; unresolved if any is unknown, if its address is taken, after `op=`/`++`, after a `range`/receive `=` assignment, for parameters (incoming value unknown) and for assignment cycles (`f, g = g, f`) |
| `x.M()` where x's static type is an interface declared in the project | Candidates: the interface method plus `M` (by the selector rule) on every structural implementer. Unresolved when no implementer exists; over 50: unresolved with `data.overflow` (never truncated) |
| `x.M()` where x's type is a type parameter with a single named project interface constraint | The same interface dispatch on the constraint (the constraint method is always among the candidates). Unresolved for `any`, unions, inline constraints and constraint-less receiver type parameters |
| `x.M()` where x has no evident type: ranging over or indexing a **named** project container type (`type List []T`), anonymous interface types (`[]interface{ Close() error }`), results of builtins other than `new`/`make`/`append`, values from dynamic code (`reflect`) | Candidates: concrete `M` methods in the caller's package and every project package it transitively imports (exported names only across packages). Unresolved with fewer than 2; over 20: unresolved with `data.overflow` (never truncated). **These are the only candidate sets that may omit the true target**: the value can be of an external type whose method is not in the graph |
| `x.M()` / `x.f` where x's type is known to be external: parameter, field, variable, result or composite literal of an external type; result of calling an external function or method (`os.Open`, `context.Background`, `errgroup.WithContext`); element of an external container; a predeclared type (`error`) | Unresolved, name kept; never project candidates |
| A local shadowing an import or function (`fmt := printer{}`, `helper := func(){}`) | The local wins. Methods on its evident type resolve |
| Builtins (`len`, `append`, …) | Unresolved, `data.builtin: true` |
| Implicit interface satisfaction | **Definite** `implements` link when every interface method is selected uniquely (selector rule, as seen from the interface's package) as a method with an identical canonical signature. `data.pointerReceiver` is set when only `*T` satisfies it: a pointer-receiver method counts for the value `T` only when reached through an embedded `*E`. Named types are compared by package import path |
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

1. **Core test A10 forbids any production language.**
   `test/graph-review.test.mjs` A10 runs `discoverLanguages()` from a scratch
   directory and asserts its output matches `/\[\]\ntoy/`. That means the
   production module list must be empty. With this chunk the output is
   `[ 'go' ]\ntoy`, so A10 fails. The test file is core, not owned by this chunk,
   and was not edited. The Rust and TypeScript chunks will hit the same failure.
   Suggested fix (manager): assert that `toy` is absent from the production list
   instead of asserting an empty list. The manager is fixing it separately (PR 15).
2. **No multi-file symbol.** A Go package spans several files, but a symbol lives
   in one file with one range. Instead, the package symbol is hosted in a
   deterministic file. Consequence: adding a file that sorts before the host (or
   deleting the host) moves the package symbol, so its ID changes and incoming
   import links retarget to the new ID on the next index.
3. **A single unproven possibility cannot be recorded.** Candidate sets need at
   least two IDs. When exactly one project method could be the target of an
   unknown-receiver call, the link stays unresolved: the module will not promote
   it to definite.
4. **Candidates cannot say "or something outside the project".** Receivers known
   to be external are unresolved, never candidates. But a receiver whose type is not
   evident at all (the "no evident type" row above) may still be an external value.
   Its candidate set lists project methods only, and the interface has no flag for
   "possibly none of these". That row is the only place this applies.
5. **Resolution cannot annotate parsed links.** `resolve` cannot add `data` to
   parsed links, so the reason a link is unresolved is mostly only in the module's
   logic. Two reasons are recorded. Builtins are flagged at parse time. Over-cap
   candidate sets are recorded by `analyze` (see "Candidate caps"), which may
   replace a file's facts and runs on every index. The other reasons
   (internal-package violation, external type, nothing found) are not recorded.

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

## Observations on a real project

restic at `c734245f` (shallow clone in scratch; no source copied):
`evidence/w2-b/restic.md` and `evidence/w2-b/restic-summary.json`.
