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
| Import of a path under a project module (`go.mod` module path, nested `go.mod`, local `replace … => ./dir`) | **Definite** to the package symbol |
| Directory with two importable package names | Candidates (package symbols) |
| Standard library, third-party, non-local `replace`, missing directory | Unresolved, import path kept in `targetName`/`data.path` |
| Import of `…/internal/…` from outside the internal parent's tree | Unresolved (illegal in Go) |
| Import of a `package main` directory, or of a `testdata`, `_x` or `.x` directory | Unresolved |
| `pkg.F`, `pkg.T`, `pkg.V` through a project import, including an alias | **Definite** (exported names only) |
| Same, by the original package name while aliased, or an unexported name | Unresolved |
| Dot-import names | **Definite** (exported only) |
| Method call `x.M()` where x's type is syntactically evident: declared `var x T`, typed parameter, receiver, `T{}`/`&T{}`, `new(T)`, `x.(T)`, `x := pkgVar`, a field of known type, the result of a project function or method with a declared result type, a conversion `T(v)` | **Definite**, including promotion through embedded project types (shallowest depth) |
| Two promoted methods of that name at the same depth | Candidates |
| Method expression `(*T).M` / `T.M`, method value `x.M` | Definite (`references`, and `calls` when the local holding it is called) |
| `x.M()` where x's type is an interface declared in the project | Candidates: the interface method plus `M` on every structural implementer. Unresolved when no implementer exists in the project or there are more than 20 |
| `x.M()` where x has no evident type (range variables, `:=` from a func value, anonymous interface parameters, map/slice elements) | Candidates: concrete `M` methods in the caller's package and every project package it transitively imports (exported names only across packages). Unresolved if there are fewer than 2 or more than 20 |
| `x.M()` where x's type is known but external (`bytes.Buffer`, `error`, an embedded `sync.Mutex`) | Unresolved (no project candidates offered) |
| A local shadowing an import or function (`fmt := printer{}`, `helper := func(){}`) | The local wins. Methods on its evident type resolve; calling a func-valued local is unresolved |
| Builtins (`len`, `append`, …) | Unresolved, `data.builtin: true` |
| Implicit interface satisfaction | **Definite** `implements` link when the type's method set (own methods plus methods promoted from embedded project types, value or pointer) has every interface method with an identical canonical signature. Named types are compared by package import path, so `io.Reader` and a local `Reader` differ |
| Interfaces that embed an external interface, are generic or are constraints | No `implements` links (their method set is unknown or not a method set) |
| Struct embedding, type references, receiver types | **Definite** for project types. External types unresolved |

### Not extracted (documented scope, not dropped evidence)

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
  underlying struct (`type A B`).
- Generic type arguments are not tracked: `Stack[int]` methods resolve on `Stack`.
  Calls through type-parameter-typed values are candidates/unresolved like other
  unknown receivers.
- cgo (`import "C"`) is an ordinary unresolved import. Vendored directories are
  indexed as source files, but imports are not resolved into `vendor/`.
- `go.work`: `use` directives are read, but every `go.mod` in the snapshot defines
  a module whether or not it is used.

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
   instead of asserting an empty list.
2. **No multi-file symbol.** A Go package spans several files, but a symbol lives
   in one file with one range. Instead, the package symbol is hosted in a
   deterministic file. Consequence: adding a file that sorts before the host (or
   deleting the host) moves the package symbol, so its ID changes and incoming
   import links retarget to the new ID on the next index.
3. **A single unproven possibility cannot be recorded.** Candidate sets need at
   least two IDs. When exactly one project method could be the target of an
   unknown-receiver call, the link stays unresolved: the module will not promote
   it to definite.
4. **Candidates cannot say "or something outside the project".** For an
   unknown receiver, the real target may be an external type's method (for
   example `err.Error()`). The candidate set lists project methods only. The
   interface has no flag for "possibly none of these". This limitation is stated
   here instead.
5. **Resolution cannot annotate parsed links.** The reason a link is unresolved
   (internal-package violation, builtin, external type, over the candidate limit)
   is only in the module's logic. `resolve` cannot add `data` to parsed links. Only
   builtins are flagged, because that is known at parse time.

## Observations on a real project

restic at `c734245f` (shallow clone in scratch; no source copied):
`evidence/w2-b/restic.md` and `evidence/w2-b/restic-summary.json`.
