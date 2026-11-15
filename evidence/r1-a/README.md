# R1-A evidence

All runs on the dev server (`pymtheg-dev`, Node 24.21.0), from branch
`r1-a-remove-tlc-quint` with `origin/main` merged in (merge base `d1b3b387`), from
a fresh mirror, under `no-java.sh`: `PYM_TLC_JAR`
and `JAVA_HOME` unset, every PATH entry naming java/jdk removed, and a shim
directory first on PATH whose `java` and `quint` log each call and exit 127.
Every run ended with an empty shim log (nothing tried to start Java or Quint).
No browser was used; Studio was checked over HTTP only.

- `no-java.sh` — the wrapper.
- `checks.log` — `npm ci --ignore-scripts`; `npm test` 2,672 passed, 0 skipped; `npm run test:backend`
  96 passed, 1 skipped (the existing Rust `num-bigint` offline-registry skip,
  unrelated to Java; the same skip is on `main`), 0 failed; `npm run build`;
  `npm run format:check`; `npm pack --dry-run` totals.
- `smoke.mjs` / `smoke.json` — `check`, `verify` and `simulate` on every
  flow/machine entry of the 33 `.pym` files under `examples/`; `emit --target json`
  for a machine and a flow; the removed `--target quint` refused; `doctor` (Node,
  Verifier, Simulator, Storage, Go/Rust/TypeScript code graph, Studio: all ready,
  exit 0);
  Studio started from the CLI and its page fetched (HTTP 200, app served); the MCP
  server's tool list (17 tools), `project_info` without a `tools` field, and an
  MCP `verify`. No B104 engine failure and no unreplayed counterexample anywhere.
  Every exit-2 entry is a B001 lowering preflight (scope needed or construct
  unsupported), as in W2-A's differential.

Baseline on `9ef82001` (the original base) before the change, Java present and
`PYM_TLC_JAR` set: `npm test` 2,570 passed; `npm run test:backend` 96 passed,
1 skipped. On that base the change gave 2,566 (four tests about the external
process removed, net); the rebase brought in main's new tests. `package.json`
and the lockfile did not change on main between the two bases, so the sizes
below hold for both; they were measured again after the merge with the same
result (`engines` changed to `>=24`, no dependency changed).

## Dependency and package size

| Install (`npm ci --ignore-scripts`) | Before | After |
|---|---|---|
| Full: `node_modules` bytes / packages | 166,322,909 / 253 | 140,287,122 / 183 |
| Production (`--omit=dev`): bytes / packages | 107,459,954 / 213 | 78,711,187 / 134 |

`npm ls @informalsystems/quint` is empty after the change, and no package in the
full tree is named for Quint. `npm pack --dry-run`: 882 files, 2.3 MB packed,
10.2 MB unpacked; no packed file name refers to TLC, TLA+, Quint or Java.
