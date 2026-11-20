# Support item changes

## Added

| Item | Stored reason |
| --- | --- |
| ` go-candidate-set ` Distinguish build alternatives from runtime dispatch | ` (candidate set) ` |
| ` go-declarations-may-be-unseen ` Read or verify the potentially missing declarations | ` declarations-may-be-unseen ` |
| ` go-external-implementers-possible ` Prove concrete receivers for open interface calls where possible | ` external-implementers-possible ` |
| ` go-invalid-code ` Recover declarations in unreadable Go files | ` invalid-code ` |
| ` go-no-reason ` Recover Go targets with no stored explanation | ` (no reason) ` |
| ` go-receiver-type-unknown ` Trace the type of the Go receiver | ` receiver-type-unknown ` |
| ` go-unit-only ` Review Go links that name packages alone | ` (unit only) ` |
| ` rust-candidate-set ` Distinguish Rust build alternatives from dispatch | ` (candidate set) ` |
| ` rust-cfg-condition-unverified ` Compare the conditions on Rust references and declarations | ` cfg-condition-unverified ` |
| ` rust-conditional-module-path-lacks-captured-alternatives ` Capture the Rust module path selected under each condition | ` conditional module path lacks captured alternatives ` |
| ` rust-conditional-name-may-be-absent ` Verify the Rust declaration is present whenever the caller builds | ` conditional-name-may-be-absent ` |
| ` rust-dependency-presence-unverified ` Verify the dependency is present for the reference | ` dependency-presence-unverified ` |
| ` rust-edition-unverified ` Establish the Rust edition for name lookup | ` edition-unverified ` |
| ` rust-import-cycle-unverified ` Resolve names through cyclic imports where possible | ` import-cycle-unverified ` |
| ` rust-inherent-applicability-unverified ` Verify that the receiver satisfies the inherent implementation | ` inherent-applicability-unverified ` |
| ` rust-item-under-opaque-attribute ` Verify which declarations an attribute produces | ` item-under-opaque-attribute ` |
| ` rust-later-probe-step ` Check earlier receiver forms before selecting a Rust method | ` later-probe-step ` |
| ` rust-macro-argument-unverified ` Identify the Rust names used inside macro arguments | ` macro-argument-unverified ` |
| ` rust-macro-arm-unverified ` Determine which arm a macro invocation selects | ` macro-arm-unverified ` |
| ` rust-macro-body-name-unverified ` Resolve Rust names in a macro body | ` macro-body-name-unverified ` |
| ` rust-macro-repetition-unverified ` Verify which names a repeated macro pattern emits | ` macro-repetition-unverified ` |
| ` rust-macro-use-exports-unverified ` Identify the macros made visible by macro_use | ` macro-use-exports-unverified ` |
| ` rust-module-layout-unverified ` Establish the file layout of the Rust module | ` module-layout-unverified ` |
| ` rust-namespace-import-alias-structure-is-unknown ` Establish how Rust imports and aliases bind the name | ` namespace/import/alias structure is unknown ` |
| ` rust-namespace-position-unverified ` Determine the namespace at the Rust source position | ` namespace-position-unverified ` |
| ` rust-no-reason ` Recover Rust targets with no stored explanation | ` (no reason) ` |
| ` rust-opaque-item-may-shadow-name ` Determine whether generated declarations shadow the name | ` opaque-item-may-shadow-name ` |
| ` rust-path-type-unverified ` Trace the type at the start of a Rust path | ` path-type-unverified ` |
| ` rust-receiver-type-unverified ` Trace the Rust receiver type and its declaring method | ` receiver-type-unverified ` |
| ` rust-simultaneous-namespace-bindings-cannot-be-represented-as-one-of ` Record when a Rust name denotes several kinds of declaration | ` Simultaneous namespace bindings cannot be represented as one-of ` |
| ` rust-trait-dispatch ` Prove concrete Rust trait receivers when source permits | ` trait-dispatch ` |
| ` rust-unit-only ` Review Rust links that name crates alone | ` (unit only) ` |
| ` ts-ambiguous-project ` Select the applicable TypeScript project when configurations overlap | ` ambiguous-project ` |
| ` ts-any-receiver ` Trace the origin of receivers typed as any | ` any-receiver ` |
| ` ts-candidate-set ` Distinguish TypeScript declaration alternatives from dispatch | ` (candidate set) ` |
| ` ts-competing-test-globals ` Identify the test framework that supplies the global | ` competing-test-globals ` |
| ` ts-computed-specifier ` Resolve statically known computed module names | ` computed-specifier ` |
| ` ts-deno-import-unverified ` Verify Deno import map resolution | ` deno-import-unverified ` |
| ` ts-index-signature ` Trace indexed properties to their declarations when possible | ` index-signature ` |
| ` ts-invalid-code ` Recover declarations in unreadable TypeScript files | ` invalid-code ` |
| ` ts-missing-global-types ` Supply the declaration of an untyped global | ` missing-global-types ` |
| ` ts-no-reason ` Recover TypeScript targets with no stored explanation | ` (no reason) ` |
| ` ts-no-symbol ` Recover TypeScript lookups without a target symbol | ` no-symbol ` |
| ` ts-not-a-module ` Verify imports of files treated as scripts | ` not-a-module ` |
| ` ts-object-producer-unverified ` Trace the object that provides a member | ` object-producer-unverified ` |
| ` ts-target-unavailable ` Locate a declaration the compiler can name but the graph cannot read | ` target-unavailable ` |
| ` ts-unit-only ` Review TypeScript links that name modules alone | ` (unit only) ` |
| ` ts-unknown-receiver ` Narrow the TypeScript receiver from unknown | ` unknown-receiver ` |
| ` ts-unresolved-alias ` Resolve the TypeScript path alias | ` unresolved-alias ` |
| ` ts-untyped-require ` Locate declarations for untyped require results | ` untyped-require ` |
| ` ts-workspace-build-output-missing ` Find the exported declaration when a workspace build output is absent | ` workspace-build-output-missing ` |
| ` ts-workspace-manifest-unreadable ` Read the manifest needed to classify a workspace package | ` workspace-manifest-unreadable ` |

