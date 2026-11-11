# W2-C: Rust language module for the code graph

Review revision, module version 2. Implements mega-plan 4.4's structural Rust
reader in one discoverable folder. Current origin/main was merged normally;
PR 15's shared discovery-test fix is included. No graph interface, other
language, CLI, MCP, Studio, dependency manifest or toolchain was changed by W2-C.
Earlier implementation/test/audit records remain in `evidence/w2-c/` as history;
the `review-*` records below supersede their completion claims.

## Snapshot, identity and parser boundaries

Claims case-sensitive `.rs`; captures `Cargo.toml` as context. The installed
`tree-sitter-rust` WASM and bundled tags query load through the shared helper.
The definition mapping filters the bundled function/method duplicates; the live
AST pass emits each scoped declaration once. Trees/nodes never escape parsing.
No Cargo, rustc, rust-analyzer, native compilation, project execution or project
filesystem reads occur inside the module. Analysis reuses parsed snapshot facts.

Ranges are exact half-open UTF-16 offsets. Core IDs combine project/module/file,
kind, position-independent scoped identity and duplicate ordinal. `$crate` is the
file unit (graph kind `module`); `data.unitKind` distinguishes crate roots.
Cargo-derived crate name, manifest, workspace and target kind are unit data.
Impl identities retain self type, generics and trait: `impl A::new`,
`impl B::new`, `impl Speak for A::f`, `impl<T> Wrap<T>::new`. Anonymous blocks use
scope-local structural ordinals. Raw identifiers normalize `r#name` to `name` in
names/identities/lookup; source spans still cover their original spelling.
Visibility and attributes remain data; private items are never dropped. This is
structural observation, not a Rust compilation or visibility-access check.

Syntax errors remain partial with diagnostics; failed grammar loading remains a
failure. Both sides of cfg alternatives, including cfg(test), remain captured.
No feature/platform selection, macro expansion or generated-source execution
occurs. Partial target provenance remains visible through the shared graph API.

## Construct matrix

| Construct | Definite / candidates / unresolved / not extracted |
|---|---|
| Files/crates/modules; functions; structs/enums/variants; traits/methods/default bodies; impls; aliases; const/static; macro_rules | Symbols and `contains`; private declarations included |
| Named-field vs tuple/unit constructors | Constructor-form metadata and separate type/value/macro lookup; a type-only item cannot capture a value call |
| File and inline modules, including declarations inside functions | Module places and barriers; bare names never walk out of a module into an enclosing function/module |
| `name.rs`, `name/mod.rs`, literal `#[path]` | Definite module-file links, or candidates for conflicting layouts; path-loaded files find children beside themselves, like mod.rs |
| Cargo library/default main/explicit bin/example/test/bench targets | Crate roots from captured manifests |
| Automatic `src/bin/*.rs`, `examples/*.rs`, `tests/*.rs`, `benches/*.rs`, and their `name/main.rs` forms | Proper crate roots, respecting auto-target flags; explicit targets still work with auto-discovery disabled |
| Default/custom build.rs | Build crate root, using build dependencies; not executed |
| Workspace members/globs/excludes, literal path dependencies, workspace dependencies, dependency subtables | Cross-crate lookup when libraries are captured; non-renamed dependencies use the target lib name, explicit `package` renames use the key; hyphens normalize to underscores |
| `use`, nested groups, aliases, self/super/crate and absolute external paths | Namespace-aware lookup; explicit imports of unknown external bindings block fallback guesses |
| Multi-hop reexports and parents' imports, including across path crates | Imports and use sites use the same recursive resolver in the destination's owning crate |
| Glob member names | Resolve from known module contents; complete collisions become candidates; opaque alternatives remain unresolved. The glob import's own edge stays unresolved (backlog) |
| Mixed-namespace imports | A binding can import type/value/macro names simultaneously; the single import edge stays unresolved when it would otherwise assert just one of different kinds. Use sites select their own namespace |
| Free and associated calls | Definite when namespace/type/member facts determine one target; competing captured targets become candidates |
| Explicit parameter/local receiver types and self | Preserve annotation scope, borrow/mutability and full generic syntax. Incompatible concrete generic arguments, inapplicable mutable/value receivers and mismatched argument counts are rejected |
| Generic impl substitution, inferred/unknown receiver, trait object | Unresolved when applicability cannot be established; no inference, bounds solver or arbitrary autoderef |
| Trait-only instance/associated calls | One matching implementation stays unresolved. Multiple complete known choices are candidates, including inherited default bodies; an unknown trait/default alternative prevents an incomplete candidate set |
| Trait-in-scope selection | Not used to assert dispatch; captured applicable trait choices are conservatively retained. There is no general trait solver |
| Type references and explicit trait implementations | Namespace-correct `types` / `implements` links |
| Qualified match/if-let patterns | `patterns` links to variants, struct constructors and const/static values, rather than rejected type references |
| Local callable-name shadowing | Binding evidence prevents imported/free-function guesses; lexical blocks preserve local scope |
| Local macro_rules invocation after its definition | Project macro link; forward/absent/external names unresolved |
| Standard library, registry packages, uncaptured path crates | Unresolved with the name/path retained |
| Macro token-tree contents, proc-macro/derive expansion, generated declarations | Not extracted; definition/invocation syntax is captured without expansion |

The Cargo reader handles this literal context subset, not full TOML/Cargo
semantics. Escaped/nonliteral paths, automatic workspace membership inference,
platform activation, feature selection and generated targets are not evaluated.
Conflicting platform-specific aliases stay unresolved. Files outside a captured
Cargo root/module tree retain symbols/containment without invented membership.
Nested fixture/support files are not automatically made targets merely because
they live somewhere under tests/examples/benches; Cargo's target layouts apply.

