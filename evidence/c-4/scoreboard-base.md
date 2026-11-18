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
| All files | Go | 23 | 74.16% | 76.35% | 74.16% (74.16%–74.31%) | 73.35% | 78.82% / 78.12% | 63.79% |
| All files | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| All files | TypeScript / JS | 31 | 48.02% | 49.52% | 48.07% (48.02%–48.16%) | 47.57% | 45.04% / 44.13% | 35.47% |
| All files | Overall | 53 | 55.79% | 57.30% | 55.82% (55.79%–55.92%) | 53.55% | 55.24% / 50.54% | 44.91% |
| Without bundles | Go | 23 | 74.16% | 76.35% | 74.16% (74.16%–74.31%) | 73.35% | 78.82% / 78.12% | 63.79% |
| Without bundles | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| Without bundles | TypeScript / JS | 31 | 51.70% | 53.32% | 51.75% (51.70%–51.85%) | 47.92% | 49.27% / 45.98% | 38.16% |
| Without bundles | Overall | 53 | 57.50% | 59.05% | 57.53% (57.50%–57.63%) | 54.10% | 57.23% / 50.66% | 46.27% |
| Without broken fixtures | Go | 23 | 74.16% | 76.35% | 74.16% (74.16%–74.31%) | 73.35% | 78.82% / 78.12% | 63.79% |
| Without broken fixtures | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| Without broken fixtures | TypeScript / JS | 31 | 48.02% | 49.52% | 48.07% (48.02%–48.16%) | 47.57% | 45.04% / 44.13% | 35.47% |
| Without broken fixtures | Overall | 53 | 55.79% | 57.30% | 55.82% (55.79%–55.92%) | 53.55% | 55.24% / 50.54% | 44.91% |
| Without templates | Go | 23 | 74.16% | 76.35% | 74.16% (74.16%–74.31%) | 73.35% | 78.82% / 78.12% | 63.79% |
| Without templates | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| Without templates | TypeScript / JS | 31 | 48.02% | 49.52% | 48.07% (48.02%–48.16%) | 47.57% | 45.04% / 44.13% | 35.47% |
| Without templates | Overall | 53 | 55.79% | 57.30% | 55.82% (55.79%–55.92%) | 53.55% | 55.24% / 50.54% | 44.91% |
| Source only | Go | 23 | 74.16% | 76.35% | 74.16% (74.16%–74.31%) | 73.35% | 78.82% / 78.12% | 63.79% |
| Source only | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| Source only | TypeScript / JS | 31 | 51.70% | 53.32% | 51.75% (51.70%–51.85%) | 47.92% | 49.27% / 45.98% | 38.16% |
| Source only | Overall | 53 | 57.50% | 59.05% | 57.53% (57.50%–57.64%) | 54.10% | 57.23% / 50.66% | 46.27% |

### Candidate sampling

| Module | Remaining reference sites used | Missed links outside the remaining projection |
| --- | ---: | ---: |
| Go | 339 | 781 |
| Rust | 430 | 0 |
| TypeScript / JS | 454 | 0 |

## What the released store says about outside links

Unit and symbol counts are exact on stored links with proof of outside origin. The final column estimates additional outside sites whose current facts name neither.
The audit recovers these identities from paths, import bindings, named declaring traits or directives. The target-ID slot points to a symbol in a captured file. The released graph has no first-class external target nodes.

