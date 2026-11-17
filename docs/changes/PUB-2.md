# PUB-2: the package is publishable

The owner decided on 17 November 2026 to publish Pymtheg to npm as `pymtheg`,
version `0.1.0`. This change makes the package ready; it publishes nothing.

## package.json

- Removed `"private": true`.
- Added `description` (the README's own one-line description), `keywords`,
  `homepage`, `bugs`, `repository` (the GitHub repository), `author` (the
  copyright holder named in `LICENSE`) and `"publishConfig": {"access": "public"}`.
- `version` is `0.1.0` (the owner's decision, 17 November 2026), not `1.0.0`.
- Nothing else changed: dependencies, scripts, `files` and `bin` are as before,
  so the shipped file list is unchanged. `package-lock.json` changed only in its
  two root `version` fields; it records none of the added metadata.

## Version 0.1.0

Pymtheg's own version is read from one place, `identity.version` in
`src/shared/identity-values.ts`: `pymtheg --version`, the MCP server info,
`doctor`, report `toolVersions.pymtheg` and the TypeScript implementation
module's version string all use it. It is now `0.1.0`, and a new test,
`test/package-version.test.mjs`, requires it to equal `package.json` and both
root versions in `package-lock.json`. The acceptance self-test names its
sabotaged tarballs after the real one instead of a fixed `pymtheg-1.0.0.tgz`,
and its fake `--version` output says `0.1.0`.

Left alone on purpose: `semantics: "1.0"` and `pymtheg.report/v1` (format and
semantics versions, not the package version); `acc-app` `1.0.0` in the
acceptance driver (a fixture app); dependency, licence-identifier and fixture
versions; `docs/1.0-status.md`, `docs/roadmap-1.0.md` and other dated reviews
(history).

## Acceptance gate

`scripts/acceptance/run.mjs` reported `package-private` with a reason that
assumed the flag was set. It now reports either state truthfully, and a new
`registry-npx` step (observed, not required) says that `npx pymtheg` from the
registry is not verified: every scenario installs the local tarball. The gate
never reports the registry install as passing; the owner checks it by hand after
publishing.

## Package-contents test

`test/package-contents.test.mjs` fails when a shipped file names the owner,
except the licence texts. The `author` field adds the name to `package.json`,
so the rule now also allows exactly the top-level `"author": "..."` line of
`package.json`. Any other line of `package.json` naming the owner still fails; a
new test case covers both.

## Documents

- `CONTRIBUTING.md`: a "Publishing" section with the owner's manual steps.
- `docs/decisions.md`: the D12 row and a new entry, "The package is publishable".
- `README.md` statements ("The package is private", "not published yet") are
  rewritten by PUB-3, not here.
- Earlier ledger paragraphs (`docs/build-plan.md`, `docs/changes/`) are history
  and unchanged.