Method lookup does not expand type aliases, solve trait bounds/specialization,
infer closure/results/chained receiver types or implement arbitrary Deref.
Macro export/import expansion and arbitrary cross-file textual macro scope are
not implemented. Private symbol availability does not prove legal access.

## Completeness and interface limits

An existing link decision can represent one target or a one-of set of at least
two targets. One known target plus an unknown alternative remains unresolved;
so do multiple known choices when an unknown trait/glob could supply the true
missing target. Inherited project trait default bodies are included before
forming candidate sets. A single trait impl is never converted to definite
merely because no second captured method exists.

A Rust import can bind several namespaces at once. This module does not invent
a one-of decision for simultaneous bindings; its import edge remains unresolved
and its uses resolve by namespace. Additional namespace-specific import edges
could be a later enhancement. No frozen-core workaround was required.

## Resolution scaling

Imports are indexed by file/scope/alias and glob group; module declarations and
places by file/local scope; methods by nominal type/name; packages by manifest.
Lookups memoize completed results, with recursion guards for cyclic/opaque
imports. Binding facts are collected once per function, indexed by lexical scope
and name, and queried through ancestor scopes with binary search on activation.
There is no per-lookup scan of all project imports/places or rescan of a whole
function body. Work still depends on path depth, local candidates and reexports;
no elapsed-time bound is a correctness assertion.

`performance-baseline/` preserves the corrected semantic implementation using
project-wide import/place scans and function rescans. The comparison runner
asserts every parsed fact and every resolved/unresolved/candidate decision is
identical on the complete fixture and both Vector crates. It compares entire
outputs, not just counts. In the final paired two-crate observation, baseline
parse/resolve took 5.008/1.027 s; indexed/cached parse/resolve took 3.527/0.254 s.
Hashes and reproducible commands are in the performance evidence.

## Vector evidence and movement

Vector commit `515e87d9861b564f521a8992d224892cd8cae120`, shallow-cloned only in
scratch. Every one of its 1,563 Rust files was analyzed directly through the
module: 1,552 clean, 11 partial, **0 failed**. No source subset is described as a
whole-store success. Exact per-kind counts and top unresolved names are in
`review-whole-summary.json`; partial paths/diagnostics are retained separately.
Grammar limitations include attributes in patterns, some qualified generic and
higher-ranked syntax, and `raw` token contexts. They are not relabeled clean.

| Scope / revision | Files | Symbols | Links | Resolved | Candidate sets | Unresolved |
|---|---:|---:|---:|---:|---:|---:|
| Reviewed d60ac141, two crates | 131 | 4,382 | 25,956 | 8,955 | 20 | 16,981 |
| Current two crates | 131 | 4,382 | 27,261 | 10,611 | 20 | 16,630 |
| Current nine crates | 247 | 7,157 | 46,944 | 17,652 | 40 | 29,252 |
| Current whole repository, module only | 1,563 | 35,907 | 311,132 | 107,020 | 1,091 | 203,021 |

On the same two-crate snapshot, 1,042 old unresolved references now resolve:
551 types, 270 calls, 149 converted patterns, 47 imports, 23 implements and two
modules. At least 459 use-site gains point to a target whose import was already
resolved before, directly exposing the import/use-site reexport mismatch.
Another 1,305 pattern edges are newly extracted (730 resolved, 575 unresolved).
Stricter namespace/applicability rules withhold 116 old definite links (66 calls,
37 imports, 13 types). No old definite link retargeted to a different symbol.
The complete positional movement list, including losses, is preserved.

Observed module parse/resolve times were 3.527/0.254 s for two crates,
7.641/0.395 s for nine, and 35.734/3.627 s for all files. The whole module run's
wall time was 44.106 s. These are shared-machine observations, not speed-based
properties; paired comparison wall time also includes the baseline execution.

A bounded 180-second whole-store experiment captured/parsed all 1,563 files but
exhausted its budget during core analysis (exit 124). This is **unresolved whole
store evidence**, not a successful index. PR 11 was still open. The final
nine-crate store run completes independently; its report is
`review-nine-final-store.json` (149.240 s observed, 247 clean files, zero
analysis/resolution errors). No core performance code was modified. The
manager can request the whole indexed run after the core optimization merges.

The final fresh seeded audit covers 30 resolved links, 15 complete candidate
sets and 15 unresolved links; all judgments were checked against source and
imports/declarations. Earlier audit findings and superseded samples are retained.
See `review-audit.md`; sampling is not a universal graph-accuracy proof.

## Validation

The original exact-position conformance fixture remains unchanged and passes
against the new module. Review regressions cover all numbered counterexamples,
positive/negative controls, generic/borrow/default candidate completeness,
namespace interactions, target flags, external-import fallback, cross-crate
reexports, raw identifiers (including generic parameters and local bindings) and
cycles. The final snapshot equivalence report proves that the last raw-name
normalization controls leave every Vector parse fact, resolution decision and
all 60 audited entries unchanged. Final required check outcomes are recorded
in `review-validation.json`, in the required sequential order. A10 is now fixed
by the merged main change; W2-C did not alter shared tests to obtain a pass.

Final sequential checks on Node 24.21.0: install exit 0; `npm test` exit 0
(1,259 passed, zero failed/cancelled, two inherited TLC prerequisite skips that
remain unresolved); format check exit 0; focused Rust suite 42/42, zero skips.
The final whole-snapshot parse/resolution hashes and all 60 audited entries are
unchanged by the last raw generic/local binding controls. `review-validation.json`
records source/baseline hashes and exact outcomes; review approval is not claimed.
