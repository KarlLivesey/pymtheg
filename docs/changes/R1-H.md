# R1-H: packaging polish and licence inventory

Decision D19 (initial release) and the owner's publishing plan in
`docs/build-plan.md`; gap list from R1-F (PR 41). Evidence: [evidence/r1-h/](../../evidence/r1-h/README.md).

## A. Licence inventory (input to the owner's licence decision, since made: MIT)

`scripts/licences/inventory.mjs` (no new dependency) records exactly what the
published tarball installs or contains:

- the production npm tree, direct and transitive, from `package-lock.json`
  (entries not marked `dev`; optional ones are labelled), with each installed
  package's `package.json` and licence files;
- every npm package Vite puts into `dist-web/` with rendered code, read from
  the bundle's real module graph (an in-memory `vite build` with a capture
  plugin; nothing written);
- the code the build tools write into `dist-web/` themselves, attributed by
  the bundler's virtual module ids (`injectedOrigins`): `@rollup/plugin-commonjs`
  (CommonJS interop helper and module wrappers; vendored inside Vite, so its
  licence text is taken from its section of `vite/LICENSE.md` and its version
  from Vite's pinned `devDependencies`), Vite (module preload polyfill) and
  Rollup (the import/export statements linking chunks). A virtual module with
  no known origin is a blocking problem;
- the vendored grammars from `grammars/*/manifest.json` and their checked-in
  LICENSE files, with every patch and its origin;
- the Go helper `golinks.go` (its imports are parsed: standard library only);
- fonts and images referenced by the web app (none).

For each component: name, version, licence as declared (SPDX) and as found in
the licence file (recognised by wording), disagreements, missing licence text,
copyright lines, source URL and how it is shipped. `--write` produces the two
checked-in outputs, `docs/licences.md` and `THIRD-PARTY-NOTICES` (full licence
and notice texts, now listed in `package.json` `files`); `--check` exits 1 when
they are stale or a policy problem exists. `test/licences.test.mjs` regenerates
and compares, enforces the allow-list (MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense) and licence text for every
shipped component, checks `golinks.go` stays standard-library only, and tests
the SPDX and licence-text readers. Pymtheg itself is MIT licensed (`LICENSE`,
added by PR 46; `"license": "MIT"` added to `package.json` here, `"private": true`
unchanged); `docs/licences.md` states that, and that every shipped third-party
component is declared under MIT, Apache-2.0, BSD-3-Clause or ISC, which permit
redistribution inside an MIT-licensed package provided their notices are kept,
which `THIRD-PARTY-NOTICES` does.

### Summary (after the dependency moves in B.5)

101 shipped third-party components: 10 installed npm packages, 86 packages
bundled into `dist-web/`, 3 origins of code the build tools write into
`dist-web/` themselves (`@rollup/plugin-commonjs` 28.0.6, Rollup 4.68.0, Vite
7.2.2; all MIT), 2 vendored grammars.

| Licence (as declared) | Components | Which |
|---|---:|---|
| MIT | 96 | everything not listed below, incl. both vendored grammars, the three build-tool origins, React, CodeMirror, unified/remark, ajv, zod, web-tree-sitter |
| Apache-2.0 | 3 | `typescript` (also ships `ThirdPartyNoticeText.txt`, included), `@modelcontextprotocol/server`, `@modelcontextprotocol/core` |
| BSD-3-Clause | 1 | `fast-uri` (via ajv) |
| ISC | 1 | `@ungap/structured-clone` (bundled) |

- No copyleft (GPL, LGPL, AGPL, MPL) is shipped. Nothing is outside the
  allow-list. Every shipped component has its licence text.
- Licences embedded inside shipped packages (listed in their own section of
  `docs/licences.md`, so "outside the allow-list: none" is read as covering
  declared licences only): TypeScript's `ThirdPartyNoticeText.txt` carries MIT
  (DefinitelyTyped), the Unicode licence, the W3C licence and CC-BY-4.0 (WHATWG
  material); the MCP SDK's LICENSE also covers its documentation under
  CC-BY-4.0. TypeScript's own LICENSE has no copyright line (the copyright
  column says "none in its licence file").
