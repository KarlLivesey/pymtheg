# W2-Q: the skipped Rust real-compiler contract test

`npm run test:backend` skipped "rust: real rich contracts compile with recursive
records, outcomes and arbitrary precision integers" on every run.

## Cause

Not a detection bug, a budget or a toolchain gap. The test copies
`test/fixtures/rust-rich/Cargo.toml` and `Cargo.lock` into a scratch crate and
runs `cargo check --offline --locked`. The fixture pinned `num-bigint =0.4.6`
and its lock pinned `num-integer 0.1.47`. This machine's offline cargo cache
(`~/.cargo/registry/cache/index.crates.io-*`) holds `num-bigint 0.4.8` and
`num-integer 0.1.46` and has never held the pinned versions, so cargo 1.98.1
failed before compiling:

```
error: failed to download `num-bigint v0.4.6`
Caused by:
  attempting to make an HTTP request, but --offline was specified
```

The test matched "attempting to make an HTTP request" and skipped with a
generic reason that named no crate.

## Change

- `test/fixtures/rust-rich/Cargo.toml`: pin `num-bigint =0.4.8` (same 0.4 line
  the generated contracts ask for).
- `test/fixtures/rust-rich/Cargo.lock`: regenerated with
  `cargo generate-lockfile --offline` (num-bigint 0.4.8, num-integer 0.1.46,
  num-traits 0.2.19, autocfg 1.5.1); still committed and checked with
  `--locked`, so builds stay reproducible and no network is used.
- `test/contracts-regeneration.integration.mjs`: an `unavailableReason` helper
  gives precise skip reasons: the tool that could not start, the explicit
  timeout budget that ran out, or the exact crate and version missing from the
  offline cache or registry index. Budget exhaustion is still reported as
  unresolved, never a pass. The first test's compiler-unavailable skip uses the
  same helper.

No generator change was needed. The generated Rust contracts (recursive
`Vec<Input>` record, `BigUint`/`BigInt` fields, `Failure` enum, `Result`)
compile cleanly with num-bigint 0.4.8, and the changed-result variant is
rejected by rustc naming `decide`.

## Owner notes

Nothing needs fetching on this machine. A machine whose offline cache lacks
num-bigint 0.4.8 (or its locked dependencies) will skip with, for example,
"crate num-bigint v0.4.8 pinned by test/fixtures/rust-rich/Cargo.lock is not in
the offline cargo cache".

Evidence: `evidence/w2-q/` (cache listing, old-fixture failure, re-pinned
fixture check, test runs including an empty-cargo-home skip-reason check).
