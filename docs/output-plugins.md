# Language output and emitter plugins

Contract scaffolding is an output stage after checking. It must not reparse source,
change the typed model, or invent a missing implementation. Built-in targets are
TypeScript, Rust and Go. The default remains TypeScript for compatibility.

The boundary is a versioned `pymtheg.contracts/v1` document: source snapshot ID,
resolved symbol IDs/spans, mathematical types, records/unions/resources, callable
signatures, passing modes and human-readable contract obligations. Blocked
symbols are omitted by one authoritative builder. Emitters only choose target
syntax and name mappings. They return source, mapped symbol IDs, omissions,
dependencies and limitations. A new target does not require compiler changes.

`pymtheg scaffold FILE --target rust|go|typescript [--body fail-fast|empty] [--format json]` selects a
built-in. `--plugin /absolute/emitter.mjs --target TARGET` explicitly runs a trusted
local Node emitter. Plugins export `apiVersion = 'pymtheg.emitter/v1'`, a `target`
identifier, `extension`, and `emit(document) -> {source, symbols, notes,
dependencies, bodyPolicy}`. The document includes the requested `bodyPolicy`. `symbols` maps source symbol IDs to generated names. The host checks
version, target, output shape, bounds and symbol identities. It adds the frozen
snapshot and omission list itself. Invalid output is an integration failure.

Plugins run in an owned subprocess with a deadline, output cap and cancellation;
the process lifecycle is shared with checkers. This is isolation for lifecycle,
not a security sandbox. A plugin is executable code with the user's permissions.
Source files, project configuration and MCP requests cannot select arbitrary
plugins. Only explicit launch configuration loads one. No download or discovery
from the network. Studio/MCP requests select registered target IDs, never module paths. Plugin sources receive the contract document, not whole source
files or live compiler objects. Contracts may still contain sensitive identifiers
and expressions; review a plugin before running it.

Built-in targets default to compile-ready **fail-fast stubs**: TypeScript throws
`new Error("Not implemented")`, Rust uses `todo!("Not implemented")`, and Go
uses `panic("Not implemented")`. This applies to Unit functions too: missing
implementation never silently succeeds. CLI `--body empty`, MCP `body: "empty"`,
and Studio's Function bodies selector preserve literal empty bodies. The returned
`implementation` field records the confirmed `fail-fast` or `empty` policy.
Plugins must confirm an explicitly requested policy; the host never rewrites
arbitrary languages. Legacy CLI emitters without policy metadata remain
`plugin_defined` only when no `--body` was requested. Neither mode contains
business logic or establishes implementation correctness.

 Rust uses `num_bigint::BigInt/BigUint` for
mathematical integers and declares that dependency without installing it. Go uses
`math/big.Int`; Nat nonnegativity and ownership rules remain obligations. Go
represents closed tagged unions with an interface and empty marker methods.
Literal empty non-unit return bodies can fail return checking. Default stubs are
compiler-tested with records, tagged outcomes, booleans and Unit returns.

A working fourth-target example ships in `examples/plugins/javascript.mjs`:

```sh
pymtheg scaffold design.pym --target javascript --plugin ./examples/plugins/javascript.mjs
```

It emits JavaScript with JSDoc contracts and fail-fast stubs (or explicit empty bodies), using only the
versioned document. For typed plugin development, import `ContractDocument` from
`pymtheg/dist/contracts/document.js`. Exported runtime modules are local trusted
code; the CLI does not search package registries. Output metadata distinguishes
`builtin_scaffold` from `plugin_declared` assurance. Plugin syntax and semantic
faithfulness need independent validation; the host validates transport and source
identity, not arbitrary target languages.


Built-ins preserve recursive named interfaces using target representation choices:
Rust uses `Box` on cyclic inline storage references; Go uses pointers on recursive
record storage (union interfaces and slices already provide indirection). Function
signatures retain their named types. These layouts compile but do not establish
valid construction, nil safety or lifecycle conformance. Type names are allocated
so user definitions cannot shadow the emitted primitive meanings.