- The npm dependencies follow `package-lock.json`, but a user's `npm install` of
  the tarball resolves transitive dependencies afresh within their version
  ranges, so a later install can drift from this inventory (noted in
  `docs/licences.md`; no shrinkwrap added).
- Flagged: the MCP SDK packages declare Apache-2.0, but their LICENSE explains
  a licensing transition from MIT: contributions whose authors have not agreed
  to relicensing stay MIT. The file carries both texts; treat them as Apache-2.0
  and MIT together. (Its documentation is CC-BY-4.0 per the same file; the npm
  package ships code, a README and the LICENSE.)
- Vendored: tree-sitter-go v0.25.0 (`1547678a`), MIT, Copyright (c) 2014 Max
  Brunsfeld, with upstream PRs #202 and #198 applied; tree-sitter-rust v0.24.2
  (`77a37472`), MIT, Copyright (c) 2017 Maxim Sokolov, with upstream PRs #319,
  #271, #317, #312, #283, #281 and two own patches (`0007` raw contextual
  identifier, `0008` safe qualifier). Built with tree-sitter-cli 0.27.2,
  wasi-sdk 34.0 and binaryen 132; the `.wasm` side modules import their few
  libc functions (`calloc`, `free`, `iswspace`, …) from web-tree-sitter at load
  time rather than linking a libc in. Not verified: whether the compiler linked
  any LLVM compiler-rt builtins into them (that would be Apache-2.0 WITH
  LLVM-exception, which waives notice for compiled code).
- The TLC JAR is never shipped (R1-A removed all use of it).

### A.4 Not shipped, for the owner's awareness

Nothing was deleted, moved or rewritten here; the owner decides.

Dev-only packages outside the allow-list: `axe-core` 4.11.4 and
`@axe-core/playwright` 4.11.0 (MPL-2.0; accessibility checks in browser tests).

Research and derived files in the repository that are not Pymtheg's own work,
or are derived from other projects:

| Path | What it is |
|---|---|
| `research/sources/*.txt` (37 files, 535 KB) and `research/sources/index.json` | Text captures of third-party documentation and web pages (Alloy, Dafny, F*, P, Quint, RAML, TLA+, VDM, Why3), fetched by `research/fetch_sources.py` on 8 November 2026. Copyrighted material with no licence to redistribute recorded; contains third-party names and email addresses (e.g. Quint and P authors). |
| `research/sources/tlc-binary.json` | Metadata about the TLA+ tools JAR (no JAR). |
| `research/results/tlc-*.txt` | TLC output logs; contain `/home/<owner>/...` paths. |
| `examples/checkout.qnt`, `examples/Checkout.tla`, `examples/double-charge.cfg`, `fixed.cfg`, `missing-refund.cfg`, `stock-leak.cfg` | Hand-written Quint/TLA+ research baseline. Written for this project, in the languages of Quint (Apache-2.0) and TLA+; no third-party text found. Not packed. |
| `evidence/w2-c/**` and other evidence with `"text": "…"` fields (58 files, mostly `evidence/w2-c`, `evidence/w2-c2`, `evidence/w3-g`) | Verbatim excerpts of **Vector** source code (MPL-2.0) and file paths and identifiers from Vector and **restic** (BSD-2-Clause), from graph-accuracy runs on the pinned corpora. MPL-2.0 is file-level copyleft: excerpts of Vector files stay under MPL-2.0. |
| `evidence/w2-b/*restic*`, `evidence/w1-e/restic-*` | Identifiers and summaries from restic; `restic-contracts.go`/`restic-backup_check.go` are Pymtheg-generated, not copied. |
| `evidence/w2-a/comparison.json`, `evidence/builtin-checker/trials-builtin.json`, `evidence/product-audit/**`, `design/project-fit-update.md`, `docs/mega-plan.md`, `docs/decisions.md` | Names of the owner's trial projects (ProjectA, ProjectB, ProjectC) and their model file/entry names with verdict summaries. The private material itself is in the git-ignored `evidence/project-fit/` (`git ls-files evidence/project-fit` is empty; not read). |
| `evidence/1.0/pymtheg-1.0.0.tgz` (357 KB) | An old private Pymtheg tarball, which contains an older browser bundle (third-party code) and its notices. |

