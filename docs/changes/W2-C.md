# W2-C: Rust language module for the code graph

Implements mega-plan 4.4's structural Rust graph reader. Production discovery
finds `src/graph/languages/rust/index.ts` without a core registration change.
This is graph extraction, not the later Stage 7 contract/behaviour support claim.
No CLI, MCP, Studio, compiler, package or shared graph interface changed.

## Snapshot and parser boundary

Claims case-sensitive `.rs` files; separately captures every `Cargo.toml`.
Uses the installed `tree-sitter-rust` WASM and bundled tags query through the
shared Tree-sitter helper. The definition mapping suppresses the bundled
function/method duplicates; a live-tree pass emits scoped definitions exactly
once. Nodes never escape parsing and parser/query/tree resources are freed.
No Cargo, rustc, rust-analyzer, native compilation, project execution, or project
filesystem reads occur in the module. Tests also run parsing/resolution with an
empty executable PATH.

Syntax errors retain extracted facts with `partial` status and diagnostics.
Missing/failed grammar loading is a visible parse failure. Configuration attributes
are retained as data; all syntactically present cfg branches, including test
modules, are indexed. This does not select a Cargo feature configuration or
prove that the captured program compiles. Privacy is recorded, never filtered:
private declarations and private cross-module references are ordinary graph facts.

## Construct matrix

| Construct | Result |
|---|---|
| File/crate units, inline/file modules, functions, structs, enums/variants, traits/default and required methods, impls, aliases, const/static, macro_rules | Symbols and definite `contains` links; full declaration UTF-16 spans |
| `mod name;`, `name.rs`, `name/mod.rs`, literal `#[path = "..."]`, nested/inline module layout | Definite module-file links; conflicting captured layouts become candidates; absent files unresolved |
| Literal Cargo package/lib/bin paths, default lib/main, named `[[bin]]` | Crate roots; a package binary can reference its library |
| Workspace members (including segment globs/excludes), literal path dependencies, aliases, workspace-inherited path dependencies, dependency subtables | Snapshot context; cross-crate links when the referenced library is captured |
| `use`, crate/self/super paths, nested groups, renames, module aliases | Definite where captured declarations/import facts determine a target; missing imports unresolved |
| Glob members | Definite after enumerating known module contents; collisions are candidates; an opaque glob prevents a sole known member becoming definite. The glob import edge itself retains its `*` path unresolved |
| Bare and path-qualified free calls, associated calls through resolved nominal types | Definite, or candidates for competing declarations; external/absent paths unresolved |
| Receiver with a simple explicit parameter/local type, `self` in an impl, immediate struct literal | Inherent method resolves for that type; associated functions lacking a self parameter cannot be called as methods |
| Unknown/inferred receiver, trait object, generic type parameter, trait-only method selection | Unresolved, or multiple structurally matching explicit trait implementations as candidates; no type inference or trait solver |
| Syntactic type references and `impl Trait for Type` | Type/implements links where the path resolves; generic parameters and external types retain unresolved names |
| Local macro_rules invocation after a visible definition | Definite project macro link; forward/absent/external macro names unresolved |
| Local bindings shadowing callable names | Suppress imported/free-function resolution; block containment keeps local bindings/imports from leaking |
| Reexports | Simple captured module reexports are followed; cyclic/complex/opaque chains can remain unresolved |
| Standard library, registry dependencies, uncaptured path crates | Unresolved with original path kept |
| Macro expansion and declarations/calls inside token trees | Not extracted; macro definition and invocation themselves are extracted |

This is intentionally syntactic analysis. It does not implement Cargo feature
selection, build scripts, generated modules, proc macros, Rust name/type checking,
method autoderef, specialization, type-alias expansion for method lookup, generic substitution, closure inference or
runtime dispatch. Trait default bodies are symbols, but inheritance of a default
body into an impl is not synthesized. Macro export/import expansion and arbitrary
macro textual-scope propagation across files are not implemented. A loose source
file outside any captured Cargo/module tree still has symbols/containment, but
its name links stay unresolved.

The Cargo reader accepts the context subset above, not the full TOML language.
Auto-discovered `src/bin`/examples/tests/benches beyond default main and explicit
`[[bin]]`, auto-added workspace members, nonliteral/escaped target paths and
full Cargo target-specific dependency activation are not modeled. Conflicting
platform-specific dependency aliases stay unresolved rather than selecting the
last manifest branch. Captured files
outside a declared crate tree remain extractable without invented membership.

## Identity scheme

