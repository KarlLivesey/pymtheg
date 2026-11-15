# LIC-1: RPL-1.5 licence, output exception and plugin statement

Part 1 of the licence work. New files and a README section only; no package,
source, test or generated file changes.

## Added

- `LICENSE`: the Reciprocal Public License 1.5 text, byte for byte as published
  by SPDX (`spdx/license-list-data`, `text/RPL-1.5.txt` at commit
  `31846481de7ea17d92f2f46fad76abe58b2e9bb0`; SHA-256
  `9bdb5f2d585451eb429d69f48ae0b7c6bd3954eb6431b3d644a7cbec074e9ecc`). It was
  compared word by word with the Open Source Initiative's copy; the only
  differences are typography (curly quotes, em dashes, two line-break hyphens)
  and the OSI page omitting "(d):" after "Section 6.4" in Exhibit B. Nothing is
  filled in: Exhibit A has no blanks and Exhibit B is optional and left empty
  (see the PR for why). The copyright line is in `LICENSE-EXCEPTIONS.md` and the
  README, not inside the licence text.
- `LICENSE-EXCEPTIONS.md`: part 1, an additional permission for Pymtheg's
  output, the files `pymtheg init` writes (`.pymtheg/project.json`,
  `.pymtheg/settings.json`, `.pymtheg/.gitignore`) and the bundled examples,
  recipes and templates used as starting points, excluding `examples/plugins/`;
  part 2, the plugin statement.
- `CONTRIBUTING.md`: contributions under the same licence; the contributor
  confirms the right to submit.
- README "Licence" section.
- Decision ledger entry in `docs/decisions.md`.

`npm run format:check` does not cover Markdown or `LICENSE`, so no ignore entry
was needed.

## Part 2 (LIC-2)

1. `package.json`: `"license": "SEE LICENSE IN LICENSE"` or `"RPL-1.5"` plus the
   exception (npm has no SPDX `WITH` exception for this text; `SEE LICENSE IN`
   avoids implying plain RPL-1.5), and add `LICENSE`, `LICENSE-EXCEPTIONS.md` and
   `CONTRIBUTING.md` to `files`. Keep `"private": true`.
2. `docs/licences.md`: a line for Pymtheg's own licence (RPL-1.5 with
   `LICENSE-EXCEPTIONS.md`), separate from the third-party inventory.
3. Per-file headers: the Exhibit A License Notice verbatim (both paragraphs),
   preceded by `Copyright (C) 2026 Karl Livesey` and followed by a pointer to
   `LICENSE-EXCEPTIONS.md`. Optional `SPDX-License-Identifier: RPL-1.5` is a
   convenience, not a substitute for the notice. Files that cannot hold a
   comment (JSON) are covered by a notice in a location a user would look
   (Section 6.4(b)), for example the README and `LICENSE-EXCEPTIONS.md`.
4. In scope for headers: `src/` (including the shipped
   `src/graph/languages/go/toolchain/golinks.go`), `web/src/`, `scripts/`,
   `test/` (test code, not fixtures), `grammars/build.mjs`, and the root
   `pymtheg` launcher. A test fails when a file in scope lacks the header.
5. Excluded from headers: vendored grammars and their patches (`grammars/go`,
   `grammars/rust`, upstream `LICENSE` files), third-party files and bundled
   third-party code, generated files (`dist/`, `dist-web/`, built `.wasm`,
   `THIRD-PARTY-NOTICES` and other generated inventories), test fixtures, and
   scaffold and example files covered by the additional permission
   (`examples/` except `examples/plugins/`, which does get the header), and
   documentation examples.
   `research/`, `evidence/` and historical logs are not rewritten.
6. Order: headers before the repository is made public. Section 1.0 applies the
   licence to Software "containing a License Notice", and until then only the
   `LICENSE` file itself contains the notice text.
