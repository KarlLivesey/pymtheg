# SW-3 coverage scoreboard

Result package ` pymtheg@0.1.0 `. Candidate records replace 20 matching baseline pins.

## A. All 60 finish

**53 of 60 finished.**

- [ ] DioxusLabs/dioxus · Rust analysis stalled at the wall limit · open
- [ ] embassy-rs/embassy · Rust analysis stalled at the wall limit · open
- [ ] microsoft/TypeScript · Node heap exhausted · open
- [ ] rustls/rustls · Rust resolution stalled at the wall limit · open
- [ ] serde-rs/serde · Rust resolution stalled in recursive scope and use lookups · open
- [ ] swc-project/swc · Rust analysis stalled at the wall limit · open
- [ ] vercel/turborepo · Node heap exhausted · open

## B. Coverage of finished graphs

Level 2 counts resolved checkout links and named library symbols over all stored links. Level 1 also credits named library units. Strict-inside excludes the proven outside partition. Raw credits only the stored resolved outcome.
The closed-set alternative adds the sample estimate for verified complete candidate sets. Candidate evaluations reuse the reference sample.

| Files counted | Module | Graphs | Level 2 | Level 1 | L2 + verified closed sets (95% interval) | L2 median | Strict-inside weighted / median | Raw |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All files | Go | 23 | 76.99% | 79.13% | 76.99% (76.99%–77.14%) | 76.13% | 82.19% / 81.78% | 66.83% |
| All files | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| All files | TypeScript / JS | 31 | 48.02% | 49.52% | 48.07% (48.02%–48.16%) | 47.57% | 45.04% / 44.13% | 35.47% |
| All files | Overall | 53 | 57.08% | 58.58% | 57.12% (57.08%–57.21%) | 54.10% | 56.83% / 50.54% | 46.29% |
| Without bundles | Go | 23 | 76.99% | 79.13% | 76.99% (76.99%–77.14%) | 76.13% | 82.19% / 81.78% | 66.83% |
| Without bundles | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| Without bundles | TypeScript / JS | 31 | 51.70% | 53.32% | 51.75% (51.70%–51.85%) | 47.92% | 49.27% / 45.98% | 38.16% |
| Without bundles | Overall | 53 | 58.82% | 60.36% | 58.85% (58.82%–58.95%) | 54.38% | 58.86% / 50.66% | 47.69% |
| Without broken fixtures | Go | 23 | 76.99% | 79.13% | 76.99% (76.99%–77.14%) | 76.13% | 82.19% / 81.78% | 66.83% |
| Without broken fixtures | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| Without broken fixtures | TypeScript / JS | 31 | 48.02% | 49.52% | 48.07% (48.02%–48.16%) | 47.57% | 45.04% / 44.13% | 35.47% |
| Without broken fixtures | Overall | 53 | 57.08% | 58.58% | 57.12% (57.08%–57.22%) | 54.10% | 56.84% / 50.54% | 46.29% |
| Without templates | Go | 23 | 76.99% | 79.13% | 76.99% (76.99%–77.14%) | 76.13% | 82.19% / 81.78% | 66.83% |
| Without templates | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| Without templates | TypeScript / JS | 31 | 48.02% | 49.52% | 48.07% (48.02%–48.16%) | 47.57% | 45.04% / 44.13% | 35.47% |
| Without templates | Overall | 53 | 57.08% | 58.58% | 57.12% (57.08%–57.21%) | 54.10% | 56.83% / 50.54% | 46.29% |
| Source only | Go | 23 | 76.99% | 79.13% | 76.99% (76.99%–77.14%) | 76.13% | 82.19% / 81.78% | 66.83% |
| Source only | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| Source only | TypeScript / JS | 31 | 51.70% | 53.32% | 51.75% (51.70%–51.85%) | 47.92% | 49.27% / 45.98% | 38.16% |
| Source only | Overall | 53 | 58.82% | 60.36% | 58.85% (58.82%–58.95%) | 54.38% | 58.86% / 50.66% | 47.69% |

### Candidate sampling

| Module | Remaining reference sites used | Missed links outside the remaining projection |
| --- | ---: | ---: |
| Go | 296 | 729 |
| Rust | 430 | 0 |
| TypeScript / JS | 454 | 0 |

## What the released store says about outside links