## Reused

` go-external-result `, ` go-interface `, ` rust-import `, ` rust-macro `, ` rust-trait `, ` ts-config `, ` ts-local-access `, ` ts-package `, ` ts-package-chain `, ` ts-relative `, ` ts-runtime `, ` ts-workspace `

## Retired

| Previous item | Reason for retirement |
| --- | --- |
| ` go-container ` | Container element types are one source of receiver information. The stored receiver-type reason includes them and other receiver forms. |
| ` go-external-fields ` | The graph groups these with other unproved library members and unknown receiver types. The source review distinguishes field and embedding examples. |
| ` go-external-import ` | Shipped for proved package bindings. Remaining module-choice and unknown-receiver cases have their own rows. |
| ` go-external-targets ` | Shipped. The fresh graph stores library symbol targets directly. |
| ` go-factory ` | Return-value and field propagation share the stored receiver-type and library-member reasons with other calls. |
| ` go-fields ` | The graph groups these with other unknown receiver and declaration lookups. It has no stored reason specific to local fields. |
| ` go-file-broken-fixture ` | File diagnostics are tracked separately. Source files that emit no links contribute no stored misses. |
| ` go-file-go-grammar ` | File diagnostics are tracked separately. Source files that emit no links contribute no stored misses. |
| ` go-generated ` | The graph records uncertain module choice and potentially unseen declarations. It has no stored reason specific to generated Go. |
| ` go-local-method ` | The receiver-type and potentially unseen declaration reasons cover the remaining local cases along with other receivers. |
| ` go-pointer-conversion ` | Shipped. The resolver links checked-in pointer conversions to their type declarations. |
| ` go-type-parameter ` | The old sample grouped these by source syntax. The graph reports their remaining lookups under the stored receiver, declaration or unexplained groups. |
| ` go-typed-reference ` | The fresh groups distinguish unclear package destinations, unseen declarations and missing receiver types. |
| ` rust-chain ` | A chain can fail at a receiver, callee or later method lookup step. The current inventory groups by the actual stored blocker. |
| ` rust-external-targets ` | Shipped. The fresh graph stores library symbol targets directly. |
| ` rust-file-rust-parameter-attribute ` | Shipped. The grammar reads parameter attributes in the affected pins. |
| ` rust-file-rust-snapshot-macro ` | Shipped. The grammar reads the nested token trees in the affected snapshot fixtures. |
| ` rust-file-template ` | File diagnostics are tracked separately. Unrendered source can emit no links. |
| ` rust-glob ` | No below-Level-2 link in the fresh finished Rust graphs has this as its first stored reason. The archive retains secondary reasons. |
| ` rust-imported-function ` | The graph groups these with other namespace and import lookups. It does not distinguish imported functions by reason. |
| ` rust-let ` | The receiver-type group includes both local binding inference and other sources of receiver types. |
| ` rust-parameter ` | The graph has no stored reason specific to generic parameters. The current groups use each parameter lookup's stored reason. |
| ` rust-self-trait ` | The current reasons distinguish associated owners, applicable implementations and trait dispatch. |
| ` rust-std-path ` | The graph distinguishes unresolved path types from prelude and other namespace questions. Standard-library targets appear in several groups. |
| ` rust-std-receiver ` | The stored receiver and method lookup reasons cover both local and external owners. The sample distinguishes what needs library source. |
| ` rust-taint ` | Mislabelled. The old aggregate assigned unrelated misses to failed files. The narrower reason covers only lookups that can reach a failed file. |
| ` rust-typed-receiver ` | The graph groups explicit and inferred receiver types together when it cannot complete the lookup. |
| ` rust-value ` | Local values and patterns appear in the unexplained and namespace groups. The old source-review label was broader than a stored reason. |
| ` ts-bundle ` | Compiled bundles can miss a local anchor for the same reason as other files. The local declaration item covers these links. |
| ` ts-bundle-flow ` | The graph groups bundle flow alongside other receiver and object producer lookups. |
| ` ts-config-preset ` | Combined under incomplete configuration, which covers missing presets and other incomplete settings. |
| ` ts-external-targets ` | Shipped. The fresh graph stores library symbol targets directly. |
| ` ts-inline ` | The graph has no reason specific to immediately invoked functions. Remaining calls use the local declaration or other stored reasons. |
| ` ts-local-chain ` | The fresh reasons distinguish object producers from any and unknown receivers. |
| ` ts-nested-function ` | The graph groups nested declarations lacking an anchor with other local declarations. |
| ` ts-object-member ` | Member lookups can fail at the producer, receiver type or declaration anchor. The new rows follow those stored reasons. |
| ` ts-script-tag ` | The graph does not label links by the presence of a browser script tag. Relevant missing targets use the stored runtime, global or receiver reasons. |
| ` ts-type-parameters ` | Shipped. The generic parameter anchors settled the 23 previously tracked reference sites. |
| ` typescript-file-broken-fixture ` | File diagnostics are tracked separately. Source files that emit no links contribute no stored misses. |
| ` typescript-file-manifest-bom ` | File diagnostics are tracked separately. A manifest is context for linking and does not emit links of its own. |
| ` typescript-file-template ` | File diagnostics are tracked separately. Unrendered source can emit no links. |
| ` typescript-file-tsconfig ` | File diagnostics are tracked separately. Configuration blockers on emitted links have their own row. |
