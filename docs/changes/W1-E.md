# W1-E: implementation checks from files that also hold machines

## Contract change

`ContractDocument.omitted` entries are now a typed union (`ContractOmission`,
`src/contracts/document.ts`):

- **Unresolved** (`UnresolvedContractOmission`, no `applicability` field):
  contract material the output should cover but cannot (unparsed source,
  duplicate identity, unresolved type or dependency, unsupported construct, or
  a plugin-declared omission). Unchanged meaning.
- **Not applicable** (`NotApplicableContractOmission`,
  `applicability: "not-contract-material"`): a declaration that is not
  interface-contract material at all. Today only a behavioural `machine`
  (with its states, events and invariants) gets this marker, and only when its
  file parsed fully. A machine in a partially parsed file stays unresolved,
  because the file's contract coverage is unknown.

Only the explicit marker exempts an omission (`isNotContractMaterial`).
Anything without it, including plugin omissions and older documents, is
treated as unresolved. That keeps the default fail-closed.

## Implementation check (`emitImplementationCheck`)

- Unresolved omissions still refuse. The message now names up to five of them
  with their reasons.
- Not-applicable omissions no longer block emission. They are returned as
  `notChecked: {name, reason}[]`, named in a comment line in the generated
  TypeScript, Go or Rust check, and named in `instructions`. The check never
  claims to cover them.
- A design whose only declarations are not applicable (machines only) refuses
  with "no interface contracts to check" instead of emitting an empty check.

## Unchanged on purpose

- Every other reader of `omitted` (CLI exit code and messages, manifest
  baseline saving, drift `incomplete`/`matches`, MCP and Studio counts, plugin
  merging) keeps counting machines as omitted, exactly as before.
- The contract manifest (`pymtheg.contract-manifest/v1`) keeps emitting
  `{name, reason}` only, so built-in baselines are byte-identical. Its reader
  also accepts the optional marker, because plugin manifests copy document
  omissions verbatim.