| Module | Proven outside | Named unit, including L2 | Unit only | Unit and symbol | Neither, proven outside | Additional outside with neither (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | 283,154 | 186,419 | 32,537 | 153,882 | 96,735 | 122,754 (109,904–135,899) |
| Rust | 82,503 | 56,079 | 276 | 55,803 | 26,424 | 176,992 (157,979–202,296) |
| TypeScript / JS | 328,146 | 217,021 | 23,141 | 193,880 | 111,125 | 343,808 (315,282–387,804) |
| Overall | 693,803 | 459,519 | 55,954 | 403,565 | 234,284 | 643,553 (603,823–705,341) |

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
| Go | source | 947,495 | 38,466 | 644 | 221,988 | 276,629 | 3 |
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
| charmbracelet/bubbletea | Go | finished | 12,498 | 2,460 | 71.39% | 75.33% | 76.36% | 61.33% | 71.39% |
| cilium/ebpf | Go | finished | 49,614 | 11,651 | 76.24% | 79.17% | 84.37% | 64.56% | 76.24% |
| clap-rs/clap | Rust | finished | 50,949 | 3,422 | 26.96% | 27.00% | 23.42% | 21.85% | 26.96% |
| cli/cli | Go | finished | 207,303 | 52,675 | 68.55% | 71.80% | 74.37% | 55.48% | 69.30% |
| cockroachdb/pebble | Go | finished | 210,500 | 35,708 | 71.58% | 73.51% | 78.64% | 65.30% | 74.96% |
| colinhacks/zod | TypeScript / JS | finished | 80,462 | 25,453 | 71.00% | 71.61% | 81.15% | 55.48% | 71.00% |
| crossbeam-rs/crossbeam | Rust | finished | 34,043 | 5,844 | 31.29% | 31.35% | 27.58% | 22.85% | 31.29% |
| dexie/Dexie.js | TypeScript / JS | finished | 35,874 | 3,536 | 34.91% | 35.82% | 35.32% | 31.84% | 38.13% |
| etcd-io/bbolt | Go | finished | 16,741 | 3,955 | 73.35% | 76.38% | 79.52% | 60.73% | 73.35% |
| evanw/esbuild | Go | finished | 116,564 | 11,336 | 86.52% | 87.00% | 90.51% | 81.71% | 86.52% |
| excalidraw/excalidraw | TypeScript / JS | finished | 103,386 | 8,652 | 57.79% | 58.40% | 59.90% | 54.89% | 57.79% |
| fjall-rs/fjall | Rust | finished | 13,275 | 2,896 | 35.99% | 36.02% | 28.54% | 22.31% | 35.99% |
| gin-gonic/gin | Go | finished | 20,364 | 7,016 | 67.58% | 69.98% | 74.69% | 48.95% | 67.58% |
| go-task/task | Go | finished | 18,445 | 4,624 | 72.31% | 75.86% | 78.96% | 59.17% | 72.31% |
| gofiber/fiber | Go | finished | 139,671 | 31,981 | 62.05% | 63.73% | 66.91% | 51.59% | 62.05% |
| golang/tools | Go | finished | 251,402 | 57,579 | 72.76% | 75.60% | 74.76% | 57.64% | 73.46% |
| helix-editor/helix | Rust | finished | 86,281 | 9,627 | 33.23% | 33.25% | 29.83% | 26.50% | 33.23% |
| honojs/hono | TypeScript / JS | finished | 70,761 | 5,125 | 36.00% | 36.22% | 36.54% | 33.89% | 36.00% |
| junegunn/fzf | Go | finished | 25,820 | 3,346 | 76.70% | 78.01% | 81.32% | 70.78% | 76.70% |
| labstack/echo | Go | finished | 30,180 | 10,457 | 67.84% | 70.24% | 70.58% | 46.12% | 67.84% |
| mattn/go-sqlite3 | Go | finished | 9,598 | 2,414 | 53.55% | 56.44% | 47.04% | 35.21% | 53.55% |
| mermaid-js/mermaid | TypeScript / JS | finished | 124,766 | 33,431 | 54.56% | 55.39% | 55.47% | 40.61% | 54.56% |
| nestjs/nest | TypeScript / JS | finished | 161,185 | 18,516 | 47.92% | 48.94% | 48.28% | 42.73% | 47.92% |
| oclif/core | TypeScript / JS | finished | 14,031 | 4,256 | 63.11% | 64.67% | 68.80% | 47.93% | 63.11% |
| pingdotgg/t3code | TypeScript / JS | finished | 161,530 | 65,155 | 67.21% | 71.18% | 62.04% | 37.02% | 67.21% |
| pmndrs/zustand | TypeScript / JS | finished | 6,821 | 3,101 | 54.38% | 55.59% | 50.54% | 27.56% | 54.38% |
| pocketbase/pocketbase | Go | finished | 180,199 | 18,266 | 32.04% | 33.26% | 30.02% | 26.98% | 65.84% |
| protocolbuffers/protobuf-go | Go | finished | 216,552 | 10,342 | 81.63% | 82.20% | 83.27% | 79.30% | 81.63% |
| puppeteer/puppeteer | TypeScript / JS | finished | 57,957 | 15,750 | 50.75% | 52.15% | 50.66% | 36.89% | 50.75% |
| ratatui/ratatui | Rust | finished | 57,390 | 3,082 | 31.34% | 31.37% | 28.74% | 27.19% | 31.34% |
| react-hook-form/react-hook-form | TypeScript / JS | finished | 46,333 | 11,483 | 41.14% | 42.00% | 27.47% | 20.66% | 41.14% |
| reduxjs/redux-toolkit | TypeScript / JS | finished | 55,912 | 7,003 | 39.34% | 40.27% | 36.79% | 32.18% | 39.34% |
| restic/restic | Go | finished | 63,408 | 13,539 | 76.54% | 80.04% | 80.44% | 63.26% | 76.54% |
| rust-embedded/cortex-m | Rust | finished | 5,200 | 775 | 54.10% | 55.52% | 48.61% | 41.37% | 54.10% |
| rust-lang/mdBook | Rust | finished | 19,753 | 2,558 | 23.63% | 23.66% | 16.67% | 14.51% | 24.49% |
| samber/lo | Go | finished | 27,801 | 9,152 | 54.62% | 55.70% | 51.72% | 34.70% | 54.62% |
| spf13/cobra | Go | finished | 8,792 | 1,685 | 76.94% | 78.97% | 78.12% | 63.15% | 76.94% |
| stretchr/testify | Go | finished | 19,521 | 3,977 | 76.67% | 77.80% | 78.57% | 62.56% | 76.67% |
| tauri-apps/tauri | Rust | finished | 91,170 | 15,361 | 37.31% | 37.40% | 31.94% | 26.56% | 37.31% |
| tokio-rs/axum | Rust | finished | 39,950 | 6,985 | 35.18% | 35.20% | 26.31% | 21.71% | 35.18% |
| tree-sitter/tree-sitter | Rust | finished | 58,825 | 6,995 | 33.60% | 33.68% | 28.75% | 25.33% | 33.60% |
| trpc/trpc | TypeScript / JS | finished | 105,855 | 23,196 | 53.31% | 55.17% | 51.95% | 40.56% | 53.31% |
| vitejs/vite | TypeScript / JS | finished | 55,027 | 20,043 | 59.87% | 62.23% | 60.53% | 38.48% | 59.87% |
| vitest-dev/vitest | TypeScript / JS | finished | 115,331 | 12,218 | 36.13% | 37.55% | 34.31% | 30.68% | 36.13% |
| wagoodman/dive | Go | finished | 14,691 | 3,790 | 67.40% | 72.71% | 75.37% | 55.93% | 67.40% |
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
| gin-gonic/gin | 5,750 / 9,835 (58.46%) | 490 / 493 |
| yargs/yargs | 1,114 / 8,410 (13.25%) | 130 / 197 |
| alacritty/alacritty | 4,585 / 21,467 (21.36%) | 870 / 1,503 |
