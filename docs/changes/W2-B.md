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
| local/anonymous type (`data.local`; any type kind) | `<file>:<enclosing>.<name>` for a function-local type, `<file>:<enclosing>.struct#<n>` for an anonymous struct type that embeds something; `#2`, `#3`, … for a repeat in the same file. Unique per package | the type spec / struct type |
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
| Import of a path covered by a local `replace … => ./dir` in the importing file's own `go.mod` (or its `go.work`, which overrides the modules' replaces of that path) | **Definite** to the package in the replacement directory when the directory is proven. The selected version is the maximum the main modules require. A version-specific `replace path vX => ./dir` of the selected version wins over an unversioned one, whatever their order. A version-specific replace of another version does not apply. The selected version is **not proven** when no main module requires the path, when a version cannot be parsed, or when another captured `go.mod` requires a higher version (the main requirement may then be stale). In that case every replacement that could apply is a **candidate**: both directories are kept and none is definite. Without an unversioned replace, the package may come from the module cache, so the import stays unresolved |
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
| Implicit interface satisfaction | **Definite** `implements` link when every interface method is selected uniquely (selector rule) as a method whose signature is proven identical by Go's type identity (see "Type identity"). An unexported interface method keeps its declaring package through embedding (`type J interface{ p.I }` with `p.I{ hidden() }` needs `p`'s `hidden`, never `q.hidden`). An interface's method set merges identical methods inherited along several paths (`L{J; K}` with `J`, `K` both embedding `I`); the same method with different signatures makes the interface unsatisfiable, so it gets no links. Cycles are detected per embedding path. `data.pointerReceiver` is set when only `*T` satisfies it: a pointer-receiver method counts for the value `T` only when reached through an embedded `*E`. Named types are compared by package import path |
| Interfaces that embed an external interface, are generic or are constraints | No `implements` links (their method set is unknown or not a method set) |
| Struct embedding, type references, receiver types | **Definite** for project types. External types unresolved |

### Not extracted (documented scope, not dropped evidence)

- **Declarations containing a syntax error** (Tree-sitter ERROR or missing nodes
  anywhere inside them) keep only their symbol, `contains` and `receiver` links. They
  emit no `calls` or `references` links, because their identifiers cannot be bound
  reliably, and nothing recovered from them is trusted:
  - a **type** declaration (struct, interface, defined type, alias), and every local
    or anonymous type inside an erroneous declaration, gets `data.broken`. No fields,
    no `embeds` links, no interface methods and no underlying type are emitted.
    `view()` treats its structure as **unknown**: it cannot be ruled out as an
    implementer, no definite member lookup or `implements` is built on it, an
    exported one may carry a hidden method (so sealed sets stay open), and a
    dispatch set it could belong to is open, unless its membership is proven by
    the methods declared on the type itself at depth 0. (`savePacker`, with every
    method declared on itself, keeps its set closed.) An open set then lists every
    accessible project method of that name, because the lost structure could
    promote any of them. A broken spec in a `type ( … )` group makes its intact
    siblings in that group unknown too. This is accepted: it is safe, and it is
    limited to the group;
  - a **function or method** whose header (anything outside its body: receiver,
    parameters, results, type parameters) contains an error gets `data.broken`
    and no signature or result types. Its results type no values. A broken method
    is not a member anyone resolves to; it is a possible candidate. Its file is
    declaration-lossy, so its receiver's method set is unknown (layer 1, below).
    An error only inside the body keeps the header trusted;
  - a **`var`/`const`** spec with an error has an unknown type;
  - an **import** spec with an error is dropped. If the import declaration has an
    error, unmatched qualifiers in that file are unknown rather than external,
    because they may name a lost project import.

  What a broken file costs its package, and what is read back from the text of
  what tree-sitter could not keep, is in "Declaration-lossy files" below. The file
  stays `partial`.
- Uses of the real predeclared identifiers: types (`int`, `string`, `error`,
  `any`, …), values (`nil`, `true`, `false`, `iota`) and builtin functions used as
  values. Conversions to predeclared types (`string(b)`) are not calls. These names
  can be redeclared, and one mechanism covers all of them. Extraction records each
  use that no local binds as a stable parse fact (`data.go.predeclared`). On every
  index, `analyze` turns a use into a `references`/`calls` link
  (`data.predeclaredName`) only when a package-level declaration visible to that
  file shadows the name; a `_test.go` declaration counts only for that package's
  test files. Locals shadow as usual (not linked). Resolution likewise treats a
  predeclared type as the builtin type only when no package declaration shadows it,
  in variable types, method lookup and `implements` signature comparison. Calls of
  builtin functions are always linked, with `builtin: true` only when unshadowed.
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
- Local variables and labels as symbols. Function-local type declarations **are**
  extracted (every kind, as `data.local` symbols), and so are anonymous struct types
  that embed something, with their fields.