Things to review before the repository is public:

| Kind | Where |
|---|---|
| Credentials, tokens, keys | None found (patterns for GitHub, OpenAI-style, AWS, Slack tokens, private keys and `password=`/`token=` assignments). `test/implementation-process.test.mjs:144` has a fixture string `secret = "private source"`, not a credential. |
| Private IP addresses and hostnames | None tracked. The dev server's address appears only in the untracked `pymtheg-dev` wrapper. `AGENTS.md` names `pymtheg-dev` and `~/pymtheg-dev/corpora/…` (no host). |
| Personal paths `/home/<owner>/…` | 1,468 tracked files: almost all under `evidence/` (1,205 in `evidence/w2-c`); outside it: `design/implementation-prompt-core.md` (also names `~/Scripts/pc-tools`), `docs/trial-start.md` and `docs/changes/W2-E.md` (in the repository only: since round 1 the npm package no longer ships them, see e.), `research/results/tlc-*.txt`, `scripts/first-use-audit.mjs`, `scripts/gui-check.mjs`, `scripts/project-c-workspace-audit.mjs` (default helper/browser paths). |
| Email addresses | Third-party authors' addresses inside `research/sources/` captures and package metadata quotes; `vector@example.com` in evidence. No personal address of the owner found. |
| Owner's name | "Karl" appears in 82 tracked files (decision ledgers, plans, working rules), 33 of them in `docs/` (for example `build-plan.md`, `decisions.md`, `mega-plan.md`, `progress.md`, `requirements.md`, `roadmap-1.0.md`, review and audit documents, 7 files in `docs/changes/`). Since round 1 none of these ships in the npm package; the shipped files are checked by `test/package-contents.test.mjs`. |
| Large files | 354 MB tracked in 5,766 files; 48 files over 1 MB (218 MB), 7 over 10 MB, the largest `evidence/w2-c/d16-movement-withdrawals.json` (33.6 MB); 18 compressed archives (`*.tar.gz`, `*.json.gz`, 3.9 MB) under `evidence/`; Studio screenshots (`evidence/{recovery,rework,studio}/*.png`). Git history also holds them. |
| Third-party material without a licence | The `research/sources/` captures; the Vector excerpts in evidence (MPL-2.0 applies to them). |

## B. Packaging

### 5. Runtime dependencies

At run time `dist/` imports only `zod`, `typescript`, `web-tree-sitter`,
`@modelcontextprotocol/server` and `ajv` (`@codemirror/state` is imported only
by `src/studio/completion-position.ts`, which only the web app uses). Moved to
`devDependencies`: React, react-dom, react-markdown, remark-gfm, all
`@codemirror/*`, `@lezer/highlight` (bundled into `dist-web/` at build time),
and `tree-sitter-go`, `tree-sitter-rust`, `@tree-sitter-grammars/tree-sitter-lua`
(the graph loads the vendored grammars; the npm packages are kept for the
grammar comparison tests and `scripts/grammar-check.mjs`; nothing uses Lua at
run time). No version changed. `src/graph/tree-sitter.ts`'s `tagsFromPackage`
helper now has callers only in tests (not changed: `src/graph/**`).