Core IDs combine project, module, file, kind and the module's scoped identity,
plus the core's source-order ordinal for repeated identical declarations.
The file unit is `$crate` with graph kind `module`; `data.unitKind` distinguishes
Cargo crate roots from module files. A snapshot-only analysis pass adds the
Cargo crate name, lib/bin target kind, manifest and workspace to root-unit data;
it reuses parsed facts and never reparses source. Declarations use enclosing
names joined with `::`.
Impl containers include generic syntax, implemented trait (when present) and
self type: `impl A::new`, `impl B::new`, `impl Speak for A::speak`, and
`impl<T> Wrap<T>::new` are separate identities. Anonymous nested blocks use
scope-local structural ordinals; comment/whitespace insertions do not enter IDs.
Inserting/reordering anonymous blocks can change their ordinal, as with repeated
same-identity declarations. File-local keys contain positions solely for wiring
sources/containment and are not persistent identities. Visibility and attributes
are JSON facts.

## Interface gaps

The frozen interface requires at least two candidate IDs. A single known target
with an opaque glob/trait-selection alternative cannot be represented as a
one-element candidate set plus unknown alternatives. For example
`use crate::known::*; use external::*; f();` retains `f` unresolved when only
`known::f` is captured. No definite target is invented. Multiple known candidates
remain explicit candidates; consumers must not infer an exhaustive Rust type
analysis from the set.

No other core change was needed. Source/context capture failures and parser
partial provenance use the existing interface. The module does not change the
support matrix/decision ledger directly because those paths belong to the wave
integration chunk; this fragment is the proposed graph support record.

## Validation and evidence

The fixture workspace includes both file module layouts, an inline and a path
module, two crates with a path dependency, explicit lib/bin targets, private
sibling calls, nested/renamed/glob imports, cfg(test), generics, distinct impls,
trait defaults/implementors, macros, shadowing, unknown trait dispatch and a
syntax-error file. The exact-position conformance manifest includes every
symbol/link, Unicode-before-declaration, unresolved controls and candidate sets.
Separate tests assert resolution rules and negative lookalikes, context-only
edits, stable IDs after comment insertion, and resource-independent behavior.

Real-project counts and sampled-link review are recorded under `evidence/w2-c/`.
The initial two-crate experiment was interrupted after all 131 files parsed
(4,382 symbols, 25,956 links) because method lookup repeatedly scanned all impl
blocks. That experiment is not a successful index. The final module builds a
per-snapshot method index instead; it does not change core performance code.

The existing `test/graph-review.test.mjs` A10 test asserts that production
`discoverLanguages()` prints an empty registry (`[]`). Rust correctly changes
that output to `['rust']`, while the test-only toy remains hidden. A10 passes
on an archived, unchanged `origin/main`; it fails with this module present.
Updating that shared test is outside W2-C ownership. The PR therefore reports
the full-suite failure explicitly and requires the integration owner to update
that expectation. It is not described as a passing check or dismissed as a
failure already present on main.

The real-source audit also found a bare-call scope error in log_event.rs:
`size_of::<Self>()` was initially linked to the enclosing impl method instead
of remaining an external std::mem::size_of call. The corrected resolver keeps
all impl/trait members (including associated types) outside bare lexical name
lookup. Explicit method/associated-function calls use the separate member index.
The incorrect earlier sample is preserved, investigated, and superseded by a
new 20-resolved/10-unresolved sample. See `vector-audit-findings.md`.

Receiver evidence preserves the annotation's lexical scope: a parameter `x: A`
keeps the outer A even if the function body declares another A. Signature types
are resolved outside the body item scope, and Self paths use the impl's defining
scope. This is syntactic provenance, not inference of unannotated bindings.

Final Vector scope: the complete `lib/vector-common/` and `lib/vector-core/`
crate directories plus root Cargo.toml context, at commit
`515e87d9861b564f521a8992d224892cd8cae120`. This is 131 of the checkout's 1,563
Rust files; whole-repository indexing was not attempted or claimed. All 131
claimed files parsed cleanly (0 partial, 0 failed), producing 4,382 symbols and
25,956 links: 8,955 resolved, 20 candidate sets, 16,981 unresolved. No parser,
analysis or resolution errors. The final run took approximately 74.9 seconds on
this shared machine, an observation only. The 20-resolved/10-unresolved audit
passes after the documented fix. Counts by kind, the ten most common unresolved
names, exact sample locations, seed and review judgments are retained in evidence.

Final checks on Node 24.21.0: `npm ci --ignore-scripts` passed;
`node --test test/graph-rust*.test.mjs` passed 16/16; final `npm test`
completed with 1,219/1,220 passing, zero skips/cancellations, and only the
out-of-scope A10 empty-production-registry expectation failing. The unchanged
main comparison passes A10. Raw logs, superseded experiments and the exact
failure are preserved under `evidence/w2-c/`.
`npm run format:check` also passed. See `validation.json` for final module source
hashes and explicit command exit states. Review approval is not claimed.