- Fields of anonymous struct types that embed nothing (for example test tables), and
  element types of named container types. Fields of a defined type's underlying
  struct (`type A B`) are not separate symbols, but member lookup, promotion and
  method sets follow them through `view`.
- Generic type arguments are not tracked: `Stack[int]` methods resolve on `Stack`.
- Type aliases of literal or generic types are not expanded when comparing
  signatures. The comparison is unknown, so this can miss a link but never
  makes a wrong one (see "Type identity").
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

## Type identity

Signatures are compared by Go type identity (spec, "Type identity"), in one
canonical form used everywhere types or signatures are compared: `implements`,
method-set matching (`hasMethod`), and merging interface methods inherited along
several paths.

- **Extraction** writes each signature as a structural term (`TypeTerm`):
  parameter and result types expanded to their arity at every depth, names
  dropped, the final `...T` marked variadic.
- **Resolution** binds the term to declarations (`identity`).
- **Comparison** (`identical`) answers *identical*, *different* or *unknown*. A
  difference anywhere is proven difference. Otherwise anything unknown leaves
  the answer unknown.
- **Unknown** never gives a definite `implements`. It never refutes a member
  either: the type stays a possible implementer, listed in dispatch sets.

| Identity rule | This form |
| --- | --- |
| Grouped parameters and results expanded to arity, at every depth | Exact |
| Variadic `...T` is not `[]T` | Exact |
| Parameter and result names ignored | Exact |
| Channel direction | Exact |
| Array length | Exact for integer literals (by value: `4` = `0x4`). Any other constant expression is **unknown** (not evaluated, never compared by spelling) |
| Struct field names, order, embedded-ness, tags | Exact. A tag compares by its string value: raw literals exactly, interpreted literals decoded for `\"`, `\\`, `\n` and `\t`; any other escape makes the tag unknown |
| Unexported field and interface-method names | Exact: qualified by the package of the file that writes the literal |
| Interface type sets | Exact for method sets: order ignored, embedded interfaces (literal or named project interfaces) expanded. Unions, `~T` and other type-set elements are **unknown** |
| Type parameters | Deliberately **unknown** (not compared by position). A method naming its type's parameter never proves or refutes `implements` |
| Generic instantiation arguments | Exact (argument by argument) |
| Aliases resolved to their target | Exact for `any` = `interface{}`, `byte` = `uint8`, `rune` = `int32`, and project aliases of named types (`type A = B`). An alias of a literal or generic type is **unknown** |
| Named types by declaring package and name | Exact for project types, through Go's scope rules. These include one package under two import names, the same local name for two packages, dot imports, and a package-level (or function-local) type shadowing a predeclared name. Build variants of a type (several declarations) are **unknown** |
| Types declared outside the project | By import path and name. The same path and name are identical. A different external name is **unknown**, never different, because it may be an alias (`os.FileMode` is `fs.FileMode`) |
| Names in a lossy package, or not resolvable | **Unknown** |

## Declaration-lossy files: two layers

When tree-sitter cannot keep a file's declarations, soundness rests on layer 1
alone. Layer 1 reads only the tree, never the text. Layer 2 reads the text back,
but only adds precision.

### Layer 1: a package with a lossy file may hold unseen declarations

A file is **declaration-lossy** (`data.go.lossy`) when tree-sitter gives it:

- no readable package clause (missing, misspelled, with no name, or a second
  clause), or a clause whose **membership cannot be proven**. Such a file joins
  no package, so nothing it declares is trusted. It makes **every package of its
  directory** lossy: from a `_test.go` file the external `_test` package too,
  otherwise only the non-`_test` ones. Membership cannot be proven (Go rejects
  the directory, but mid-edit, renaming a package file by file, it is routine)
  for:
  - a `_test` package declared by a file that is not a `_test.go` file;
  - every file of a group with more than one non-`_test` package name. A group
    is either all the directory's files with no build constraint (no
    `//go:build`, no GOOS/GOARCH suffix), or all its files with one identical
    constraint (they are built together whenever it holds). Which name is the
    real one cannot be proven, so every file of the group is untrusted.

  Files of different constraints are not compared. So a `//go:build ignore`
  generator `package main` beside a library changes nothing (restic's root is
  such a directory). A constrained file whose name conflicts with the
  unconstrained files under another constraint is not detected. Telling
  `ignore` from a satisfiable tag would need constraint evaluation, which is
  backlog;