Proof (`evidence/r1-h/tarball-smoke.mjs`, production-only install of the packed
tarball into a fresh directory): help, check, verify (counterexample), simulate
(`exhaustive: false`), doctor (ready), graph index and definite cross-file
callers for TypeScript, Go and Rust, MCP `initialize` + `tools/list`, Studio
start, page and script asset over HTTP, SIGINT stop: all pass before and after.

| Production install | Before (main) | After |
|---|---|---|
| `node_modules` bytes | 88,964,435 | 52,960,811 (51,337,201 after round 1 trimmed `docs/`) |
| Packages (incl. pymtheg) | 134 | 11 |
| `npm warn` lines | 6 | 0 |

### 6. Install warnings

The six `npm warn install-scripts` lines came from `tree-sitter-go`,
`tree-sitter-rust` and `@tree-sitter-grammars/tree-sitter-lua` (their
`node-gyp-build` install hooks build native Node bindings Pymtheg never loads).
R1-F's seventh name, `protobufjs`, came with the Quint dependency R1-A removed.
After the move nothing in the production tree has an install script
(`hasInstallScript` is absent from every production lockfile entry) and the
install prints no warning.

### 7. Node's ExperimentalWarnings

Reproduced on official Node 24.0.0 and 25.2.1: `node:sqlite` warns on every
command (even `--version`); on 24.0.0 `path.matchesGlob` (source selection,
`src/language/source-selection.ts`) also warns, from the analysis worker, and
broke 8 MCP tests' stderr assertions there. 24.21.0, 24.22.3, 25.9.0 and
26.13.1 print neither. A warning filter alone could not catch SQLite's: Node
loads a builtin while linking the ESM graph, before any module body runs, and
`src/storage/local.ts` imported `node:sqlite` statically. Fix:

- `src/storage/local.ts` loads `node:sqlite` at the first database open
  (`process.getBuiltinModule`); it is the only module that loads it.
- `src/cli/quiet-warnings.ts`, the first import of the CLI entry
  (`src/cli/main.ts`) and of the analysis worker (`src/cli/worker.ts`, which has
  its own `process`), drops only Node's own two warnings: a string warning
  whose type is `ExperimentalWarning` and whose message is exactly "SQLite is an
  experimental feature and might change at any time" or "glob is an
  experimental feature and might change at any time". It follows
  `process.emitWarning`'s overloads: the type comes from a string second
  argument or from `options.type` (default `Warning`), and an `Error` is never
  filtered, because Node ignores the other arguments for an Error and uses its
  own name (round 1 fixed a version that read the type from the options even
  for an Error, which hid a real `DeprecationWarning`). Every other warning,
  including other ExperimentalWarnings and near-miss texts, still prints. No
  `NODE_OPTIONS` or flag is needed.
- `test/r1h-packaging.test.mjs` emits warnings through every overload (string
  with type, string with options, Error; deprecations with codes, other
  experimental warnings, near misses, custom types, default type) and checks
  exactly which print; it also checks that no `src` file imports `node:sqlite`
  as a value statically.

The full suite passes on official Node 24.0.0, 24.21.0, 25.2.1, 25.9.0 and
26.13.1 (2,784 tests; one existing environment skip on 26.13.1).

**Note for the manager:** the lazy load is in `src/storage/local.ts`, outside
this chunk's owned paths (a three-line change); the filter import is the first
line of `src/cli/worker.ts`. Other workers (architecture, implementation query,
behaviour) do not import the filter; none printed either warning in the suite
on any version, but a future worker that calls `matchesGlob` on Node 24.0.0
would need the same first import.

### 8. Signals

