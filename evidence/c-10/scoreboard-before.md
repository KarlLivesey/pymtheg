# SW-3 coverage scoreboard

Result package ` pymtheg@0.1.0 `. Candidate records replace 38 matching baseline pins.

## A. All 60 finish

**58 of 60 finished.**

- [x] DioxusLabs/dioxus · Rust analysis stalled at the wall limit · finished
- [ ] embassy-rs/embassy · Wall limit after Rust analysis completed · open
- [x] rustls/rustls · Rust resolution stalled at the wall limit · finished
- [x] serde-rs/serde · Rust resolution stalled in recursive scope and use lookups · finished
- [ ] swc-project/swc · Wall limit after Rust analysis completed · open

## B. Coverage of finished graphs

Level 2 counts resolved checkout links and named library symbols over all stored links. Level 1 also credits named library units. Strict-inside excludes the proven outside partition. Raw credits only the stored resolved outcome.
The closed-set alternative adds the sample estimate for verified complete candidate sets. Candidate evaluations reuse the reference sample.

| Files counted | Module | Graphs | Level 2 | Level 1 | L2 + verified closed sets (95% interval) | L2 median | Strict-inside weighted / median | Raw |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All files | Go | 25 | 79.11% | 81.10% | 79.11% (79.11%–79.23%) | 76.11% | 84.50% / 81.72% | 70.35% |
| All files | Rust | 19 | 31.10% | 31.12% | 31.14% (31.12%–31.16%) | 32.44% | 27.09% / 27.94% | 23.61% |
| All files | TypeScript / JS | 32 | 58.49% | 59.95% | 58.53% (58.49%–58.61%) | 52.08% | 58.18% / 52.59% | 46.27% |
| All files | Overall | 58 | 57.89% | 59.10% | 57.91% (57.89%–57.98%) | 56.59% | 58.16% / 57.80% | 48.47% |
| Without bundles | Go | 25 | 79.11% | 81.10% | 79.11% (79.11%–79.23%) | 76.11% | 84.50% / 81.72% | 70.35% |
| Without bundles | Rust | 19 | 31.10% | 31.12% | 31.14% (31.12%–31.16%) | 32.44% | 27.09% / 27.94% | 23.61% |
| Without bundles | TypeScript / JS | 32 | 59.92% | 61.51% | 59.96% (59.92%–60.05%) | 52.08% | 59.71% / 52.59% | 46.60% |
| Without bundles | Overall | 58 | 58.28% | 59.53% | 58.31% (58.28%–58.38%) | 59.27% | 58.57% / 59.86% | 48.62% |
| Without broken fixtures | Go | 25 | 79.11% | 81.10% | 79.11% (79.11%–79.23%) | 76.11% | 84.50% / 81.72% | 70.35% |
| Without broken fixtures | Rust | 19 | 31.10% | 31.12% | 31.14% (31.12%–31.16%) | 32.44% | 27.09% / 27.94% | 23.61% |
| Without broken fixtures | TypeScript / JS | 32 | 58.49% | 59.95% | 58.53% (58.49%–58.61%) | 52.08% | 58.18% / 52.59% | 46.27% |
| Without broken fixtures | Overall | 58 | 57.89% | 59.10% | 57.91% (57.89%–57.98%) | 56.59% | 58.16% / 57.80% | 48.47% |
| Without templates | Go | 25 | 79.11% | 81.10% | 79.11% (79.11%–79.23%) | 76.11% | 84.50% / 81.72% | 70.35% |
| Without templates | Rust | 19 | 31.10% | 31.12% | 31.14% (31.12%–31.16%) | 32.44% | 27.09% / 27.94% | 23.61% |
| Without templates | TypeScript / JS | 32 | 58.49% | 59.95% | 58.53% (58.49%–58.61%) | 52.08% | 58.18% / 52.59% | 46.27% |
| Without templates | Overall | 58 | 57.89% | 59.10% | 57.91% (57.89%–57.98%) | 56.59% | 58.16% / 57.80% | 48.47% |
| Source only | Go | 25 | 79.11% | 81.10% | 79.11% (79.11%–79.23%) | 76.11% | 84.50% / 81.72% | 70.35% |
| Source only | Rust | 19 | 31.10% | 31.12% | 31.14% (31.12%–31.16%) | 32.44% | 27.09% / 27.94% | 23.61% |
| Source only | TypeScript / JS | 32 | 59.92% | 61.51% | 59.96% (59.92%–60.05%) | 52.08% | 59.71% / 52.59% | 46.60% |
| Source only | Overall | 58 | 58.28% | 59.53% | 58.31% (58.28%–58.38%) | 59.27% | 58.57% / 59.86% | 48.62% |

