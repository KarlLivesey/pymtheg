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
| All files | Go | 23 | 77.81% | 79.96% | 77.81% (77.81%–77.96%) | 76.54% | 83.21% / 81.91% | 67.64% |
| All files | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| All files | TypeScript / JS | 31 | 51.18% | 52.66% | 51.22% (51.18%–51.31%) | 47.92% | 49.08% / 47.51% | 38.78% |
| All files | Overall | 53 | 58.67% | 60.16% | 58.70% (58.67%–58.80%) | 54.38% | 58.79% / 50.66% | 47.93% |
| Without bundles | Go | 23 | 77.81% | 79.96% | 77.81% (77.81%–77.96%) | 76.54% | 83.21% / 81.91% | 67.64% |
| Without bundles | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| Without bundles | TypeScript / JS | 31 | 51.89% | 53.50% | 51.94% (51.89%–52.03%) | 47.92% | 49.52% / 45.99% | 38.37% |
| Without bundles | Overall | 53 | 59.22% | 60.76% | 59.25% (59.22%–59.36%) | 54.38% | 59.36% / 50.66% | 48.09% |
| Without broken fixtures | Go | 23 | 77.81% | 79.96% | 77.81% (77.81%–77.96%) | 76.54% | 83.21% / 81.91% | 67.64% |
| Without broken fixtures | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| Without broken fixtures | TypeScript / JS | 31 | 51.18% | 52.66% | 51.22% (51.18%–51.31%) | 47.92% | 49.08% / 47.51% | 38.78% |
| Without broken fixtures | Overall | 53 | 58.67% | 60.16% | 58.70% (58.67%–58.80%) | 54.38% | 58.79% / 50.66% | 47.93% |
| Without templates | Go | 23 | 77.81% | 79.96% | 77.81% (77.81%–77.96%) | 76.54% | 83.21% / 81.91% | 67.64% |
| Without templates | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| Without templates | TypeScript / JS | 31 | 51.18% | 52.66% | 51.22% (51.18%–51.31%) | 47.92% | 49.08% / 47.51% | 38.78% |
| Without templates | Overall | 53 | 58.67% | 60.16% | 58.70% (58.67%–58.80%) | 54.38% | 58.79% / 50.66% | 47.93% |
| Source only | Go | 23 | 77.81% | 79.96% | 77.81% (77.81%–77.96%) | 76.54% | 83.21% / 81.91% | 67.64% |
| Source only | Rust | 15 | 33.27% | 33.31% | 33.35% (33.30%–33.38%) | 35.20% | 28.51% / 28.56% | 25.05% |
| Source only | TypeScript / JS | 31 | 51.89% | 53.50% | 51.94% (51.89%–52.04%) | 47.92% | 49.52% / 45.99% | 38.37% |
| Source only | Overall | 53 | 59.22% | 60.76% | 59.25% (59.22%–59.36%) | 54.38% | 59.36% / 50.66% | 48.09% |

### Candidate sampling

| Module | Remaining reference sites used | Missed links outside the remaining projection |
| --- | ---: | ---: |
| Go | 274 | 1,410 |
| Rust | 430 | 0 |
| TypeScript / JS | 428 | 4,011 |

## What the released store says about outside links

Unit and symbol counts are exact on stored links with proof of outside origin. The final column estimates additional outside sites whose current facts name neither.
The audit recovers these identities from paths, import bindings, named declaring traits or directives. The target-ID slot points to a symbol in a captured file. The released graph has no first-class external target nodes.