Direct runs (`pymtheg studio`, `pymtheg mcp`) stop cleanly on SIGINT and
SIGTERM with exit 0 and an empty process group (new tests). Through `npx`
(`evidence/r1-h/npx-signal-probe.mjs`): with npm 11.3.0, 11.12.1, 11.19.1 and
11.20.0 (official Node 24.0.0, 25.9.0, 24.22.3, 26.13.1) on a system whose
`sh` replaces itself with the command, one SIGINT or SIGTERM to the `npx` PID
stops everything. With a `sh -c` that stays the command's parent (as R1-F's
Debian-based image), npm passes the signal only to that shell, the shell waits
for its child, and npm, the shell and the server all keep running. That is
npm's and the shell's behaviour, not Pymtheg's: Pymtheg never receives the
signal, and its parent is still alive, so there is nothing to detect without
polling. Documented in the README: a terminal's Ctrl-C signals the whole
process group; a supervisor should signal the process group or run the
installed binary.

### 9 and 10. Doctor wording and docs

- doctor reports a crashed engine worker as "The built-in engine worker
  failed: …" (was "Probe verdicts were wrong"), and a missing Studio build as
  "reinstall Pymtheg" in an installed package or "run npm run build in this
  source checkout" (a checkout has `src/` and `tsconfig.json` beside `dist/`).
- README: `exhaustive` describes the search, not the verdict; installing from a
  tarball with `npx ./pymtheg-1.0.0.tgz` (an absolute path exits 126), a global
  install, MCP or a global install for agents rather than `npx` per call (about
  3 s and 165 MiB each), and the `npx` signal caveat.
- `scripts/package-current-smoke.mjs`: the stale "hoisted Quint" line now says
  built-in engines.
- New test: `exhaustive: false` on a B001 preflight.

## Known limits

- The build-tool signatures match the minified shapes Vite 7.2 and Rollup 4.68
  emit today. A tool upgrade that changes them makes the licence test fail,
  which is intended, and needs a recogniser update after review. Helper code a
  transform inserts inside a module whose source map points at that module (for
  example a CommonJS wrapper's later lines, or an esbuild helper) is attributed
  to that module, not to the tool; the virtual-module attribution covers the
  CommonJS wrappers, and no esbuild helper is present in today's bundle.
- The licence-file reader recognises common licences by wording; an unusual
  text is flagged "not recognised", not guessed.
- The bundle inventory is computed by running Vite, so the test needs dev
  dependencies (as the rest of the suite does) and takes about 6 s.
- `dist/studio/completion-position.js` still imports `@codemirror/state`; it is
  never loaded at run time (only the web bundle uses that module), so an
  installed package without dev dependencies is unaffected.
- The `npx` signal case is documented, not fixed (see 8).

## Round 1 review (Sol): fixes

1. **Missing licence attribution for build-tool code.** The inventory kept only
   Vite's own section of `vite/LICENSE.md` and so dropped the licence of
   `@rollup/plugin-commonjs`, whose helper code ships in the React chunk.
   Fixed at the cause: build-tool code is attributed per origin from the
   bundler's virtual module ids, a project vendored inside another package gets
   its licence from the host's bundled-dependency section, Rollup is listed for
   the chunk linkage, and an unknown virtual module blocks. Completeness is
   checked independently of that module list: `scripts/licences/bundle-origins.mjs`
   builds the bundle with source maps into a temporary directory, reads from the
   maps alone which source every piece of emitted JavaScript comes from, and
   finds every stretch of emitted code that maps to no source. In today's build
   there are two: the index chunk's chunk imports plus Vite's module preload
   polyfill, and the React chunk's `getDefaultExportFromCjs` helper plus a
   CommonJS module wrapper. Each such stretch must be fully explained by a
   structural signature (`injectedSignatures`) whose origin is in the inventory;
   any other emitted code with no source fails `test/licences.test.mjs`, as does
   a mapped npm package missing from the inventory or an inventory package with
   no mapped code. `micromark-util-encode` left the list (tree-shaking removes
   all of its code; the maps confirm it), and Vite moved from "bundled" to
   "build-tool code".
2. **Warning filter hid a real deprecation** when an `Error` was passed with a
   type in the second argument. Fixed as described in section 7; tested for
   each overload on Node 24.21.0, 24.0.0 and 25.2.1.

## Round 1 review (Opus) and the owner's request: fixes

a. **Licence file gate.** `assess()` (used by `--check` and the test) now
   blocks when a licence file reads as a licence outside the allow-list, even
   if the declared licence is allowed, unless the package has a reviewed
   explanation entry; previously such a package only got a "not yet reviewed"
   flag. The review's sabotage (crelt's LICENSE replaced with GPL text, MIT
   declared) is a test case, along with a notice file quoting GPL (not the
   grant, not blocking) and an explained package (not blocking). The MCP SDK's
   explanation now also covers the CC-BY-4.0 documentation clause.
