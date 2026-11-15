# LIC-1: MIT licence

Part 1 of the licence work: the licence file, a contributing note, a README
section and a decision ledger entry. No package, source, test or generated file
changes.

The branch first carried an RPL-1.5 licence with an output exception and a
plugin statement; the owner then chose MIT (15 November 2026). Those commits
remain in the branch history; `LICENSE-EXCEPTIONS.md` is deleted.

## Added

- `LICENSE`: the MIT License text from SPDX (`spdx/license-list-data`,
  `text/MIT.txt`, last changed at commit
  `279b7e997a87c09be00dd6bdda189519ade502cf`; template SHA-256
  `b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5`). It
  differs from the template only in the copyright line,
  `Copyright (c) 2026 Karl Livesey`.
- `CONTRIBUTING.md`: contributions are accepted under the MIT License; the
  contributor confirms the right to submit.
- README "Licence" section.
- Decision ledger entry in `docs/decisions.md`.

`npm run format:check` does not cover Markdown or `LICENSE`.

## Part 2 (LIC-2)

1. `package.json`: `"license": "MIT"`. Keep `"private": true`.
2. `docs/licences.md`: a line for Pymtheg's own licence (MIT), separate from
   the third-party inventory.
3. A one-line `SPDX-License-Identifier: MIT` tag on first-party source files,
   with a test that fails when a file in scope lacks it. MIT does not require
   per-file notices; the tag carries out the owner's earlier request that files
   carry the licence.
   - In scope: `src/` (including the shipped
     `src/graph/languages/go/toolchain/golinks.go`), `web/src/`, `scripts/`,
     `test/` (test code, not fixtures), `grammars/build.mjs`,
     `web/vite.config.ts`, `web/index.html`, and the root `pymtheg` launcher.
     To decide in LIC-2: `tsconfig.json`, `web/tsconfig.json`,
     `assets/icon.svg`, the root `test.pym` starter design and prose in
     `docs/`.
   - Excluded: vendored grammars and their patches (`grammars/go`,
     `grammars/rust`, upstream `LICENSE` files), third-party files and bundled
     third-party code, generated files (`dist/`, `dist-web/`, built `.wasm`,
     `THIRD-PARTY-NOTICES` and other generated inventories), test fixtures,
     scaffold and example files (`examples/` except `examples/plugins/`, which
     gets the tag) and documentation examples. `research/`, `evidence/` and
     historical logs are not rewritten.

Nothing else.