- any top-level ERROR node; or
- any top-level declaration with an error, unless the error is provably
  confined to a function or method body.

A body error is confined only when all of these hold:

- the header (receiver, name, type parameters, parameters, results) has no
  error;
- the body ends with a real, not missing, `}`;
- no ERROR or missing node in the body holds a `{`, `}`, `func`, `type`, `var`,
  `const`, `import` or `package` token;
- no function literal or function type in the body has an error.

Anything that cannot be proven confined is lossy: an unclosed body, a body
closed by a later function's brace, a broken `type`, `var`, `const` or `import`
declaration, or a broken header. A confined error, such as restic's
`status_test.go`, costs nothing beyond its own declaration's links (see "Not
extracted").

While a package has at least one lossy file, for **that package**:

- **Method sets.** An unseen method may be declared on any of the package's
  named non-interface types (`view`).
  - A field or method declared intact on the type itself (depth 0) stays known
    and definite, because a second declaration would not compile.
  - Everything else about the type's method set is unknown. No promoted member
    lookup through it is definite, because an unseen depth-0 method could shadow
    it.
  - No `implements` link may need a method that is not declared intact on the
    type.
  - The type cannot be ruled out as an implementer, and no dispatch or name-only
    set it could join is closed.
  - Interfaces, aliases and function-local types cannot gain methods, so they
    are unchanged.
- **Names.** An unqualified name used in the package resolves definitely when
  it names an intact package-level declaration of the package, or one of the
  file's imports (neither could be declared twice). Any other name is
  uncertain: a dot-imported name, a builtin, a predeclared identifier, or a name
  with no declaration at all. It stays unresolved, with its name kept as
  `targetName`, and the `builtin` flag is not asserted.
  - A predeclared type named in the package (`error`, `string`, …) may be
    shadowed. A method signature that names one proves nothing, so no
    `implements` link is built on it. As a value's type it is external but
    *shadowable*: it never hides a project package's unexported name.
- **Unseen types.** An unseen type could implement anything it can reach.
  - A dispatch set on an interface whose package a lossy package can reach is
    open. Reach is transitive through project imports. A lossy package's
    imports are not all known, so it may reach **any package Go lets it
    import**: not `main`, not a `_test` package, and `internal/` only from
    within its parent. It may then reach onward from those.
  - A set of build variants with a member in a lossy package is open
    (`declarations-may-be-unseen`).
- **Imports.** Every lossy file's own imports are unknown, decided from the tree
  alone. An import lost after a declaration (for example inside the ERROR that
  `var a = [` opens) is covered with recovery off. Unmatched qualifiers in a
  lossy file are unknown, not external.
  - On restic this broad rule cost one closed set in one of the four mid-edit
    variants (see `evidence/w2-b/restic.md`). The narrower `import`-token test
    was therefore not needed.
- **Other packages** are affected only through these rules: through the types
  and interfaces they actually use, and through reach. Never wholesale.
- **Reasons.** A set open because of layer 1 says so.
  - `data.open.reason` is `declarations-may-be-unseen` when the set would not
    be open with no file lossy and no declaration broken. This is decided by
    resolving the same link a second time that way (intact declarations of
    lossy files are kept), only to name the reason.
  - When the set is open anyway and also has a member in a lossy package, both
    reasons apply: `reason` is `external-implementers-possible` and `reasons`
    lists both.
  - Build-variant sets with a lossy member have `declarations-may-be-unseen`.
  - Name-only sets (`receiver-type-unknown`) keep only that reason, even with
    a member in a lossy package (backlog).
  - Recovery never changes a reason. Its headers never mark imports, because a
    lossy file's imports are already unknown, and the second resolution ignores
    lossy state and broken or recovered symbols alike.

### Layer 2: lexical recovery, for precision only

Recovery runs only for lossy files (and can be switched off for tests:
`recoveryOptions.enabled` in `recover.ts`). It reads declaration headers back
from the lossy regions:

- every top-level ERROR node, and every top-level declaration with an
  unconfined error, whole;
- comments, string, raw-string and rune literals are masked first, lexing from
  the start of the file so literal state is always known;
- headers are recognised by Go's token rules at any indentation, using Unicode
  identifiers. The forms are:
  - `func (r T) M`, `func (r *T[P]) M`;
  - `func F`;
  - `type N …` and `type ( … )` groups, with the kind taken from the next token;
  - `var`/`const` names, alone or grouped;
  - `import`.

Each header becomes a `data.broken`, `data.recovered` symbol.

What a recovered symbol **may** be used for:

- a stable ID: its kind and identity are those an intact declaration would have;
- a possible member: a recovered method joins name-only sets and the
  unknown-structure fallback of dispatch sets;
- a possible implementer: a recovered type may be listed in an (open) dispatch
  set;
- a diagnostic: a `func (` whose receiver cannot be read reports one, and
  nothing else (layer 1 already covers it).

What it **may not** be used for:

- It is never a definite target of any link. Recovered functions, vars, consts
  and types are not names anything resolves to. A recovered type is not the
  target of its methods' `receiver` links, and it never gets `implements`
  links. Recovered symbols get no `contains` links.
- It never takes, replaces or shifts an intact declaration's ID. A header whose
  identity an intact declaration of the same file already has is not emitted. A
  recovered method that repeats an intact method of the same receiver in the
  package is ignored.
- It never makes a link definite or a set closed. With recovery off, every
  safety test still passes (mutation M32).

**Backlog (not in this version):**

- `func(x int) error {` inside a top-level ERROR region is read as a method
  `(int).error`. This adds uncertainty only.
- An unclosed `/*` that tree-sitter splits so that later declarations parse as
  intact.
- One broken spec in a `type ( … )` group makes the intact specs of that group
  unknown.

## Candidate sets: closed or open

Every candidate set is one of two kinds. A **closed** set contains every possible
target. An **open** set contains every possible target that is in the project, but
the true target may also be outside it. `analyze` writes `data.open = {reason}` on
open sets (the same mechanism as `overflow` and `builtin`); closed sets have no
`open`.

| Kind of set | Contains | Closed or open |
| --- | --- | --- |
| Build variants (a name declared in several build-constrained files) | Every declaration of the name visible to the caller | Closed, unless a member's package is declaration-lossy: then **open, `declarations-may-be-unseen`** (a variant may be among the unseen declarations) |
| Ambiguous selector (several embedding paths at the shallowest depth) | The distinct declarations reached | Closed (Go rejects the program) |
| Interface dispatch (`x.M()`, `x` of a project interface type; also type-parameter constraints) | The interface method, plus `M` on every project type (any package, test files included) that implements the receiver's **static** interface **or cannot be ruled out** as an implementer of it. A type is not ruled out when every interface method is either matched or possibly supplied by an external embedded type at the deciding depth (for example a test mock embedding `sync.Mutex` and a project interface). An external type can never supply a project package's unexported method, so for those names external embedding is ignored. When a type's selection of `M` is uncertain only because of an external embedded type, the project declaration it would select otherwise is listed. Expanded through implementers that hold an embedded interface value. Only proven implementers get definite `implements` links | **Closed** only when all of these hold: (1) the static interface type is known, not merely an interface the method was inherited from; (2) the interface is **sealed** (below); (3) every member comes from a proven implementer, with no uncertain selection; (4) nothing was expanded through an embedded interface value; (5) no declaration-lossy package can reach the interface's package (an unseen type there could implement it). Otherwise **open, `external-implementers-possible`** |
| Reassigned function/method values | Every value ever assigned, each interface method expanded to its dispatch set | Closed if it includes no dispatch set. An included dispatch set has no static receiver interface (the value only records which method), so it is open |
| Name-only (receiver type not evident) | Every concrete project method of the name a value could carry: any package, test files included; unexported names only from the caller's package | **Always open, `receiver-type-unknown`**: the value may be of a type outside the project |

**Sealed interface (no type outside the project can implement it).** One
reachability rule decides it; anything uncertain means open.

- An interface whose methods are all exported is never sealed.
- An interface with an unexported method `h` of package P is sealed only if code
  outside the project cannot obtain `h`. That holds when no **exported carrier** of
  `h` is declared in an **outside-reachable** package.
