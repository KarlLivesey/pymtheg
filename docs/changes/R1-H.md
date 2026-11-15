# R1-H: packaging polish and licence inventory

Decision D19 (initial release) and the owner's publishing plan in
`docs/build-plan.md`; gap list from R1-F (PR 41). Evidence: [evidence/r1-h/](../../evidence/r1-h/README.md).

## A. Licence inventory (the owner's decision input)

`scripts/licences/inventory.mjs` (no new dependency) records exactly what the
published tarball installs or contains:

- the production npm tree, direct and transitive, from `package-lock.json`
  (entries not marked `dev`; optional ones are labelled), with each installed
  package's `package.json` and licence files;
- every npm package Vite puts into `dist-web/`, read from the bundle's real
  module graph (an in-memory `vite build` with a capture plugin; nothing
  written), plus Vite's own injected helpers (`commonjsHelpers.js`,
  `vite/modulepreload-polyfill.js`);
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
the SPDX and licence-text readers. It does not need a `license` field, a LICENSE
file or a change to `"private": true`; `docs/licences.md` states that Pymtheg's
own licence is not yet chosen.

### Summary (after the dependency moves in B.5)

100 shipped third-party components: 10 installed npm packages, 88 packages
bundled into `dist-web/`, 2 vendored grammars.

| Licence (as declared) | Components | Which |
|---|---:|---|
| MIT | 95 | everything not listed below, incl. both vendored grammars, React, CodeMirror, unified/remark, ajv, zod, web-tree-sitter |
| Apache-2.0 | 3 | `typescript` (also ships `ThirdPartyNoticeText.txt`, included), `@modelcontextprotocol/server`, `@modelcontextprotocol/core` |
| BSD-3-Clause | 1 | `fast-uri` (via ajv) |
| ISC | 1 | `@ungap/structured-clone` (bundled) |

- No copyleft (GPL, LGPL, AGPL, MPL) is shipped. Nothing is outside the
  allow-list. Every shipped component has its licence text.
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
| `research/results/tlc-*.txt` | TLC output logs; contain `/home/user/...` paths. |
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
| Personal paths `/home/user/…` | 1,468 tracked files: almost all under `evidence/` (1,205 in `evidence/w2-c`); outside it: `design/implementation-prompt-core.md` (also names `~/Scripts/pc-tools`), `docs/trial-start.md` and `docs/changes/W2-E.md` (both in `docs/`, which the npm package ships), `research/results/tlc-*.txt`, `scripts/first-use-audit.mjs`, `scripts/gui-check.mjs`, `scripts/project-c-workspace-audit.mjs` (default helper/browser paths). |
| Email addresses | Third-party authors' addresses inside `research/sources/` captures and package metadata quotes; `vector@example.com` in evidence. No personal address of the owner found. |
| Owner's name | "Karl" appears in 82 tracked files (decision ledgers, plans, working rules). |
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
| `node_modules` bytes | 88,964,435 | 52,960,811 |
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
  its own `process`), drops only warnings whose type is `ExperimentalWarning`
  and whose message starts "SQLite is an experimental feature" or "glob is an
  experimental feature". Every other warning, including every other
  ExperimentalWarning, still prints. No `NODE_OPTIONS` or flag is needed.
- `test/r1h-packaging.test.mjs` checks the filter's exact scope and that no
  `src` file imports `node:sqlite` as a value statically.

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

- The licence-file reader recognises common licences by wording; an unusual
  text is flagged "not recognised", not guessed.
- The bundle inventory is computed by running Vite, so the test needs dev
  dependencies (as the rest of the suite does) and takes about 6 s.
- `dist/studio/completion-position.js` still imports `@codemirror/state`; it is
  never loaded at run time (only the web bundle uses that module), so an
  installed package without dev dependencies is unaffected.
- The `npx` signal case is documented, not fixed (see 8).