## Register an output language for Studio or an agent

```sh
pymtheg studio PROJECT --plugin javascript=/absolute/emitter.mjs
pymtheg mcp PROJECT --plugin javascript=/absolute/emitter.mjs
```

Registered targets appear beside the three built-ins. Studio's output selector
and MCP `emit_scaffold` use the same checked contract document and body policy.
Each entry file is limited to 1 MiB and fingerprinted as bytes at launch; changing
it requires restarting and explicitly registering it again. Dependencies imported
by the entry remain trusted executable code, not a frozen dependency tree.
Shutdown cancels and reaps running emitters. Registered emitters must report the
requested body policy; confirming it is a plugin claim, not a semantic proof.

## Public Go names

Pymtheg's supported declarations have no underscore-based visibility rule. Go
output therefore removes leading underscores when forming exported declaration
and field names; an empty or numeric-leading remainder receives a `Value` prefix.
Existing deterministic allocators resolve collisions. For example, `_Order` and
`Order` remain separate source identities and may map to `Order` and `Order2`.
Use the returned symbol map for declaration names. Field comments retain their
source names. External-consumer compilation is checked, as well as compiling the
generated package on its own. This changes target spelling, not the source IR.

Registration imports the explicitly configured module in an owned subprocess
to validate `apiVersion`, `target`, `extension` and the `emit` export before the
UI or MCP lists it. Module initialisation runs at registration. A hung import
is bounded and cleaned up. This checks metadata, not emitted language validity.

## Keep handwritten implementations safe when contracts change

Use `--mode contracts` to generate data declarations and a `PymthegContracts`
interface (TypeScript/Go) or trait (Rust). Implement that contract in a separate
handwritten file. Regenerate only the contract file after design changes; your
compiler will reject incompatible implementations. This checks language-level
signatures, not business rules, effects or ownership beyond the target language.

```sh
pymtheg scaffold design.pym --target typescript --mode contracts --manifest contracts.manifest.json > contracts.ts
pymtheg scaffold design.pym --check contracts.manifest.json
pymtheg scaffold design.pym --check contracts.manifest.json --format json
```

`--manifest` saves an atomic, versioned comparison baseline. `--check` reads it
without rewriting source or the baseline; exit 1 means declarations changed,
exit 2 means omitted contracts prevent a complete comparison. Both stubs and
contracts mode share the manifest. It excludes implementation bodies, snapshot
hashes and source coordinates. IDs are relative to the common source directory
(or a supplied workspace root); changing the selected module set may report
path changes as removals/additions. A matching manifest is not an implementation
conformance proof. Use the returned symbol map for target-language names.

Studio's Code view offers **Output purpose → Maintain separate
contracts**, a preview/download, **Save contract comparison baseline**, and
**Compare with a saved contract baseline**. MCP `emit_scaffold` accepts
`mode: "contracts"` and returns `contractManifest` beside the source. Default
`mode: "stubs"` preserves fail-fast bodies.

Plugins receive `outputMode: "stubs" | "contracts"`. They must return
`outputMode: "contracts"` to confirm the latter; older plugins fail explicitly
when it is requested. The shipped JavaScript emitter supports contracts through
JSDoc function/object types. The host does not rewrite arbitrary plugin syntax
or claim its output is compiler-verified.

Use `--plugin-timeout 30s` (1ms–120s, default 5s) on `scaffold`, `studio` or `mcp`
to choose an explicit plugin registration/emission budget. Studio includes that
budget and plugin paths in copied agent configuration. Expiry is an integration
failure, never a passed check. Local lifecycle tests control their clocks.

The manifest compares declared signatures and contract notes, not implementation
progress notes. Resolving a body-only open question does not produce signature
drift; interface effects, passing modes, preconditions and bounds still do.