- **Carriers of `h`** are every project type whose method set includes `h`. The
  method set comes from the one shared structure function (`view`, below) and the
  selector rule, so it is transitive over the whole project:
  - the declaring interface, and concrete types declaring `h`;
  - any struct embedding a carrier, by value or pointer, at any depth, including
    through embedded interfaces;
  - any interface embedding a carrier interface;
  - any **defined** type whose underlying type is a carrier (`type Pub i`;
    `type Pub s2` with `type s2 struct{ a }`), because a defined type keeps an
    interface's method set and a struct's promoted methods;
  - any alias of a carrier, including an alias of a struct or interface **literal**
    (`type Pub = struct{ a }`, `type Pub = interface{ i }`), and interfaces that
    embed an interface literal (`type Pub interface{ interface{ i } }`);
  - generic types by their declaration, which covers every instantiation;
  - function-local and anonymous types, through their embedded elements.
- **Exported** means an exported name declared at package level in a non-test
  file. A function-local or anonymous type cannot itself be named from outside, but
  an exported alias can name a type literal, and an exported type can embed one.
  Both are carriers in their own right, because their method set includes the
  literal's.
- **Outside-reachable** packages are project packages that code outside the project
  can import, decided by import path within the package's own module:
  - not `package main`, and not a `_test` package;
  - no `internal` element in the import path *relative to its module*. A nested
    `go.mod` under `internal/sub/` starts its own module with a plain import path,
    so it is reachable. A package without a known module is assumed reachable.
- **Uncertain** cases are open. An exported type whose structure `view` cannot
  determine (an unresolvable embedded or underlying type, or a defined pointer type)
  might carry `h`, so the set is open.

Reproductions that are open, each tested in `test/graph-go-review5.test.mjs`:

- an internal interface whose implementer is re-exposed by an exported struct
  (`api.Carrier{ p.A }`, also by pointer);
- an exported interface embedding an internal interface;
- a facade alias (`type Thing = p.I`);
- a nested module under `internal/`;
- defined types and generic aliases;
- the same cases inside a `go.work` workspace.

Controls that stay closed: everything unexported with no exported carrier;
`package main`; a genuinely internal package with nothing re-exposed (including
`internal/` inside a nested module).

**The rule's one assumption:** a separate module whose import path shares the prefix
above an `internal/` directory may import that directory (the `x/tools/gopls`
pattern). Such modules are assumed to be part of the captured project. If one is
not, an internal package's sealed interface could be implemented by it, and a set
the graph calls closed would be missing that module's types.

**Inherited hidden methods.** An external type cannot declare another package's
unexported method, but it can inherit one by embedding an outside-reachable carrier.
So when `h`'s carriers are reachable, a project type that embeds any external type
(at any depth) cannot be ruled out as an implementer. Its matching method is listed
as unproven, and the set is open. When no carrier is reachable, an external type
cannot have `h`, and such types are ruled out (for example `MuMock{ sync.Mutex }`
for an internal interface). Definite `implements` links stay proof-based.

**Local and anonymous types.** Every function-local type declaration (struct,
interface, defined type, alias) becomes a symbol (`data.local`), and so does every
anonymous struct type (a literal, field or variable type) that embeds something.
Each gets its fields, interface elements and `embeds` links.

**Identity scheme, unique per package:**

- `<file>:<enclosing>.<name>` for a local type, for example
  `p.go:init.l` or `p.go:(*T).M.l`;
- `<file>:<enclosing>.struct#<n>` for the n-th anonymous struct in the enclosing
  declaration, in source order;
- `#2`, `#3`, … appended for a repeated identity in the same file.

The file name makes two files' `init` functions, or two build-variant copies of one
function, distinct types. This full identity is the symbol's name and identity, the
key of its members (fields, interface methods), and its spelling in method
signatures (`implements` comparison). It is used wherever a local type is a key or
is compared, so two local `t` types in different scopes never compare equal.

Local type names are resolved scope-aware at parse time: a local type is visible
from its declaration to the end of its block and shadows outer names, and the same
name in two functions or blocks is two types. An embedded field naming a local type
refers to that symbol (`TypeRef.l`). With the package-unique identity, these types
take part in method sets, `implements`, dispatch and carriers exactly like
package-level types. Values *of* a local type are still opaque to member lookup
(`var v lt; v.M()` stays unresolved; backlog). An anonymous struct
type that embeds nothing has no methods, so it is not a symbol.