| Module | Proven outside | Named unit, including L2 | Unit only | Unit and symbol | Neither, proven outside | Additional outside with neither (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | 283,154 | 186,419 | 32,537 | 153,882 | 96,735 | 121,080 (108,400–136,348) |
| Rust | 82,503 | 56,079 | 276 | 55,803 | 26,424 | 176,992 (157,979–202,296) |
| TypeScript / JS | 328,146 | 217,021 | 23,141 | 193,880 | 111,125 | 343,765 (315,242–387,758) |
| Overall | 693,803 | 459,519 | 55,954 | 403,565 | 234,284 | 641,837 (602,184–705,839) |

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
| Go | source | 1,023,537 | 36,689 | 207 | 221,988 | 230,778 | 3 |
| Go | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Go | broken-fixture | 0 | 0 | 0 | 0 | 0 | 14 |
| Go | template | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | source | 170,020 | 781 | 42,547 | 77,596 | 387,824 | 32 |
| Rust | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | template | 0 | 0 | 0 | 0 | 0 | 10 |
| TypeScript / JS | source | 550,233 | 4,274 | 175,303 | 319,896 | 384,365 | 7 |
| TypeScript / JS | bundle | 56,064 | 1 | 22,776 | 5,288 | 45,318 | 0 |
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
| charmbracelet/bubbletea | Go | finished | 12,533 | 2,460 | 71.84% | 75.78% | 76.91% | 61.81% | 71.84% |
| cilium/ebpf | Go | finished | 50,239 | 11,651 | 78.14% | 81.04% | 86.71% | 66.60% | 78.14% |
| clap-rs/clap | Rust | finished | 50,949 | 3,422 | 26.96% | 27.00% | 23.42% | 21.85% | 26.96% |
| cli/cli | Go | finished | 218,286 | 52,675 | 75.60% | 78.69% | 83.28% | 63.18% | 76.20% |
| cockroachdb/pebble | Go | finished | 214,346 | 35,708 | 76.41% | 78.32% | 84.30% | 70.25% | 78.32% |
| colinhacks/zod | TypeScript / JS | finished | 80,462 | 25,453 | 71.00% | 71.61% | 81.15% | 55.48% | 71.00% |
| crossbeam-rs/crossbeam | Rust | finished | 34,043 | 5,844 | 31.29% | 31.35% | 27.58% | 22.85% | 31.29% |
| dexie/Dexie.js | TypeScript / JS | finished | 35,874 | 3,536 | 34.91% | 35.82% | 35.32% | 31.84% | 38.13% |
| etcd-io/bbolt | Go | finished | 16,898 | 3,955 | 76.12% | 79.12% | 83.06% | 63.62% | 76.12% |
| evanw/esbuild | Go | finished | 118,250 | 11,336 | 87.96% | 88.43% | 92.04% | 83.22% | 87.96% |
| excalidraw/excalidraw | TypeScript / JS | finished | 103,386 | 8,652 | 57.79% | 58.40% | 59.90% | 54.89% | 57.79% |
| fjall-rs/fjall | Rust | finished | 13,275 | 2,896 | 35.99% | 36.02% | 28.54% | 22.31% | 35.99% |
| gin-gonic/gin | Go | finished | 21,081 | 7,016 | 69.92% | 72.25% | 77.84% | 51.93% | 69.92% |
| go-task/task | Go | finished | 18,984 | 4,624 | 74.65% | 78.10% | 81.80% | 61.88% | 74.65% |
| gofiber/fiber | Go | finished | 143,673 | 31,981 | 66.17% | 67.80% | 72.04% | 56.00% | 66.17% |
| golang/tools | Go | finished | 253,517 | 57,579 | 76.15% | 78.96% | 79.12% | 61.15% | 76.81% |
| helix-editor/helix | Rust | finished | 86,281 | 9,627 | 33.23% | 33.25% | 29.83% | 26.50% | 33.23% |
| honojs/hono | TypeScript / JS | finished | 70,761 | 5,125 | 36.00% | 36.22% | 36.54% | 33.89% | 36.00% |
| junegunn/fzf | Go | finished | 25,947 | 3,346 | 77.94% | 79.24% | 82.72% | 72.05% | 77.94% |
| labstack/echo | Go | finished | 31,880 | 10,457 | 74.75% | 77.02% | 80.64% | 54.19% | 74.75% |
| mattn/go-sqlite3 | Go | finished | 9,650 | 2,414 | 56.00% | 58.87% | 50.35% | 37.75% | 56.00% |
| mermaid-js/mermaid | TypeScript / JS | finished | 124,766 | 33,431 | 54.56% | 55.39% | 55.47% | 40.61% | 54.56% |
| nestjs/nest | TypeScript / JS | finished | 161,185 | 18,516 | 47.92% | 48.94% | 48.28% | 42.73% | 47.92% |
| oclif/core | TypeScript / JS | finished | 14,031 | 4,256 | 63.11% | 64.67% | 68.80% | 47.93% | 63.11% |
| pingdotgg/t3code | TypeScript / JS | finished | 161,530 | 65,155 | 67.21% | 71.18% | 62.04% | 37.02% | 67.21% |
| pmndrs/zustand | TypeScript / JS | finished | 6,821 | 3,101 | 54.38% | 55.59% | 50.54% | 27.56% | 54.38% |
| pocketbase/pocketbase | Go | finished | 197,148 | 18,266 | 56.88% | 58.00% | 57.59% | 52.26% | 70.41% |
| protocolbuffers/protobuf-go | Go | finished | 217,087 | 10,342 | 84.87% | 85.43% | 86.67% | 82.54% | 84.87% |
| puppeteer/puppeteer | TypeScript / JS | finished | 57,957 | 15,750 | 50.75% | 52.15% | 50.66% | 36.89% | 50.75% |
| ratatui/ratatui | Rust | finished | 57,390 | 3,082 | 31.34% | 31.37% | 28.74% | 27.19% | 31.34% |
| react-hook-form/react-hook-form | TypeScript / JS | finished | 46,333 | 11,483 | 41.14% | 42.00% | 27.47% | 20.66% | 41.14% |
| reduxjs/redux-toolkit | TypeScript / JS | finished | 55,912 | 7,003 | 39.34% | 40.27% | 36.79% | 32.18% | 39.34% |
| restic/restic | Go | finished | 64,165 | 13,539 | 79.17% | 82.62% | 83.71% | 66.05% | 79.17% |
| rust-embedded/cortex-m | Rust | finished | 5,200 | 775 | 54.10% | 55.52% | 48.61% | 41.37% | 54.10% |
| rust-lang/mdBook | Rust | finished | 19,753 | 2,558 | 23.63% | 23.66% | 16.67% | 14.51% | 24.49% |
| samber/lo | Go | finished | 29,697 | 9,152 | 62.74% | 63.75% | 63.72% | 44.09% | 62.74% |
| spf13/cobra | Go | finished | 8,886 | 1,685 | 78.46% | 80.46% | 79.98% | 64.81% | 78.46% |
| stretchr/testify | Go | finished | 19,868 | 3,977 | 79.38% | 80.49% | 81.91% | 65.52% | 79.38% |
| tauri-apps/tauri | Rust | finished | 91,170 | 15,361 | 37.31% | 37.40% | 31.94% | 26.56% | 37.31% |
| tokio-rs/axum | Rust | finished | 39,950 | 6,985 | 35.18% | 35.20% | 26.31% | 21.71% | 35.18% |
| tree-sitter/tree-sitter | Rust | finished | 58,825 | 6,995 | 33.60% | 33.68% | 28.75% | 25.33% | 33.60% |
| trpc/trpc | TypeScript / JS | finished | 105,855 | 23,196 | 53.31% | 55.17% | 51.95% | 40.56% | 53.31% |
| vitejs/vite | TypeScript / JS | finished | 55,027 | 20,043 | 59.87% | 62.23% | 60.53% | 38.48% | 59.87% |
| vitest-dev/vitest | TypeScript / JS | finished | 115,331 | 12,218 | 36.13% | 37.55% | 34.31% | 30.68% | 36.13% |
| wagoodman/dive | Go | finished | 14,901 | 3,790 | 69.23% | 74.47% | 77.68% | 57.92% | 69.23% |
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
| gin-gonic/gin | 5,750 / 9,582 (60.01%) | 490 / 490 |
| yargs/yargs | 1,114 / 8,410 (13.25%) | 130 / 197 |
| alacritty/alacritty | 4,585 / 21,467 (21.36%) | 870 / 1,503 |
