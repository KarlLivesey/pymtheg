# SW-1 public corpus sweep

Pymtheg returned a cold and warm graph for **53 of 60 repositories**.
Of the cold indexes, 38 reported `ok` and 15 reported `incomplete`. Two
repositories exhausted Node’s heap, and five reached the 60-minute safety
limit. The finished runs reported 78 failed files across 10 repositories.

36 of 53 returned graphs had fewer than half their links resolved, including
16 of 18 TypeScript, 5 of 20 Go, and 15 of 15 Rust. T3 Code v0.0.24 finished
with 37.02% resolved links, no failed files and two partial files. Full
diagnostic groups and query sizes are in [results.json](results.json).

## How to read the results

The dev server ran the public npm `pymtheg@0.1.0` release with Node 24.21.0
and the default source-only settings. Go’s opt-in toolchain was off, and Rust
used the bundled grammar and source resolver. Each cold run started with a
fresh graph store. The next index reused that store without any source edits.
Queries read the stored graph. The callee probe was rerun with the full symbol
reference returned by `search` after the original harness prefixed it twice.
The cold and warm index measurements come from their original runs.

The `Outcome` column distinguishes a finished CLI run with an `incomplete`
graph from a process error or a run that reached the harness wall limit. The
limit applies across the repository’s commands. `Failed files` is the length
of the CLI’s failed-file list and can include failed context captures. Values
in `R / A / U` are the percentages of all stored links that are `resolved`,
`ambiguous`, and `unresolved`. A resolved link can carry assumptions.
Coverage here comes from those stored outcomes. Measuring recall and precision
requires verified targets. Time and memory are observations on a shared server.
The table reports the maximum resident memory across each repository’s stages.
The JSON also includes cold and warm stage peaks. An `≥` marks a lower bound
from the last sampled kernel high-water mark before a forced timeout.

