# Contributing to Pymtheg

Contributions are accepted under the MIT License ([LICENSE](LICENSE)). By
submitting a contribution you confirm that you have the right to submit it
under that licence.

New source files start with the line `SPDX-License-Identifier: MIT` in a
comment (after a shebang, if any). `node scripts/spdx-tags.mjs` adds it;
`test/licence-tags.test.mjs` checks it.

## Publishing

The owner publishes by hand; no script or CI job publishes. From an empty
directory:

```sh
git clone https://github.com/KarlLivesey/pymtheg.git && cd pymtheg  # main
npm ci --ignore-scripts
npm run build
npm test
npm pack --dry-run   # check the file list and size against the last release
npm publish
```

Then, from another empty directory, check the published package:

```sh
npx pymtheg@<version> --version
```