### Candidate sampling

| Module | Remaining reference sites used | Missed links outside the remaining projection |
| --- | ---: | ---: |
| Go | 293 | 37,229 |
| Rust | 407 | 201,108 |
| TypeScript / JS | 346 | 60,202 |

## What the released store says about outside links

Unit and symbol counts are exact on stored links with proof of outside origin. The final column estimates additional outside sites whose current facts name neither.
The audit recovers these identities from paths, import bindings, named declaring traits or directives. The target-ID slot points to a symbol in a captured file. The released graph has no first-class external target nodes.

| Module | Proven outside | Named unit, including L2 | Unit only | Unit and symbol | Neither, proven outside | Additional outside with neither (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | 334,766 | 214,787 | 39,683 | 175,104 | 119,979 | 122,818 (109,956–138,941) |
| Rust | 208,098 | 121,749 | 299 | 121,450 | 86,349 | 366,769 (271,378–473,587) |
| TypeScript / JS | 325,030 | 217,102 | 23,180 | 193,922 | 107,928 | 339,421 (310,983–371,078) |
| Overall | 867,894 | 553,638 | 63,162 | 490,476 | 314,256 | 829,008 (720,242–955,682) |

### Recorded library identities by encoding

| Module | Encoding | Level 1 only | Level 2 | Example |
| --- | --- | ---: | ---: | --- |
| Go | path | 39,683 | 0 | charmbracelet/bubbletea ` color.go:4 ` ` image/color ` |
| Go | import-binding | 0 | 175,104 | charmbracelet/bubbletea ` color.go:39 ` ` image/color → Color ` |
| Rust | path | 75 | 19,865 | vercel/turborepo ` crates/libghostty-vt-sys/build.rs:2 ` ` std → env ` |
| Rust | import-binding | 0 | 44,247 | BurntSushi/ripgrep ` crates/cli/src/decompress.rs:29 ` ` std → path::PathBuf ` |
| Rust | explicit-trait | 0 | 81 | DioxusLabs/dioxus ` packages/fullstack-server/src/launch.rs:182 ` ` tower → Service::poll_ready ` |
| Rust | import-path | 224 | 0 | BurntSushi/ripgrep ` crates/globset/benches/bench.rs:7 ` ` test ` |
| Rust | qualified-path | 0 | 9,950 | BurntSushi/ripgrep ` build.rs:15 ` ` std → env::var ` |
| Rust | declared-builtin | 0 | 47,307 | BurntSushi/ripgrep ` build.rs:15 ` ` std → result::Result::Ok ` |
| TypeScript / JS | path | 19,360 | 0 | DioxusLabs/dioxus ` .github/actions/prune-cargo-target/lib.js:14 ` ` fs ` |
| TypeScript / JS | import-binding | 3,808 | 193,922 | DioxusLabs/dioxus ` .github/actions/prune-cargo-target/lib.js:22 ` ` fs → readdirSync ` |
| TypeScript / JS | reference-directive | 12 | 0 | dexie/Dexie.js ` samples/dexie-cloud-todo-app/src/sw.ts:1 ` ` typescript/lib/webworker ` |

## Source scopes

Counts include every observed link. Broken and template files that produced no links appear in the failed-source column.

| Module | Scope | Resolved | Ambiguous | Inside | Outside | Unclassified | Failed source files |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | source | 1,406,643 | 39,457 | 1,971 | 263,047 | 288,262 | 3 |
| Go | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Go | broken-fixture | 13 | 0 | 0 | 2 | 6 | 14 |
| Go | template | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | source | 382,374 | 938 | 92,570 | 205,287 | 938,612 | 41 |
| Rust | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | template | 0 | 0 | 0 | 0 | 0 | 10 |
| TypeScript / JS | source | 678,836 | 4,042 | 74,101 | 316,676 | 382,934 | 30,248 |
| TypeScript / JS | bundle | 55,698 | 1 | 25,207 | 5,392 | 44,598 | 8 |
| TypeScript / JS | broken-fixture | 10 | 0 | 2 | 0 | 0 | 50 |
| TypeScript / JS | template | 0 | 0 | 0 | 0 | 0 | 1 |

## Repository results

Totals include every module in a finished checkout. For each attempt, the archive holds the full link breakdown and the explicit inside, outside and unclassified counts for every file scope.

| Repository | Selected language | Outcome | Links | Proven outside | Level 2 | Level 1 | Strict-inside | Raw | Source-only L2 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BurntSushi/ripgrep | Rust | finished | 39,819 | 8,684 | 53.97% | 53.98% | 44.06% | 34.45% | 53.97% |
| DioxusLabs/dioxus | Rust | finished | 153,841 | 30,058 | 34.09% | 34.13% | 31.33% | 25.21% | 33.90% |
| RustCrypto/hashes | Rust | finished | 12,911 | 2,230 | 32.44% | 32.79% | 29.72% | 24.58% | 32.44% |
| actix/actix-web | Rust | finished | 86,640 | 17,158 | 29.26% | 29.28% | 26.32% | 21.11% | 29.26% |
| alacritty/alacritty | Rust | finished | 30,965 | 5,468 | 35.62% | 35.63% | 33.64% | 27.70% | 35.62% |
| cberner/redb | Rust | finished | 73,731 | 6,483 | 30.96% | 30.96% | 27.26% | 24.86% | 30.96% |
| changesets/changesets | TypeScript / JS | finished | 12,646 | 6,292 | 40.87% | 43.49% | 28.49% | 14.31% | 40.87% |
| charmbracelet/bubbletea | Go | finished | 12,533 | 2,460 | 71.84% | 75.78% | 76.91% | 61.81% | 71.84% |
| cilium/ebpf | Go | finished | 50,239 | 11,651 | 77.95% | 80.85% | 86.47% | 66.41% | 77.95% |
| clap-rs/clap | Rust | finished | 52,417 | 6,173 | 30.08% | 30.09% | 24.07% | 21.24% | 30.08% |
| cli/cli | Go | finished | 218,286 | 52,675 | 75.18% | 78.26% | 82.72% | 62.76% | 75.77% |
| cockroachdb/pebble | Go | finished | 214,346 | 35,708 | 76.32% | 78.22% | 84.18% | 70.16% | 78.22% |
| colinhacks/zod | TypeScript / JS | finished | 81,042 | 25,453 | 76.77% | 77.37% | 89.45% | 61.36% | 76.77% |
| crossbeam-rs/crossbeam | Rust | finished | 34,220 | 6,643 | 34.48% | 34.55% | 28.20% | 22.73% | 34.48% |
| dexie/Dexie.js | TypeScript / JS | finished | 36,431 | 3,123 | 41.68% | 42.57% | 42.28% | 38.65% | 45.29% |
| etcd-io/bbolt | Go | finished | 16,898 | 3,955 | 75.78% | 78.78% | 82.61% | 63.27% | 75.78% |
| evanw/esbuild | Go | finished | 118,250 | 11,336 | 87.91% | 88.38% | 91.99% | 83.17% | 87.91% |
| excalidraw/excalidraw | TypeScript / JS | finished | 104,519 | 8,652 | 61.55% | 62.15% | 63.97% | 58.68% | 61.55% |
| fjall-rs/fjall | Rust | finished | 13,401 | 3,464 | 36.76% | 36.79% | 29.81% | 22.10% | 36.76% |
| gin-gonic/gin | Go | finished | 21,081 | 7,016 | 69.70% | 72.02% | 77.50% | 51.71% | 69.70% |
| go-task/task | Go | finished | 18,984 | 4,624 | 74.65% | 78.10% | 81.80% | 61.88% | 74.65% |
| gofiber/fiber | Go | finished | 143,673 | 31,981 | 66.15% | 67.78% | 72.02% | 55.98% | 66.15% |
| golang/tools | Go | finished | 253,517 | 57,579 | 74.14% | 76.95% | 76.52% | 59.14% | 74.79% |
| helix-editor/helix | Rust | finished | 90,780 | 15,104 | 33.64% | 33.65% | 30.22% | 25.19% | 33.64% |
| honojs/hono | TypeScript / JS | finished | 72,340 | 5,111 | 49.91% | 50.13% | 51.49% | 47.85% | 49.91% |
| junegunn/fzf | Go | finished | 25,947 | 3,346 | 77.94% | 79.24% | 82.72% | 72.05% | 77.94% |
| labstack/echo | Go | finished | 31,880 | 10,457 | 74.74% | 77.02% | 80.64% | 54.19% | 74.74% |
| mattn/go-sqlite3 | Go | finished | 9,650 | 2,414 | 55.95% | 58.82% | 50.28% | 37.70% | 55.95% |
| mermaid-js/mermaid | TypeScript / JS | finished | 125,657 | 33,431 | 56.99% | 57.82% | 58.78% | 43.14% | 56.99% |
| microsoft/TypeScript | TypeScript / JS | finished | 485,580 | 51,378 | 85.39% | 86.85% | 90.64% | 81.05% | 85.39% |
| nestjs/nest | TypeScript / JS | finished | 165,330 | 17,987 | 52.91% | 53.90% | 53.69% | 47.85% | 52.91% |
| oclif/core | TypeScript / JS | finished | 14,188 | 4,256 | 67.84% | 69.38% | 75.46% | 52.83% | 67.84% |
| pingdotgg/t3code | TypeScript / JS | finished | 162,711 | 65,155 | 68.99% | 72.93% | 65.07% | 39.01% | 68.99% |
| pmndrs/zustand | TypeScript / JS | finished | 7,099 | 3,101 | 64.15% | 65.32% | 68.16% | 38.39% | 64.15% |
| pocketbase/pocketbase | Go | finished | 197,148 | 18,266 | 56.18% | 57.30% | 56.83% | 51.56% | 70.24% |
| protocolbuffers/protobuf-go | Go | finished | 217,087 | 10,342 | 82.98% | 83.55% | 84.69% | 80.65% | 82.98% |
| puppeteer/puppeteer | TypeScript / JS | finished | 58,244 | 15,750 | 53.97% | 55.36% | 55.07% | 40.18% | 53.97% |
| ratatui/ratatui | Rust | finished | 60,424 | 4,077 | 28.68% | 28.71% | 27.70% | 25.83% | 28.68% |
| react-hook-form/react-hook-form | TypeScript / JS | finished | 49,115 | 11,483 | 50.67% | 51.47% | 40.91% | 31.34% | 50.67% |
| reduxjs/redux-toolkit | TypeScript / JS | finished | 57,208 | 6,887 | 48.94% | 49.84% | 47.68% | 41.94% | 48.94% |
| restic/restic | Go | finished | 64,165 | 13,539 | 79.12% | 82.57% | 83.65% | 66.00% | 79.12% |
| rust-embedded/cortex-m | Rust | finished | 5,531 | 938 | 48.89% | 49.39% | 46.83% | 38.89% | 48.89% |
| rust-lang/mdBook | Rust | finished | 20,253 | 3,603 | 28.56% | 28.59% | 21.93% | 18.03% | 29.38% |
| rustls/rustls | Rust | finished | 69,929 | 7,191 | 22.42% | 22.44% | 22.13% | 19.86% | 22.42% |
| samber/lo | Go | finished | 29,697 | 9,152 | 62.74% | 63.75% | 63.72% | 44.09% | 62.74% |
| serde-rs/serde | Rust | finished | 30,714 | 5,782 | 19.00% | 19.03% | 20.54% | 16.67% | 19.00% |
| spf13/cobra | Go | finished | 8,886 | 1,685 | 78.45% | 80.45% | 79.96% | 64.80% | 78.45% |
| stretchr/testify | Go | finished | 19,868 | 3,977 | 79.22% | 80.33% | 81.72% | 65.36% | 79.22% |
| tauri-apps/tauri | Rust | finished | 93,514 | 19,775 | 37.36% | 37.45% | 33.74% | 26.61% | 37.36% |
| tokio-rs/axum | Rust | finished | 41,099 | 7,659 | 27.12% | 27.14% | 25.93% | 21.10% | 27.12% |
| tree-sitter/tree-sitter | Rust | finished | 59,932 | 9,591 | 33.44% | 33.51% | 29.86% | 25.08% | 33.44% |
| trpc/trpc | TypeScript / JS | finished | 107,470 | 22,710 | 61.94% | 63.77% | 62.62% | 49.39% | 61.94% |
| vercel/turborepo | TypeScript / JS | finished | 673,381 | 52,124 | 29.69% | 29.72% | 25.18% | 23.23% | 29.69% |
| vitejs/vite | TypeScript / JS | finished | 55,575 | 20,043 | 62.79% | 65.12% | 65.08% | 41.61% | 62.79% |
| vitest-dev/vitest | TypeScript / JS | finished | 116,220 | 12,100 | 67.89% | 69.30% | 69.74% | 62.48% | 67.89% |
| wagoodman/dive | Go | finished | 14,901 | 3,790 | 69.10% | 74.34% | 77.50% | 57.79% | 69.10% |
| withastro/astro | TypeScript / JS | finished | 152,561 | 45,710 | 66.15% | 69.16% | 60.95% | 42.69% | 66.15% |
| yargs/yargs | TypeScript / JS | finished | 12,205 | 1,114 | 35.12% | 35.67% | 35.77% | 32.50% | 35.12% |

## Rust failed-file influence

These are exact stored unresolved counts. The eligible column uses the earlier audit disposition. The L2 misses column retains tainted library sites whose symbol is unproved. One site with both failure and receiver reasons belongs to the taint item.

| Repository | Unresolved with failed-file reason | Earlier eligible | L2 misses | Tainted and blocked | Also receiver-unverified | All unresolved marked blocked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DioxusLabs/dioxus | 12,554 | 9,927 | 12,554 | 6,210 | 4,135 | 48,359 |
| alacritty/alacritty | 11,640 | 9,813 | 11,640 | 6,311 | 3,307 | 10,100 |
| clap-rs/clap | 0 | 0 | 0 | 0 | 0 | 19,973 |
| rust-lang/mdBook | 317 | 296 | 317 | 279 | 181 | 4,707 |
| rustls/rustls | 19,958 | 17,020 | 19,958 | 9,038 | 5,655 | 21,265 |
| tauri-apps/tauri | 0 | 0 | 0 | 0 | 0 | 31,306 |
| vercel/turborepo | 300,142 | 266,182 | 269,601 | 169,834 | 121,700 | 289,764 |

## Outside-link review checks

These counts use source evidence from the full primary-module breakdown for the SW-1 review cases. For example, yargs imports its own build output, so `missing-module` on those relative paths remains inside. Unproven package links and return types stay unclassified.

| Repository | Outside / unresolved | Outside / unresolved imports |
| --- | ---: | ---: |
| gin-gonic/gin | 5,750 / 9,629 (59.72%) | 490 / 493 |
| yargs/yargs | 1,114 / 8,238 (13.52%) | 130 / 197 |
| alacritty/alacritty | 5,468 / 22,380 (24.43%) | 874 / 1,503 |