Unit and symbol counts are exact on stored links with proof of outside origin. The final column estimates additional outside sites whose current facts name neither.
The audit recovers these identities from paths, import bindings, named declaring traits or directives. The target-ID slot points to a symbol in a captured file. The released graph has no first-class external target nodes.

| Module | Proven outside | Named unit, including L2 | Unit only | Unit and symbol | Neither, proven outside | Additional outside with neither (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | 283,154 | 186,419 | 32,537 | 153,882 | 96,735 | 121,608 (108,873–136,932) |
| Rust | 82,503 | 56,079 | 276 | 55,803 | 26,424 | 176,992 (157,979–202,296) |
| TypeScript / JS | 328,146 | 217,021 | 23,141 | 193,880 | 111,125 | 343,808 (315,282–387,804) |
| Overall | 693,803 | 459,519 | 55,954 | 403,565 | 234,284 | 642,407 (602,728–706,438) |

### Recorded library identities by encoding

| Module | Encoding | Level 1 only | Level 2 | Example |
| --- | --- | ---: | ---: | --- |
| Go | path | 32,537 | 0 | charmbracelet/bubbletea ` color.go:4 ` ` image/color ` |
| Go | import-binding | 0 | 153,882 | charmbracelet/bubbletea ` color.go:39 ` ` image/color → Color ` |
| Rust | path | 276 | 23,025 | BurntSushi/ripgrep ` build.rs:15 ` ` std → env::var ` |
| Rust | import-binding | 0 | 32,774 | BurntSushi/ripgrep ` crates/cli/src/decompress.rs:29 ` ` std → path::PathBuf ` |
| Rust | explicit-trait | 0 | 4 | crossbeam-rs/crossbeam ` crossbeam-skiplist/src/base.rs:421 ` ` core → fmt::Debug::fmt ` |
| TypeScript / JS | path | 19,321 | 0 | changesets/changesets ` docs/.vitepress/config.ts:1 ` ` unplugin-icons/vite ` |
| TypeScript / JS | import-binding | 3,808 | 193,880 | changesets/changesets ` docs/.vitepress/config.ts:1 ` ` unplugin-icons/vite → default ` |
| TypeScript / JS | reference-directive | 12 | 0 | dexie/Dexie.js ` samples/dexie-cloud-todo-app/src/sw.ts:1 ` ` typescript/lib/webworker ` |

## Source scopes

Counts include every observed link. Broken and template files that produced no links appear in the failed-source column.

| Module | Scope | Resolved | Ambiguous | Inside | Outside | Unclassified | Failed source files |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | source | 1,012,413 | 37,932 | 644 | 221,988 | 241,975 | 3 |
| Go | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Go | broken-fixture | 0 | 0 | 0 | 0 | 0 | 14 |
| Go | template | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | source | 170,020 | 781 | 42,547 | 77,596 | 387,824 | 32 |
| Rust | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | template | 0 | 0 | 0 | 0 | 0 | 10 |
| TypeScript / JS | source | 546,513 | 4,274 | 176,980 | 319,896 | 384,341 | 7 |
| TypeScript / JS | bundle | 1,139 | 1 | 61,580 | 5,288 | 44,111 | 0 |
| TypeScript / JS | broken-fixture | 1 | 0 | 11 | 0 | 0 | 11 |
| TypeScript / JS | template | 0 | 0 | 0 | 0 | 0 | 1 |

## Repository results

Totals include every module in a finished checkout. For each attempt, the archive holds the full link breakdown and the explicit inside, outside and unclassified counts for every file scope.

| Repository | Selected language | Outcome | Links | Proven outside | Level 2 | Level 1 | Strict-inside | Raw | Source-only L2 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BurntSushi/ripgrep | Rust | finished | 39,086 | 3,616 | 41.68% | 41.70% | 38.68% | 35.10% | 41.68% |
| RustCrypto/hashes | Rust | finished | 12,870 | 2,213 | 40.69% | 41.13% | 29.78% | 24.66% | 40.69% |
| actix/actix-web | Rust | finished | 85,053 | 14,371 | 31.02% | 31.05% | 25.88% | 21.50% | 31.02% |
| alacritty/alacritty | Rust | finished | 30,052 | 4,955 | 39.39% | 39.41% | 34.17% | 28.54% | 39.39% |
| cberner/redb | Rust | finished | 73,191 | 2,945 | 29.04% | 29.06% | 26.09% | 25.04% | 29.04% |
| changesets/changesets | TypeScript / JS | finished | 12,609 | 6,292 | 39.87% | 42.50% | 26.42% | 13.24% | 39.87% |
| charmbracelet/bubbletea | Go | finished | 12,590 | 2,460 | 71.97% | 75.89% | 77.04% | 61.99% | 71.97% |
| cilium/ebpf | Go | finished | 50,300 | 11,651 | 77.65% | 80.54% | 86.06% | 66.13% | 77.65% |
| clap-rs/clap | Rust | finished | 50,949 | 3,422 | 26.96% | 27.00% | 23.42% | 21.85% | 26.96% |
| cli/cli | Go | finished | 218,250 | 52,675 | 74.94% | 78.03% | 82.41% | 62.52% | 75.72% |
| cockroachdb/pebble | Go | finished | 211,884 | 35,708 | 74.73% | 76.65% | 82.38% | 68.50% | 78.24% |
| colinhacks/zod | TypeScript / JS | finished | 80,462 | 25,453 | 71.00% | 71.61% | 81.15% | 55.48% | 71.00% |
| crossbeam-rs/crossbeam | Rust | finished | 34,043 | 5,844 | 31.29% | 31.35% | 27.58% | 22.85% | 31.29% |
| dexie/Dexie.js | TypeScript / JS | finished | 35,874 | 3,536 | 34.91% | 35.82% | 35.32% | 31.84% | 38.13% |
| etcd-io/bbolt | Go | finished | 16,939 | 3,955 | 75.84% | 78.83% | 82.66% | 63.36% | 75.84% |
| evanw/esbuild | Go | finished | 116,661 | 11,336 | 86.86% | 87.33% | 90.88% | 82.05% | 86.86% |
| excalidraw/excalidraw | TypeScript / JS | finished | 103,386 | 8,652 | 57.79% | 58.40% | 59.90% | 54.89% | 57.79% |
| fjall-rs/fjall | Rust | finished | 13,275 | 2,896 | 35.99% | 36.02% | 28.54% | 22.31% | 35.99% |
| gin-gonic/gin | Go | finished | 21,086 | 7,016 | 69.71% | 72.03% | 77.51% | 51.72% | 69.71% |
| go-task/task | Go | finished | 19,003 | 4,624 | 74.66% | 78.11% | 81.81% | 61.90% | 74.66% |
| gofiber/fiber | Go | finished | 143,978 | 31,981 | 66.23% | 67.86% | 72.09% | 56.08% | 66.23% |
| golang/tools | Go | finished | 253,583 | 57,579 | 74.06% | 76.87% | 76.42% | 59.07% | 74.77% |
| helix-editor/helix | Rust | finished | 86,281 | 9,627 | 33.23% | 33.25% | 29.83% | 26.50% | 33.23% |
| honojs/hono | TypeScript / JS | finished | 70,761 | 5,125 | 36.00% | 36.22% | 36.54% | 33.89% | 36.00% |
| junegunn/fzf | Go | finished | 25,970 | 3,346 | 77.88% | 79.18% | 82.64% | 71.99% | 77.88% |
| labstack/echo | Go | finished | 31,900 | 10,457 | 74.76% | 77.03% | 80.66% | 54.22% | 74.76% |
| mattn/go-sqlite3 | Go | finished | 9,664 | 2,414 | 55.16% | 58.03% | 49.24% | 36.94% | 55.16% |
| mermaid-js/mermaid | TypeScript / JS | finished | 124,766 | 33,431 | 54.56% | 55.39% | 55.47% | 40.61% | 54.56% |
| nestjs/nest | TypeScript / JS | finished | 161,185 | 18,516 | 47.92% | 48.94% | 48.28% | 42.73% | 47.92% |
| oclif/core | TypeScript / JS | finished | 14,031 | 4,256 | 63.11% | 64.67% | 68.80% | 47.93% | 63.11% |
| pingdotgg/t3code | TypeScript / JS | finished | 161,530 | 65,155 | 67.21% | 71.18% | 62.04% | 37.02% | 67.21% |
| pmndrs/zustand | TypeScript / JS | finished | 6,821 | 3,101 | 54.38% | 55.59% | 50.54% | 27.56% | 54.38% |
| pocketbase/pocketbase | Go | finished | 182,609 | 18,266 | 34.38% | 35.58% | 32.65% | 29.39% | 69.75% |
| protocolbuffers/protobuf-go | Go | finished | 217,137 | 10,342 | 82.16% | 82.73% | 83.83% | 79.83% | 82.16% |
| puppeteer/puppeteer | TypeScript / JS | finished | 57,957 | 15,750 | 50.75% | 52.15% | 50.66% | 36.89% | 50.75% |
| ratatui/ratatui | Rust | finished | 57,390 | 3,082 | 31.34% | 31.37% | 28.74% | 27.19% | 31.34% |
| react-hook-form/react-hook-form | TypeScript / JS | finished | 46,333 | 11,483 | 41.14% | 42.00% | 27.47% | 20.66% | 41.14% |
| reduxjs/redux-toolkit | TypeScript / JS | finished | 55,912 | 7,003 | 39.34% | 40.27% | 36.79% | 32.18% | 39.34% |
| restic/restic | Go | finished | 64,359 | 13,539 | 79.18% | 82.62% | 83.70% | 66.09% | 79.18% |
| rust-embedded/cortex-m | Rust | finished | 5,200 | 775 | 54.10% | 55.52% | 48.61% | 41.37% | 54.10% |
| rust-lang/mdBook | Rust | finished | 19,753 | 2,558 | 23.63% | 23.66% | 16.67% | 14.51% | 24.49% |
| samber/lo | Go | finished | 29,761 | 9,152 | 62.81% | 63.82% | 63.82% | 44.20% | 62.81% |
| spf13/cobra | Go | finished | 8,888 | 1,685 | 78.45% | 80.46% | 79.97% | 64.81% | 78.45% |
| stretchr/testify | Go | finished | 19,919 | 3,977 | 79.28% | 80.38% | 81.78% | 65.45% | 79.28% |
| tauri-apps/tauri | Rust | finished | 91,170 | 15,361 | 37.31% | 37.40% | 31.94% | 26.56% | 37.31% |
| tokio-rs/axum | Rust | finished | 39,950 | 6,985 | 35.18% | 35.20% | 26.31% | 21.71% | 35.18% |
| tree-sitter/tree-sitter | Rust | finished | 58,825 | 6,995 | 33.60% | 33.68% | 28.75% | 25.33% | 33.60% |
| trpc/trpc | TypeScript / JS | finished | 105,855 | 23,196 | 53.31% | 55.17% | 51.95% | 40.56% | 53.31% |
| vitejs/vite | TypeScript / JS | finished | 55,027 | 20,043 | 59.87% | 62.23% | 60.53% | 38.48% | 59.87% |
| vitest-dev/vitest | TypeScript / JS | finished | 115,331 | 12,218 | 36.13% | 37.55% | 34.31% | 30.68% | 36.13% |
| wagoodman/dive | Go | finished | 14,913 | 3,790 | 69.12% | 74.36% | 77.52% | 57.82% | 69.12% |
| withastro/astro | TypeScript / JS | finished | 151,382 | 47,881 | 52.89% | 55.93% | 42.78% | 29.25% | 52.89% |
| yargs/yargs | TypeScript / JS | finished | 12,151 | 1,114 | 33.41% | 33.96% | 33.90% | 30.79% | 33.41% |

## Rust failed-file influence

These are exact stored unresolved counts. The eligible column uses the earlier audit disposition. The L2 misses column retains tainted library sites whose symbol is unproved. One site with both failure and receiver reasons belongs to the taint item.

| Repository | Unresolved with failed-file reason | Earlier eligible | L2 misses | Tainted and blocked | Also receiver-unverified | All unresolved marked blocked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| alacritty/alacritty | 12,344 | 9,697 | 10,232 | 6,311 | 3,307 | 10,100 |
| clap-rs/clap | 0 | 0 | 0 | 0 | 0 | 19,973 |
| rust-lang/mdBook | 444 | 374 | 382 | 279 | 181 | 4,707 |
| tauri-apps/tauri | 0 | 0 | 0 | 0 | 0 | 31,306 |

## Outside-link review checks

These counts use source evidence from the full primary-module breakdown for the SW-1 review cases. For example, yargs imports its own build output, so `missing-module` on those relative paths remains inside. Unproven package links and return types stay unclassified.

| Repository | Outside / unresolved | Outside / unresolved imports |
| --- | ---: | ---: |
| gin-gonic/gin | 5,750 / 9,629 (59.72%) | 490 / 493 |
| yargs/yargs | 1,114 / 8,410 (13.25%) | 130 / 197 |
| alacritty/alacritty | 4,585 / 21,467 (21.36%) | 870 / 1,503 |