| Repository | Language | Source lines | Outcome | Cold time | Peak RSS | Failed files | R / A / U | Warm time |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: |
| BurntSushi/ripgrep | Rust | 55,512 | Finished | 59.6 s | 1226 MiB | 0 | 35.10% / 0.03% / 64.87% | 13.4 s |
| DioxusLabs/dioxus | Rust | 200,424 | Did not finish in 60 min (cold) | 3607.4 s | ≥1594 MiB | — | — | — |
| RustCrypto/hashes | Rust | 18,733 | Finished | 25.4 s | 559 MiB | 0 | 24.66% / 0.00% / 75.34% | 4.9 s |
| actix/actix-web | Rust | 92,807 | Finished | 192.4 s | 2007 MiB | 0 | 21.50% / 0.01% / 78.49% | 35.7 s |
| alacritty/alacritty | Rust | 33,798 | Finished, incomplete | 52.1 s | 1125 MiB | 1 | 28.54% / 0.03% / 71.43% | 10.9 s |
| cberner/redb | Rust | 70,350 | Finished | 108.3 s | 1852 MiB | 0 | 25.04% / 0.36% / 74.60% | 24.7 s |
| changesets/changesets | TypeScript | 32,566 | Finished, incomplete | 16.9 s | 631 MiB | 0 | 13.24% / 0.00% / 86.76% | 2.8 s |
| charmbracelet/bubbletea | Go | 16,313 | Finished | 23.9 s | 544 MiB | 0 | 61.33% / 0.22% / 38.45% | 3.5 s |
| cilium/ebpf | Go | 71,728 | Finished | 67.2 s | 1502 MiB | 0 | 64.56% / 3.57% / 31.87% | 12.4 s |
| clap-rs/clap | Rust | 84,713 | Finished, incomplete | 123.7 s | 1295 MiB | 13 | 21.85% / 0.64% / 77.51% | 17.5 s |
| cli/cli | Go | 340,992 | Finished | 504.4 s | 4658 MiB | 0 | 55.48% / 1.07% / 43.46% | 62.2 s |
| cockroachdb/pebble | Go | 263,494 | Finished | 511.5 s | 4730 MiB | 0 | 65.30% / 1.72% / 32.98% | 56.4 s |
| colinhacks/zod | TypeScript | 103,825 | Finished | 135.9 s | 3199 MiB | 0 | 55.48% / 1.11% / 43.41% | 16.4 s |
| crossbeam-rs/crossbeam | Rust | 45,843 | Finished | 56.1 s | 1117 MiB | 0 | 22.85% / 0.24% / 76.91% | 12.2 s |
| dexie/Dexie.js | TypeScript | 36,670 | Finished | 55.8 s | 1139 MiB | 0 | 31.84% / 0.22% / 67.94% | 6.7 s |
| embassy-rs/embassy | Rust | 647,427 | Did not finish in 60 min (cold) | 3606.2 s | ≥3652 MiB | — | — | — |
| etcd-io/bbolt | Go | 25,469 | Finished | 24.5 s | 689 MiB | 0 | 60.73% / 2.35% / 36.92% | 4.6 s |
| evanw/esbuild | Go | 149,997 | Finished | 168.6 s | 3398 MiB | 0 | 81.71% / 0.32% / 17.97% | 25.1 s |
| excalidraw/excalidraw | TypeScript | 231,343 | Finished, incomplete | 284.4 s | 3643 MiB | 0 | 54.89% / 0.00% / 45.11% | 20.2 s |
| fjall-rs/fjall | Rust | 17,608 | Finished | 27.8 s | 630 MiB | 0 | 22.31% / 0.05% / 77.63% | 5.4 s |
| gin-gonic/gin | Go | 24,556 | Finished | 27.4 s | 762 MiB | 0 | 48.95% / 2.75% / 48.30% | 5.1 s |
| go-task/task | Go | 25,916 | Finished | 28.9 s | 792 MiB | 0 | 59.17% / 0.44% / 40.39% | 4.8 s |
| gofiber/fiber | Go | 172,546 | Finished | 238.2 s | 3414 MiB | 0 | 51.59% / 3.64% / 44.77% | 34.4 s |
| golang/tools | Go | 419,086 | Finished, incomplete | 780.3 s | 6229 MiB | 17 | 57.64% / 0.62% / 41.74% | 71.9 s |
| helix-editor/helix | Rust | 108,093 | Finished | 187.1 s | 2047 MiB | 0 | 26.50% / 0.03% / 73.46% | 40.5 s |
| honojs/hono | TypeScript | 96,506 | Finished | 100.8 s | 1835 MiB | 0 | 33.89% / 0.13% / 65.98% | 11.6 s |
| junegunn/fzf | Go | 34,391 | Finished | 32.4 s | 1075 MiB | 0 | 70.78% / 2.52% / 26.70% | 6.3 s |
| labstack/echo | Go | 45,764 | Finished | 37.0 s | 949 MiB | 0 | 46.12% / 0.57% / 53.31% | 8.3 s |
| mattn/go-sqlite3 | Go | 16,543 | Finished | 16.2 s | 438 MiB | 0 | 35.21% / 3.93% / 60.87% | 3.4 s |
| mermaid-js/mermaid | TypeScript | 201,830 | Finished | 313.1 s | 2427 MiB | 0 | 40.61% / 0.01% / 59.39% | 23.4 s |
| microsoft/TypeScript | TypeScript | 809,893 | Memory abort (cold) | 2199.3 s | 5460 MiB | — | — | — |
| nestjs/nest | TypeScript | 259,842 | Finished | 573.2 s | 3302 MiB | 0 | 42.73% / 0.01% / 57.26% | 30.8 s |
| oclif/core | TypeScript | 25,960 | Finished | 23.3 s | 801 MiB | 0 | 47.93% / 0.56% / 51.51% | 3.1 s |
| pingdotgg/t3code | TypeScript | 328,152 | Finished, incomplete | 267.4 s | 3006 MiB | 0 | 37.02% / 0.58% / 62.40% | 26.1 s |
| pmndrs/zustand | TypeScript | 10,489 | Finished | 10.2 s | 470 MiB | 0 | 27.56% / 0.34% / 72.10% | 2.1 s |
| pocketbase/pocketbase | Go | 129,108 | Finished | 241.5 s | 3650 MiB | 0 | 27.06% / 1.47% / 71.48% | 36.7 s |
| protocolbuffers/protobuf-go | Go | 289,156 | Finished | 595.4 s | 4203 MiB | 0 | 79.30% / 8.53% / 12.18% | 66.6 s |
| puppeteer/puppeteer | TypeScript | 113,967 | Finished, incomplete | 80.6 s | 1538 MiB | 1 | 36.89% / 0.03% / 63.08% | 11.7 s |
| ratatui/ratatui | Rust | 87,870 | Finished | 143.5 s | 1549 MiB | 0 | 27.19% / 0.01% / 72.80% | 27.0 s |
| react-hook-form/react-hook-form | TypeScript | 95,725 | Finished | 57.5 s | 1367 MiB | 0 | 20.66% / 0.01% / 79.33% | 8.7 s |
| reduxjs/redux-toolkit | TypeScript | 102,189 | Finished, incomplete | 111.9 s | 1696 MiB | 0 | 32.18% / 0.37% / 67.45% | 11.8 s |
| restic/restic | Go | 89,047 | Finished | 143.4 s | 2133 MiB | 0 | 63.26% / 2.35% / 34.39% | 17.8 s |
| rust-embedded/cortex-m | Rust | 12,031 | Finished | 19.1 s | 419 MiB | 0 | 41.37% / 0.06% / 58.58% | 2.9 s |
| rust-lang/mdBook | Rust | 18,151 | Finished, incomplete | 32.0 s | 738 MiB | 19 | 14.51% / 0.01% / 85.48% | 5.9 s |
| rustls/rustls | Rust | 85,149 | Did not finish in 60 min (cold) | 3607.1 s | ≥3970 MiB | — | — | — |
| samber/lo | Go | 50,498 | Finished, incomplete | 29.7 s | 839 MiB | 0 | 34.70% / 0.12% / 65.19% | 6.5 s |
| serde-rs/serde | Rust | 42,627 | Did not finish in 60 min (cold) | 3608.8 s | ≥713 MiB | — | — | — |
| spf13/cobra | Go | 16,765 | Finished | 20.5 s | 456 MiB | 0 | 63.15% / 0.02% / 36.83% | 3.1 s |
| stretchr/testify | Go | 29,801 | Finished | 23.2 s | 775 MiB | 0 | 62.56% / 1.07% / 36.37% | 5.1 s |
| swc-project/swc | Rust | 829,567 | Did not finish in 60 min (cold) | 3576.1 s | ≥3512 MiB | — | — | — |
| tauri-apps/tauri | Rust | 109,271 | Finished, incomplete | 215.0 s | 2137 MiB | 10 | 26.56% / 0.04% / 73.41% | 43.5 s |
| tokio-rs/axum | Rust | 48,607 | Finished | 77.0 s | 1319 MiB | 0 | 21.71% / 0.03% / 78.26% | 16.0 s |
| tree-sitter/tree-sitter | Rust | 68,662 | Finished | 92.2 s | 1565 MiB | 0 | 25.33% / 0.01% / 74.66% | 20.3 s |
| trpc/trpc | TypeScript | 195,128 | Finished, incomplete | 225.8 s | 2308 MiB | 6 | 40.56% / 0.01% / 59.43% | 47.9 s |
| vercel/turborepo | TypeScript | 76,005 | Memory abort (cold) | 1431.1 s | 5666 MiB | — | — | — |
| vitejs/vite | TypeScript | 103,474 | Finished, incomplete | 95.0 s | 1482 MiB | 4 | 38.48% / 0.03% / 61.49% | 28.6 s |
| vitest-dev/vitest | TypeScript | 224,300 | Finished, incomplete | 364.2 s | 2254 MiB | 3 | 30.68% / 0.03% / 69.29% | 22.6 s |
| wagoodman/dive | Go | 18,358 | Finished | 22.6 s | 516 MiB | 0 | 55.93% / 0.32% / 43.75% | 3.9 s |
| withastro/astro | TypeScript | 269,978 | Finished, incomplete | 391.3 s | 2823 MiB | 4 | 29.25% / 0.36% / 70.39% | 35.4 s |
| yargs/yargs | TypeScript | 6,304 | Finished | 14.7 s | 521 MiB | 0 | 30.79% / 0.00% / 69.21% | 2.5 s |

