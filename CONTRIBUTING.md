# Contributing to Pymtheg

Contributions are accepted under the MIT License ([LICENSE](LICENSE)). By
submitting a contribution you confirm that you have the right to submit it
under that licence.

New source files start with the line `SPDX-License-Identifier: MIT` in a
comment (after a shebang, if any). `node scripts/spdx-tags.mjs` adds it;
`test/licence-tags.test.mjs` checks it.

## Publishing

The owner publishes by hand; no script or CI job publishes. You need an npm
account with publish rights: `npm login`, then `npm whoami` must print it.

1. Choose a version not yet on npm (`npm view pymtheg versions`); npm refuses
   to publish a version that already exists, even one that was unpublished.
   Set it in the three places that must agree: `version` in `package.json`,
   both root `version` fields in `package-lock.json`, and `identity.version`
   in `src/shared/identity-values.ts` (`test/package-version.test.mjs` fails
   if they differ). Merge that change to `main`.
2. From an empty directory, on a clean checkout of `main`:

   ```sh
   git clone https://github.com/KarlLivesey/pymtheg.git && cd pymtheg
   npm ci --ignore-scripts
   npm run build
   npm test
   npm pack --dry-run   # name, version and file list
   npm publish
   ```

   Check the `npm pack --dry-run` list: it must match the file count the
   acceptance gate's `tarball-contents` step reported for the same commit, and
   any change from the previous release (if there is one) must be intended.
3. From another empty directory, check the published package:

   ```sh
   npx pymtheg@<version> --version
   ```