The richer regression fixtures compile recursive records, tagged results and
arbitrary-precision fields with a real Rust dependency: num-bigint 0.4.8 and the
transitive versions/checksums in `test/fixtures/rust-rich/Cargo.lock`. Its licence
is MIT OR Apache-2.0. The integration test uses Cargo offline (set PYM_CARGO_HOME
to a populated cache); missing dependencies remain unresolved evidence. No
stand-in BigInt implementation is used. Equivalent TypeScript and Go consumers
accept the matching interface and reject a changed result signature.

Plugin stdout is reserved for the host protocol. Use `console.error` for diagnostic
logging; `console.log` corrupts the response and is rejected. Mapping errors name
the unknown, duplicate or omitted source identities so the emitter author can
correct the exact declaration.

## Checking exact implementation signatures

In TypeScript, `implements PymthegContracts` alone permits methods with fewer
parameters. Import the generated type helper and add this type-only check in the
implementation file:

```ts
import type { PymthegContracts, PymthegImplementation } from "./contracts";
// class Shop implements PymthegContracts { ... }
export type ContractCheck = PymthegImplementation<Shop>;
```

For an object implementation, use `PymthegImplementation<typeof implementation>`.
The helper checks the exact input tuple as well as ordinary interface assignment.
It emits no runtime implementation. Without this check TypeScript does not reject
an implementation solely for ignoring a newly added input.

In Go, add the generated interface assertion in your implementation package:

```go
var _ PymthegContracts = (*Shop)(nil)
```

Rust's ordinary trait implementation checks parameter lists directly. Real compiler
regressions now test added parameters and changed return types in all three targets.
These checks do not establish the business behaviour of handwritten code.

## Requested future target

Apex is wanted as an additional output target later. It belongs in the
emitter-plugin extension path and is deliberately deferred to a future session;
no Apex emitter is part of the current implementation or completion claims.

Output coordinates use project-relative paths. `sourceRoot` is `"."`, declaration
`symbolId` values match the IDs referenced by named types, and `span.file` uses
the same root. Return the supplied IDs unchanged in `symbols`/`omitted`; absolute
filesystem identities are internal to checking and are not an output-plugin API.

## Generate an implementation check

In Studio's **Code** view, choose **Maintain separate contracts** and fill in
**Connect your implementation to these contracts**. Preview and download the
separate check file, then include it in your ordinary build. The preview does
not run a compiler or claim that the implementation behaves correctly.

For TypeScript:

```sh
pymtheg scaffold design.pym --mode contracts --target typescript \
  --implementation PaymentService --implementation-module ./payment \
  --contracts-module ./contracts > implementation.check.ts
```

The generated check imports the implementation type and applies the exact-input
helper, so adding an input to the design rejects an old implementation even
when TypeScript's ordinary interface assignment would accept it. Include the
file in `tsconfig.json` and run the project's normal typecheck.

For Go, use `--target go --implementation '*PaymentService'` and save the result
as `implementation_check.go` in the same package as both contracts and implementation.
This supported check uses a pointer method set. For Rust, use `--target rust
--implementation crate::PaymentService --contracts-module crate::contracts`,
save as `implementation_check.rs`, declare the module in your crate and run
`cargo check`.

Agents use `emit_implementation_check` with a checked `runId`, `target`,
`implementationType`, (for TypeScript/Rust) `contractsModule`, and (for TypeScript)
`implementationModule`. Go checks use the same package and omit both module fields;
unsupported module settings are rejected. It returns source, a file suffix and build instructions;
no source files are written. Generation refuses incomplete contracts or a design
with errors. Additional language plugins still need their own integration checks;
this built-in generator supports TypeScript, Rust and Go only.

Callable declarations may include `maySuspend: true` when transitive typed effects
contain remote or IO work. The TypeScript emitter returns `Promise<T>` and emits
async fail-fast stubs for them; the JavaScript example follows the same policy.
Pure/local callables remain synchronous. Plugins should map this field to their
target's native calling convention without inventing implementation logic.