## Ranked failure classes

The ranking starts with runs that could not finish. A repository can appear in
more than one failed-file class. For the link classes, “low” means under 50%
resolved in the cold graph. Each low-link repository is assigned to its
largest unresolved bucket, grouped by module, link kind and recorded reason
in the stored graph. Missing reason fields are counted separately.

1. **Node heap exhaustion during cold indexing (2 repositories).**
    Microsoft TypeScript exited 134 during `graph analyze typescript: 0/27194`.
    Turborepo’s last progress was `graph resolve go: 4587/4587`, before the next
    module reported progress, and it also exited 134. Both printed `FATAL ERROR:
    Reached heap limit Allocation failed - JavaScript heap out of memory` with V8
    value deserialization frames. The CLI gave no associated source file or line.
    TypeScript’s checkout had 809,893 TypeScript lines, 1,198,133 Go lines and
    1,021,999 JavaScript lines. Turborepo had 76,005 TypeScript lines and 755,689
    Rust lines. The store retains decoded graph files and clones them when read.
    The indexer also clones the whole file and symbol input for each resolver.
    The TypeScript analysis builds compiler programs and retains their extracted
    facts. Those allocations can overlap in a mixed checkout. The Turborepo
    progress and stack are consistent with a large copy between module passes.
    The stacks give no JavaScript call site.
    [Graph file storage](../../src/graph/store.ts#L44) · [Resolver input](../../src/graph/indexer.ts#L363) · [TypeScript analysis](../../src/graph/languages/typescript/index.ts#L524)

2. **Rust analysis or resolution reached the wall limit (5 repositories).**
    `serde-rs/serde` last reported `graph analyze rust: 0/208`. `rustls/rustls`
    last reported `graph resolve rust: 0/172`. The harness sent SIGTERM at the
    limit and escalated to SIGKILL after the grace period.
    The Rust module builds file facts and calls `resolveRust` during `analyze`,
    then calls the resolver again during `resolve` if the run gets that far. The
    CLI emits one progress message just before and one just after each call into
    the module. The resolver runs synchronously, which can keep the CLI from
    processing the shutdown signal. Repeated scope, import and type lookups are
    likely sources of work. The last progress message identifies the phase and
    provides no source location.
    [Rust analysis](../../src/graph/languages/rust/index.ts#L87) · [CLI progress](../../src/graph/commands.ts#L272)

3. **Rust grammar rejected source constructs (4 repositories).**
    Clap’s `tests/builder/cargo.rs:36` reported
    ``line 36, column 57: unexpected `!` `` on a `str![[r#"…` snapshot macro
    invocation. Alacritty’s `alacritty/src/display/window.rs:136` reported
    ``line 136, column 9: unexpected `#[rustfmt::skip]` `` on a function parameter
    attribute. The module translates bundled Tree-sitter error nodes into a
    failed file and drops its symbols and links. [Rust diagnostics](../../src/graph/languages/rust/parse.ts#L293)

4. **Go grammar rejected source constructs (1 repository).** In Go
    tools, `go/ssa/interp/testdata/static.go:55` reported
    ``syntax error in line 55: unexpected `0` `` for `(make)([]int, 0)`.
    The Go module derives the diagnostic from the first bundled Tree-sitter error
    node. The same checkout also contains version-specific tests for upcoming Go
    syntax and deliberately malformed files. [Go diagnostics](../../src/graph/languages/go/failure.ts#L220)

5. **Test fixtures intentionally contain syntax errors (5 repositories).**
    Vite’s `packages/vite/src/node/ssr/__tests__/fixtures/errors/syntax-error.ts:1`
    reported `Unexpected keyword or identifier`. Astro’s
    `packages/astro/e2e/fixtures/errors/src/components/react/ReactSyntaxError.jsx:4`
    reported `')' expected`. The index claims supported extensions throughout the
    checkout, so negative test sources enter the same parse and diagnostic path as
    production sources. [Index inventory](../../src/graph/indexer.ts#L101) · [TypeScript diagnostics](../../src/graph/languages/typescript/project.ts#L119)

6. **Templates and documentation snippets look like source files (2 repositories).**
    Tauri’s `crates/tauri-cli/templates/plugin/src/commands.rs:1` reported
    ``unexpected `#if` `` on `{{#if …}}`. mdBook’s
    `guide/src/format/example.rs:3` reported ``unexpected `#` `` on a hidden-line
    marker for the book renderer. Extension-based file claims feed the literal
    contents to the parser, before the project’s template or documentation
    processor would transform them. [File claims](../../src/graph/registry.ts#L71) · [Rust diagnostics](../../src/graph/languages/rust/parse.ts#L293)

7. **Broken or absent TypeScript configuration fails otherwise readable files
    (2 repositories).** In tRPC, `examples/nuxt/tsconfig.json:3` extends
    `./.nuxt/tsconfig.json`, which the CLI reports is `missing from the snapshot`.
    It marked four source files under that config failed and two under the server
    config. Vite’s `playground/tsconfig-json-load-error/has-error/tsconfig.json:3`
    lacks a value for `compilerOptions`. The CLI reported `Expression expected`
    and marked `main.ts` failed. The project model
    propagates an unreadable or absent relative base to the owning project group.
    [TypeScript project configuration](../../src/graph/languages/typescript/project.ts#L605)

8. **Package JSON with a UTF-8 BOM fails its group (1 repository).**
    Vite’s `playground/resolve/utf8-bom-package/package.json:1` produced
    `Unreadable package manifest … Unexpected token` naming the BOM. The failed
    source was the fixture’s `index.mjs`. The capture retains the BOM in the
    text, and the manifest loader passes that text straight to `JSON.parse`.
    [UTF-8 capture](../../src/graph/indexer.ts#L155) · [Manifest loader](../../src/graph/languages/typescript/project.ts#L468)

9. **Rust receiver types could not be verified (12 low-link repositories).**
    The largest unresolved group in these graphs was Rust calls marked
    `receiver-type-unverified`, sometimes accompanied by another reason.
    Helix’s `helix-core/src/auto_pairs.rs:346` records that reason for
    `range.cursor`. Tauri’s `bench/src/build_benchmark_jsons.rs:36` records it for
    `File::open(…).expect`. The source resolver attempts to narrow a receiver and
    its method candidates from captured source and leaves the link unresolved when
    it lacks enough type facts. [Rust receiver resolution](../../src/graph/languages/rust/resolve.ts#L3841)

10. **TypeScript checker supplied no target symbol (10 low-link repositories).**
    NestJS’s `integration/_support/register-local-packages.ts:10` records
    `no-symbol` for `require`. React Hook Form’s `app/src/controller.tsx:76`
    records it for `props.onChange`. The extractor records this when lookup has
    no usable symbol and no more specific reason. Missing dependencies can also
    prevent a receiver type from being inferred. [TypeScript target extraction](../../src/graph/languages/typescript/extract.ts#L224)

11. **TypeScript dependencies are outside the captured graph (6 low-link
    repositories).** The largest unresolved bucket in these graphs was calls
    marked `external-package`. T3 Code’s `apps/desktop/scripts/dev-electron.mjs:54`
    records it for `spawnSync`, and Vite’s `docs/.vitepress/buildEnd.config.ts:49`
    records it for `writeFileSync`. The TypeScript loader builds a virtual file
    system from the checkout and library declarations. Package and Node built-in
    definitions without captured targets remain outside the graph.
    [Virtual TypeScript project](../../src/graph/languages/typescript/project.ts#L455) · [Module reasons](../../src/graph/languages/typescript/extract.ts#L843)

12. **Go calls lack targets in the source-only view (4 low-link repositories).**
    The largest bucket is unresolved Go calls with no stored reason. Gin’s
    `auth.go:52` records `strconv.Quote`, a standard-library call. Echo’s
    `bind.go:274` records `val.Field`, a reflect method call. The source layout
    resolves captured declarations, while an absent dependency package can leave
    calls and receiver types outside that set. [Go source resolver](../../src/graph/languages/go/resolve.ts#L1245)

13. **Rust calls or values lack a stored reason (2 low-link
    repositories).** Clap’s `clap_bench/benches/ripgrep.rs:292` has an unresolved
    `doc` call, and RustCrypto hashes’ `ascon-hash256/src/block_api.rs:63` has an
    unresolved `len` value. The Rust resolver records uncertainty when a lookup
    is incomplete and can leave the reason empty for a complete lookup with no
    captured target. These rows retain their target spelling.
    [Rust resolution outcomes](../../src/graph/languages/rust/resolve.ts#L4387)

14. **The TypeScript checker worked with missing external config settings
    (1 low-link repository).** Changesets’
    `packages/apply-release-plan/src/edit-json.test.ts:46` records
    `incomplete-config` for `expect`. The project model keeps files under an
    external `extends` base with a partial view of their configuration. The
    extractor downgrades lookups that depend on those missing settings.
    [External config bases](../../src/graph/languages/typescript/project.ts#L649) · [TypeScript link extraction](../../src/graph/languages/typescript/extract.ts#L806)

15. **Bundled JavaScript supplies many local unresolved calls (1 low-link
    repository).** PocketBase’s `ui/dist/assets/docsAuthWithOTP-75iz1Xmg.js:63`
    records `local` for `(expression).content`. The graph scans checked-in UI
    bundles as JavaScript along with Go source. The extractor keeps a local
    spelling when it cannot map it to a graph symbol. These bundle links count in
    the repository-wide share. [TypeScript target extraction](../../src/graph/languages/typescript/extract.ts#L224)