**One structure function (`view`).** Every consumer asks the same function what a
type's structure is:

- an interface, or an alias of an interface literal: a flat method set;
- a struct, an alias of a struct literal, or a local/anonymous struct: fields,
  declared methods and embedded elements;
- a defined type over an interface: that interface's method set;
- a defined type over a struct or another defined type: its own declared methods,
  plus the underlying type's fields and embedded elements (promoted methods), but
  **not** the underlying named type's declared methods;
- an alias of a named type: that type's structure.

The consumers are selection and promotion, interface method sets, `implements`,
dispatch member enumeration, static types of dispatch (a defined type over an
interface dispatches on that interface) and carriers. When `view` cannot determine
a structure, the answer is **unknown**: the type cannot be ruled out, and any set it
touches is open. An unknown that comes only from an external type is irrelevant for
a project package's unexported method names.

**Invariant (tested):** a closed dispatch set lists only types with a proven
`implements` link to the static interface. An open set may also list types that
are possible but not proven.

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

## Module version 7 (fourth review: exact meaning of open and closed)

Every candidate set lists every possible project target; "open" excuses only targets
outside the project. A set is closed only when it is provably complete and every
member is provably possible. Regressions are in `test/graph-go-review4.test.mjs`.
`evidence/w2-b/mutations.mjs` applies eleven rule-weakening mutations to the compiled
module and requires each to fail a test.

1. An implementer whose selection of `M` is uncertain because of an external
   embedded type keeps the project declaration it would otherwise select (`A.M`
   promoted through `Wrap{ A; sync.Mutex }`), and the set is open.
2. Sealing follows the exact rule above. Having an unexported method is not enough.
3. Types that cannot supply another package's unexported method are ruled out
   (`MuMock{ sync.Mutex }`, `RC{ io.ReadCloser }`, `q.QR{ io.Reader }`). Members
   come from the static interface's implementers, not an embedded interface's.
   Closed sets contain only proven implementers.
4. Predeclared identifiers are decided at resolution (see "Not extracted").

The module version is 7.

## Module version 8 (fifth review)

Regressions are in `test/graph-go-review5.test.mjs`. `evidence/w2-b/mutations.mjs`
has sixteen mutations; all fail tests.

1. One reachability rule for sealed interfaces (above) replaces the three special
   branches (`main`, `internal/`, exported carrier in the same package).
2. Inherited hidden methods: a type embedding an external type cannot be ruled out
   when the hidden method is outside-reachable.
3. Function-local and anonymous struct types are implementers.
4. Shadowed `nil`, `true`, `false`, `iota` in call position use the shared
   predeclared-name mechanism; selector bases, composite-literal types and type
   arguments are covered too.

   Grammar limit: tree-sitter-go parses these four names as keywords, so a
   composite literal of a type named `false` (`false{…}`) is a syntax error. The
   file is partial and that declaration emits no links. A user type named like a
   predeclared *type* (`string{…}`) parses and resolves.

The module version is 8.

## Module version 9 (sixth review): one structure function

Regressions are in `test/graph-go-review6.test.mjs`. `evidence/w2-b/mutations.mjs`
has 22 mutations, and all fail tests.

1. Local types embedding local types: full local type symbols, with scope-aware
   name resolution.
