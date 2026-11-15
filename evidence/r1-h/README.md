# R1-H evidence

All runs on the dev server, Java hidden (`evidence/r1-a/no-java.sh`), on head
`5bbeaff6` (origin/main merged in; later commits change only evidence). Official Node builds were downloaded from nodejs.org into the
run's scratch directory and checked against `SHASUMS256.txt`.

- `checks.log`: `npm ci`, `npm test` (2,784 passed, 0 skipped),
  `npm run test:backend` (96 passed, 1 existing skip: Rust `num-bigint` not in
  the offline cargo registry), `npm run build`, `npm run format:check`, the
  licence `--check` and the `npm pack` totals, all from a fresh mirror on Node
  24.21.0. Then `npm test` on official Node 24.0.0, 25.2.1, 25.9.0 and 26.13.1:
  all 2,784 pass on each, except one skip on 26.13.1 (an existing environment
  test: no TypeScript nesting depth reproduces the binder stack overflow there).
  ExperimentalWarning lines that still appear in a test log come from the test
  runner's own process (tests import `dist/` modules in-process, without the CLI
  entry); no CLI, MCP or Studio process prints one.
- `tarball-smoke.mjs`: installs a packed tarball with production dependencies
  only into a fresh directory and exercises help, check, verify, simulate,
  doctor, graph index and definite cross-file callers (TypeScript, Go, Rust), MCP
  `initialize` + `tools/list`, and Studio (page and script asset over HTTP,
  SIGINT stop). `tarball-smoke-before.json` (main's dependencies, same build)
  and `tarball-smoke-after.json` (this branch): every step passes in both;
  `node_modules` 88,964,435 → 52,960,811 bytes, 134 → 11 packages,
  `npm warn` lines 6 → 0.
- Round 1 (head after merging main, fresh mirror, Java hidden): `npm test`
  2,806 passed, 0 skipped; `npm run format:check` passes; `npm run test:backend`
  96 passed plus the existing Rust skip; licence `--check` passes; `npm pack`
  831 files (1.8 MB packed, 9.1 MB unpacked) after `docs/` was trimmed to user
  documentation; the tarball smoke passes with 51,337,201 bytes, 11 packages and
  no warnings; `test/r1h-packaging.test.mjs` (warning filter overloads) passes
  on official Node 24.0.0 and 25.2.1.
- `npx-signal-probe.mjs`, `noexec-sh`, `npx-signals.jsonl`: one SIGINT to the
  `npx ./pymtheg-1.0.0.tgz studio|mcp` process after readiness. With npm's
  default `sh` (which replaces itself with the command on this host) nothing
  survives; with `noexec-sh` as npm's script shell (a shell that stays the
  command's parent, as in R1-F's image) npm, the shell and the server all keep
  running (recorded after a named 20 s safety budget, then killed). Also run
  with the npm bundled in official Node 24.0.0 (11.3.0), 24.22.3 (11.19.1),
  25.9.0 (11.12.1) and 26.13.1 (11.20.0), SIGINT and SIGTERM, Studio: no
  survivors with the default shell.