b. **Embedded licences** section in `docs/licences.md` (see A above); the
   reader also recognises CC-BY-4.0, the W3C licence and the Unicode licence.
   Copyright lines come from a package's licence files only.
c. **A.4 list** updated below for the shipped `docs/`.
d. **Lockfile drift** note at the top of `docs/licences.md`.
e. **The package ships user documentation only** (owner: "yeah better fix
   that"). `package.json` `files` lists ten documents instead of `docs/`:

   | Before | After |
   |---|---|
   | all of `docs/`: 74 top-level files and 40 under `docs/changes/` (114) | `agent-workflow.md`, `grammar.md`, `report.schema.json` (all three read by the product at run time), `mcp.md`, `output-plugins.md` (named in a CLI message), `studio.md`, `support.md`, `project-init.md`, `journeys.md`, `licences.md` (10) |

   Not shipped any more, though still in the repository: the plans, ledgers
   and history (`build-plan.md`, `decisions.md`, `mega-plan.md`,
   `trial-start.md`, `progress.md`, `runtime-map.md`, `requirements.md`,
   roadmap, review briefs, audits, remediation notes, authoring maps and
   `docs/changes/**`). Before, the shipped `docs/` carried personal paths in 3
   files (`trial-start.md`, `changes/W2-E.md` and this file), the owner's name in
   36 files and private project names in 16. In the ten that still ship, three
   sentences named the owner and were reworded in place (`project-init.md`
   line 3, `studio.md` "a bounded local helper", `output-plugins.md` "Apex is
   wanted"), and so was one in the README ("The review/polish cycle has
   stopped"). Links from the README and the shipped docs to repository files
   that no longer ship (46: 19 in the README, 24 in `support.md`, 2 in
   `studio.md`, 1 in `project-init.md`) now point to the same files on GitHub
   (`https://github.com/KarlLivesey/pymtheg/blob/main/...`), which resolve once
   the repository is public. `test/package-contents.test.mjs` reads the real
   pack list (`npm pack --dry-run --json`) and fails if `docs/` ships anything
   but the ten, if an internal file ships, or if any shipped file (apart from
   the licence texts) contains a personal path (`/home/<user>/`), the owner's
   name or a private project name (ProjectA, ProjectB, ProjectC). A scan of all 813
   shipped files found no hostname or IP address other than `127.0.0.1` (the
   Studio loopback).

   The acceptance harness (branch `r1-f-clean-machine-acceptance`, not edited):
   its `tarball-contents` step (`scripts/acceptance/run.mjs`, `inspectTarball`)
   requires only `dist/cli/main.js`, `dist-web/index.html`,
   `grammars/go/tree-sitter-go.wasm`, `grammars/rust/tree-sitter-rust.wasm`,
   `package.json`, `README.md` and `pymtheg`, and fails on files under `test/`,
   `evidence/`, `research/`, `web/src/` or `src/**/*.ts`. No step reads a
   shipped `docs/` file directly; MCP reads `docs/agent-workflow.md` and
   `docs/grammar.md`, which still ship. No harness change is needed.

## Round 2 review (Sol): private network details

R5. `test/package-contents.test.mjs` now also scans every shipped file for
private network details: RFC 1918 IPv4 addresses (10/8, 172.16/12,
192.168/16, as whole dotted quads), host names ending `.internal`, `.local` or
`.lan`, and the bare name `devserver`. Loopback, `0.0.0.0` and documentation
ranges stay allowed. In compiled code (`.js`, `.mjs`, `.d.ts`, `.css`) a member
access such as `this.local` has the same shape as a host name, and the real
package has many (first-party `dist/` and the third-party bundle alike), so
there the host-suffix rule applies only inside strings and URLs (after a quote,
backtick, `//` or `@`) and on comment lines, skipping backtick code spans in
comments (`data.local`). Markdown and other text files get the full rule. The
address and `devserver` rules apply to every shipped file; no file needed to be
exempted. Regression cases prove each rule fires (an address in each private
range, each suffix, `devserver`, in text and in code strings, URLs and comments)
and that loopback, documentation and public addresses, version strings,
ordinary words and real member accesses do not. Sol's reproduction (appending
`192.168.88.47` or `private-box.internal` to README.md) now fails the test.

## Round 2 review (Opus) and small items

1. **Notices embedded in bundled source files.** vfile's `lib/minpath.browser.js`
   (bundled into `dist-web/`) is derived from path-browserify (MIT, Copyright (c)
   2013 James Halliday) and Node.js `lib/path.js` (MIT, Copyright Joyent, Inc.
   and other Node contributors); the notices were only in that file's header,
   which minification removes, and vfile's own licence file names neither.
   Both are now inventory components ("embedded in a bundled package") with
   their notice texts in `docs/licences.md` and `THIRD-PARTY-NOTICES`. A new
   check scans every bundled module with rendered code for comments carrying a
   copyright line or derivative-work wording ("derivative work", "which is
   licensed", "ported/adapted/copied from", "code/file/portions … derived/taken
   from"). A comment is covered when it is not a derivative-work notice and
   every copyright holder it names appears in the package's own licence files
   (React's `@license React` headers are covered this way). Anything else
   blocks unless a pinned review entry (`embeddedNotices`) covers it: either
   origins (split into one notice per origin, each pinned to its copyright line)
   or a provenance note. The check found three provenance notes and they are
   reviewed and listed in a new "Provenance notes in bundled code" section for
   the owner: `micromark-util-html-tag-name` (two lists of HTML tag names copied
   from the CommonMark specification, published under a Creative Commons
   Attribution-ShareAlike licence) and `zod` `v4/core/regexes.js` (a regular
   expression adapted from a Stack Overflow answer, also CC BY-SA). The
   compatibility paragraph says so instead of claiming every origin's notice is
   kept. Sabotage-style tests: a bundled module with someone else's copyright
   notice blocks; a derivative-work notice blocks; a changed vfile header or
   provenance note blocks; React's headers and documentation prose ("derived
   from the old state") do not.
2. **Reviewed MCP explanation scoped.** It now allows only CC-BY-4.0 and only
   for the exact LICENSE text it was written for (sha256 pinned). The MCP
   LICENSE replaced with GPL text, or GPL appended, now blocks (tested).
3. **One notices file.** The Vite plugin that wrote `dist-web/third-party-notices.txt`
   (`scripts/license-notices.mjs`) is removed; `THIRD-PARTY-NOTICES` at the package
   root is the only notices file. `scripts/package-current-smoke.mjs` reads it.
4. **"ProjectB" only as the project name** in `test/package-contents.test.mjs`
   (capitalised, word-bounded; the ordinary word "tiered" passes, tested). No
   shipped document uses the word.
5. Stale header comment in `test/licences.test.mjs` updated. The CommonJS
   wrapper signature also matches `var xi,Ua;function Ed(){if(Ua)return xi;Ua=1;`.

Counts after round 2: 103 shipped components (10 installed npm packages, 86
bundled packages, 3 build-tool origins, 2 origins embedded in a bundled
package, 2 vendored grammars): 98 MIT, 3 Apache-2.0, 1 BSD-3-Clause, 1 ISC;
plus 3 reviewed provenance notes.