2. Defined types and aliases are followed the same way in dispatch as in
   reachability, in both directions (an underlying struct's promotions are kept;
   its named type's declared methods are not).
3. Type literals are carriers: aliases of struct/interface literals, and embedded
   interface literals.
4. An unknown structure opens the set, for every consumer: carriers, dispatch
   membership, `implements`, member lookup. The two unknown paths (`view` and the
   selector) are redundant by design, so M20 disables both. M21 and M22 disable
   each one alone, with cases only that path can answer.

`carriersOf` (the separate fixpoint) is removed: carriers are exported types for
which `view` and the selector find `h`, or cannot decide. The module version is 9.

## Module version 10 (seventh review)

Regressions are in `test/graph-go-review7.test.mjs`. `evidence/w2-b/mutations.mjs`
has 25 mutations, and all fail tests.

1. Local type identities are unique per package (identity scheme above). They are
   used in members, signatures, method sets, `implements`, dispatch and carriers.
   1. The two `t` in `F` and `G` no longer make `F.w implements G.j`.
   2. Same-shaped anonymous structs in several files' `init` functions, and local
      types in build-variant copies of one function, no longer share members.
2. A type's own declared methods are known at depth 0 whatever its underlying type
   is. An unknown or external underlying type makes only the inherited part
   unknown. So `type w Base; func (w) M()` keeps `(w).M`, and `w implements I` is
   definite when every method of `I` is declared on `w`. If some are not, the set is
   open.

The module version is 10.

## Module version 11 (eighth review)

Structure recovered from a declaration containing a syntax error is no longer
trusted (see "Not extracted"). Regressions are in `test/graph-go-review8.test.mjs`,
covering both reproductions plus broken interfaces, sealed sets, method and
function headers, `var` types, imports and local types. M26 is the mutation for
this item (26/26 killed). The module version is 11.

## Module version 12 (ninth review)

Declarations swallowed by error recovery become unknown and no longer disappear
(see "Not extracted"). This covers a type truncated at end of file, broken or
swallowed method headers, unclosed bodies, and lost imports (`imprt`, or an
unclosed `import (`). Regressions are in `test/graph-go-review9.test.mjs`, with
controls for an intact declaration in the same file and for unrelated packages.
The mutations for this round are M27–M31: 1a, 1b/c, 1d, 1e and containment. The
module version is 12.

## Module version 13 (tenth review): two layers

Soundness no longer depends on the lexical scanner (see "Declaration-lossy
files"). Layer 1 decides from the tree alone which files may have lost
declarations, and treats their packages as possibly holding unseen
declarations. Layer 2 keeps the recovery for IDs, candidates and diagnostics
only. It now masks literals and comments, reads indented headers, `type ( … )`
groups and Unicode names, and never emits over an intact identity.

- **Removed:** the per-receiver (`brokenReceivers`) and per-package
  (`unattributable`) rules from the ninth review. Layer 1 covers both.
- **Tests:** `test/graph-go-review10.test.mjs` runs every reviewer reproduction
  (items 1–4) with recovery on and off. It adds controls for intact names and
  depth-0 members, confined body errors, build variants, signatures naming
  predeclared types, and recovered types.
- **Mutations:** 40/40 killed; with recovery fully off, every `safety:` test
  passes.
- **Cost on restic:** see `evidence/w2-b/restic.md`.

The module version is 13.

## Module version 14 (eleventh review)

Which packages a lossy file makes uncertain, decided from the tree alone:

1. **No readable package clause.** The file makes every package of its
   directory lossy (and the external `_test` package, from a `_test.go` file).
   Before this version such a file joined no package and made none uncertain.
2. **Lost imports.** Every lossy file's imports are unknown. A lossy package
   may reach any package Go lets it import, transitively. Before, only an ERROR
   before the first declaration counted, and the lexical scanner saw the rest,
   so turning recovery off could close a set.
3. **Truthful reasons:** `declarations-may-be-unseen`, or both reasons.

`test/graph-go-review11.test.mjs` covers the three items with recovery on and
off, and adds a transitive-reach test without any lossy file (the repro-4 test
no longer needs transitivity, since a lossy package now reaches any importable
package). Mutations M44–M47 cover items 1–3. The module version is 14.

## Module version 15 (twelfth review)

- **Conflicting package clauses.** A readable but conflicting package clause
  (`package pp` beside `package p`, an untagged `package main`, `package p_test`
  in a non-test file, two clauses in one file) now takes the missing-clause
  path: the file is untrusted and the directory's packages are lossy (see
  layer 1).
  - One older test asserted package candidates for a directory with two
    unconstrained names. It now asserts the import is unresolved.
- **Reasons.** Recovery no longer sets `importsBroken`, so reasons are identical
  with recovery on and off.
- **Type identity** (see "Type identity"). One canonical form, applied at every
  nesting level, replaces the text template. Nested grouped parameters keep
  their arity, and unexported fields of anonymous structs belong to their
  package. On restic this moves two links, both correct (see
  `evidence/w2-b/restic.md`).
- **`replace` selection.** A version-specific replace of the selected version
  wins regardless of order. An unprovable selection gives candidates.
- **Removed:** a stale doc comment above `importsUnknown`.
- **Tests:** `test/graph-go-review12.test.mjs` and
  `test/graph-go-identity.test.mjs` (one or more tests per exact identity rule).
- **Mutations:** M48–M64, plus M23 and M43 re-pointed.

The module version is 15.

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
