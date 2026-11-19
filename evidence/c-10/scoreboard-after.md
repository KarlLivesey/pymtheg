# SW-3 coverage scoreboard

Result package ` pymtheg@0.1.0 `. Candidate records replace 54 matching baseline pins.

## A. All 60 finish

**58 of 60 finished.**

- [x] DioxusLabs/dioxus · Rust analysis stalled at the wall limit · finished
- [ ] embassy-rs/embassy · Wall limit after Rust analysis completed · open
- [x] microsoft/TypeScript · Node heap exhausted · finished
- [x] rustls/rustls · Rust resolution stalled at the wall limit · finished
- [x] serde-rs/serde · Rust resolution stalled in recursive scope and use lookups · finished
- [ ] swc-project/swc · Wall limit after Rust analysis completed · open
- [x] vercel/turborepo · Node heap exhausted · finished

## B. Coverage of finished graphs

Level 2 counts resolved checkout links and named library symbols over all stored links. Level 1 also credits named library units. Strict-inside excludes the proven outside partition. Raw credits only the stored resolved outcome.
The closed-set alternative adds the sample estimate for verified complete candidate sets. Candidate evaluations reuse the reference sample.

| Files counted | Module | Graphs | Level 2 | Level 1 | L2 + verified closed sets (95% interval) | L2 median | Strict-inside weighted / median | Raw |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All files | Go | 25 | 79.11% | 81.10% | 79.11% (79.11%–79.23%) | 76.11% | 84.50% / 81.72% | 70.35% |
| All files | Rust | 19 | 34.57% | 34.59% | 34.60% (34.58%–34.62%) | 39.39% | 29.81% / 32.42% | 26.63% |
| All files | TypeScript / JS | 32 | 56.38% | 57.84% | 56.42% (56.38%–56.51%) | 51.57% | 55.70% / 50.36% | 44.16% |
| All files | Overall | 58 | 58.43% | 59.65% | 58.46% (58.43%–58.53%) | 56.41% | 58.24% / 56.52% | 48.87% |
| Without bundles | Go | 25 | 79.11% | 81.10% | 79.11% (79.11%–79.23%) | 76.11% | 84.50% / 81.72% | 70.35% |
| Without bundles | Rust | 19 | 34.57% | 34.59% | 34.60% (34.58%–34.62%) | 39.39% | 29.81% / 32.42% | 26.63% |
| Without bundles | TypeScript / JS | 32 | 57.62% | 59.22% | 57.67% (57.62%–57.77%) | 51.57% | 56.96% / 50.91% | 44.31% |
| Without bundles | Overall | 58 | 58.84% | 60.10% | 58.87% (58.84%–58.94%) | 56.69% | 58.65% / 56.81% | 49.03% |
| Without broken fixtures | Go | 25 | 79.11% | 81.10% | 79.11% (79.11%–79.23%) | 76.11% | 84.50% / 81.72% | 70.35% |
| Without broken fixtures | Rust | 19 | 34.57% | 34.59% | 34.60% (34.58%–34.62%) | 39.39% | 29.81% / 32.42% | 26.63% |
| Without broken fixtures | TypeScript / JS | 32 | 56.38% | 57.84% | 56.42% (56.38%–56.51%) | 51.57% | 55.70% / 50.36% | 44.16% |
| Without broken fixtures | Overall | 58 | 58.43% | 59.65% | 58.46% (58.43%–58.53%) | 56.41% | 58.24% / 56.52% | 48.87% |
| Without templates | Go | 25 | 79.11% | 81.10% | 79.11% (79.11%–79.23%) | 76.11% | 84.50% / 81.72% | 70.35% |
| Without templates | Rust | 19 | 34.57% | 34.59% | 34.60% (34.58%–34.62%) | 39.39% | 29.81% / 32.42% | 26.63% |
| Without templates | TypeScript / JS | 32 | 56.38% | 57.84% | 56.42% (56.38%–56.51%) | 51.57% | 55.70% / 50.36% | 44.16% |
| Without templates | Overall | 58 | 58.43% | 59.65% | 58.46% (58.43%–58.53%) | 56.41% | 58.24% / 56.52% | 48.87% |
| Source only | Go | 25 | 79.11% | 81.10% | 79.11% (79.11%–79.23%) | 76.11% | 84.50% / 81.72% | 70.35% |
| Source only | Rust | 19 | 34.57% | 34.59% | 34.60% (34.58%–34.62%) | 39.39% | 29.81% / 32.42% | 26.63% |
| Source only | TypeScript / JS | 32 | 57.62% | 59.22% | 57.67% (57.62%–57.77%) | 51.57% | 56.96% / 50.91% | 44.31% |
| Source only | Overall | 58 | 58.84% | 60.10% | 58.87% (58.84%–58.94%) | 56.69% | 58.65% / 56.81% | 49.03% |

### Candidate sampling

| Module | Remaining reference sites used | Missed links outside the remaining projection |
| --- | ---: | ---: |
| Go | 293 | 40,495 |
| Rust | 384 | 621,862 |
| TypeScript / JS | 375 | 6,831 |

## What the released store says about outside links

Unit and symbol counts are exact on stored links with proof of outside origin. The final column estimates additional outside sites whose current facts name neither.
The audit recovers these identities from paths, import bindings, named declaring traits or directives. The target-ID slot points to a symbol in a captured file. The released graph has no first-class external target nodes.

| Module | Proven outside | Named unit, including L2 | Unit only | Unit and symbol | Neither, proven outside | Additional outside with neither (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | 334,766 | 214,787 | 39,683 | 175,104 | 119,979 | 122,112 (109,324–137,491) |
| Rust | 170,634 | 127,191 | 420 | 126,771 | 43,443 | 176,992 (157,979–202,296) |
| TypeScript / JS | 328,863 | 217,102 | 23,180 | 193,922 | 111,761 | 343,808 (315,282–387,804) |
| Overall | 834,263 | 559,080 | 63,283 | 495,797 | 275,183 | 642,912 (603,209–706,967) |

### Recorded library identities by encoding

| Module | Encoding | Level 1 only | Level 2 | Example |
| --- | --- | ---: | ---: | --- |
| Go | path | 39,683 | 0 | charmbracelet/bubbletea ` color.go:4 ` ` image/color ` |
| Go | import-binding | 0 | 175,104 | charmbracelet/bubbletea ` color.go:39 ` ` image/color → Color ` |
| Rust | path | 420 | 53,210 | BurntSushi/ripgrep ` build.rs:15 ` ` std → env::var ` |
| Rust | import-binding | 0 | 73,552 | BurntSushi/ripgrep ` crates/cli/src/decompress.rs:29 ` ` std → path::PathBuf ` |
| Rust | explicit-trait | 0 | 9 | DioxusLabs/dioxus ` packages/dx/src/logging.rs:1300 ` ` std → fmt::Display::fmt ` |
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
| Rust | source | 424,983 | 938 | 91,510 | 161,058 | 917,648 | 41 |
| Rust | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | template | 0 | 0 | 0 | 0 | 0 | 10 |
| TypeScript / JS | source | 645,168 | 4,040 | 107,877 | 320,498 | 378,554 | 30,248 |
| TypeScript / JS | bundle | 55,650 | 1 | 25,224 | 5,403 | 44,587 | 8 |
| TypeScript / JS | broken-fixture | 10 | 0 | 2 | 0 | 0 | 50 |
| TypeScript / JS | template | 0 | 0 | 0 | 0 | 0 | 1 |

## Repository results

Totals include every module in a finished checkout. For each attempt, the archive holds the full link breakdown and the explicit inside, outside and unclassified counts for every file scope.

| Repository | Selected language | Outcome | Links | Proven outside | Level 2 | Level 1 | Strict-inside | Raw | Source-only L2 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BurntSushi/ripgrep | Rust | finished | 39,086 | 3,616 | 53.10% | 53.11% | 51.25% | 46.51% | 53.10% |
| DioxusLabs/dioxus | Rust | finished | 149,963 | 24,712 | 37.31% | 37.37% | 30.96% | 25.86% | 37.15% |
| RustCrypto/hashes | Rust | finished | 12,870 | 2,213 | 40.69% | 41.13% | 29.78% | 24.66% | 40.69% |
| actix/actix-web | Rust | finished | 85,053 | 14,371 | 31.02% | 31.05% | 25.88% | 21.50% | 31.02% |
| alacritty/alacritty | Rust | finished | 30,052 | 4,955 | 39.39% | 39.41% | 34.17% | 28.54% | 39.39% |
| cberner/redb | Rust | finished | 73,191 | 2,945 | 39.29% | 39.31% | 36.77% | 35.29% | 39.29% |
| changesets/changesets | TypeScript / JS | finished | 12,646 | 6,292 | 40.49% | 43.11% | 27.73% | 13.93% | 40.49% |
| charmbracelet/bubbletea | Go | finished | 12,533 | 2,460 | 71.84% | 75.78% | 76.91% | 61.81% | 71.84% |
| cilium/ebpf | Go | finished | 50,239 | 11,651 | 77.95% | 80.85% | 86.47% | 66.41% | 77.95% |
| clap-rs/clap | Rust | finished | 50,949 | 3,422 | 32.63% | 32.67% | 29.50% | 27.52% | 32.63% |
| cli/cli | Go | finished | 218,286 | 52,675 | 75.18% | 78.26% | 82.72% | 62.76% | 75.77% |
| cockroachdb/pebble | Go | finished | 214,346 | 35,708 | 76.32% | 78.22% | 84.18% | 70.16% | 78.22% |
| colinhacks/zod | TypeScript / JS | finished | 81,042 | 25,453 | 72.54% | 73.14% | 83.29% | 57.13% | 72.54% |
| crossbeam-rs/crossbeam | Rust | finished | 34,043 | 5,844 | 47.90% | 47.95% | 47.63% | 39.45% | 47.90% |
| dexie/Dexie.js | TypeScript / JS | finished | 36,431 | 3,536 | 38.20% | 39.09% | 38.95% | 35.17% | 41.49% |
| etcd-io/bbolt | Go | finished | 16,898 | 3,955 | 75.78% | 78.78% | 82.61% | 63.27% | 75.78% |
| evanw/esbuild | Go | finished | 118,250 | 11,336 | 87.91% | 88.38% | 91.99% | 83.17% | 87.91% |
| excalidraw/excalidraw | TypeScript / JS | finished | 104,519 | 8,652 | 60.32% | 60.92% | 62.63% | 57.44% | 60.32% |
| fjall-rs/fjall | Rust | finished | 13,275 | 2,896 | 44.54% | 44.57% | 39.47% | 30.86% | 44.54% |
| gin-gonic/gin | Go | finished | 21,081 | 7,016 | 69.70% | 72.02% | 77.50% | 51.71% | 69.70% |
| go-task/task | Go | finished | 18,984 | 4,624 | 74.65% | 78.10% | 81.80% | 61.88% | 74.65% |
| gofiber/fiber | Go | finished | 143,673 | 31,981 | 66.15% | 67.78% | 72.02% | 55.98% | 66.15% |
| golang/tools | Go | finished | 253,517 | 57,579 | 74.14% | 76.95% | 76.52% | 59.14% | 74.79% |
| helix-editor/helix | Rust | finished | 86,285 | 9,627 | 41.75% | 41.77% | 39.42% | 35.02% | 41.75% |
| honojs/hono | TypeScript / JS | finished | 72,340 | 5,111 | 39.54% | 39.76% | 40.33% | 37.48% | 39.54% |
| junegunn/fzf | Go | finished | 25,947 | 3,346 | 77.94% | 79.24% | 82.72% | 72.05% | 77.94% |
| labstack/echo | Go | finished | 31,880 | 10,457 | 74.74% | 77.02% | 80.64% | 54.19% | 74.74% |
| mattn/go-sqlite3 | Go | finished | 9,650 | 2,414 | 55.95% | 58.82% | 50.28% | 37.70% | 55.95% |
| mermaid-js/mermaid | TypeScript / JS | finished | 125,657 | 33,431 | 56.75% | 57.58% | 58.46% | 42.90% | 56.75% |
| microsoft/TypeScript | TypeScript / JS | finished | 485,580 | 51,378 | 85.39% | 86.85% | 90.64% | 81.05% | 85.39% |
| nestjs/nest | TypeScript / JS | finished | 165,330 | 18,516 | 51.89% | 52.89% | 52.74% | 46.84% | 51.89% |
| oclif/core | TypeScript / JS | finished | 14,188 | 4,256 | 65.25% | 66.79% | 71.76% | 50.23% | 65.25% |
| pingdotgg/t3code | TypeScript / JS | finished | 162,711 | 65,155 | 68.23% | 72.17% | 63.80% | 38.25% | 68.23% |
| pmndrs/zustand | TypeScript / JS | finished | 7,099 | 3,101 | 58.09% | 59.26% | 57.40% | 32.33% | 58.09% |
| pocketbase/pocketbase | Go | finished | 197,148 | 18,266 | 56.18% | 57.30% | 56.83% | 51.56% | 70.24% |
| protocolbuffers/protobuf-go | Go | finished | 217,087 | 10,342 | 82.98% | 83.55% | 84.69% | 80.65% | 82.98% |
| puppeteer/puppeteer | TypeScript / JS | finished | 58,244 | 15,750 | 52.53% | 53.92% | 53.10% | 38.74% | 52.53% |
| ratatui/ratatui | Rust | finished | 57,390 | 3,082 | 39.47% | 39.50% | 37.33% | 35.32% | 39.47% |
| react-hook-form/react-hook-form | TypeScript / JS | finished | 49,115 | 11,483 | 48.09% | 48.90% | 37.55% | 28.77% | 48.09% |
| reduxjs/redux-toolkit | TypeScript / JS | finished | 57,208 | 7,003 | 42.61% | 43.51% | 40.58% | 35.61% | 42.61% |
| restic/restic | Go | finished | 64,165 | 13,539 | 79.12% | 82.57% | 83.65% | 66.00% | 79.12% |
| rust-embedded/cortex-m | Rust | finished | 5,200 | 775 | 54.10% | 55.52% | 48.61% | 41.37% | 54.10% |
| rust-lang/mdBook | Rust | finished | 19,753 | 2,558 | 23.63% | 23.66% | 16.67% | 14.51% | 24.49% |
| rustls/rustls | Rust | finished | 69,251 | 6,395 | 26.91% | 26.93% | 22.09% | 20.05% | 26.91% |
| samber/lo | Go | finished | 29,697 | 9,152 | 62.74% | 63.75% | 63.72% | 44.09% | 62.74% |
| serde-rs/serde | Rust | finished | 29,641 | 5,865 | 44.61% | 44.64% | 31.69% | 25.42% | 44.61% |
| spf13/cobra | Go | finished | 8,886 | 1,685 | 78.45% | 80.45% | 79.96% | 64.80% | 78.45% |
| stretchr/testify | Go | finished | 19,868 | 3,977 | 79.22% | 80.33% | 81.72% | 65.36% | 79.22% |
| tauri-apps/tauri | Rust | finished | 91,170 | 15,361 | 37.31% | 37.40% | 31.94% | 26.56% | 37.31% |
| tokio-rs/axum | Rust | finished | 39,950 | 6,985 | 43.44% | 43.46% | 36.32% | 29.97% | 43.44% |
| tree-sitter/tree-sitter | Rust | finished | 58,872 | 6,995 | 39.22% | 39.30% | 35.13% | 30.95% | 39.22% |
| trpc/trpc | TypeScript / JS | finished | 107,470 | 23,196 | 56.63% | 58.47% | 56.22% | 44.08% | 56.63% |
| vercel/turborepo | TypeScript / JS | finished | 673,381 | 52,124 | 29.69% | 29.72% | 25.18% | 23.23% | 29.69% |
| vitejs/vite | TypeScript / JS | finished | 55,575 | 20,043 | 62.17% | 64.50% | 64.12% | 40.99% | 62.17% |
| vitest-dev/vitest | TypeScript / JS | finished | 116,220 | 12,218 | 66.34% | 67.75% | 68.09% | 60.93% | 66.34% |
| wagoodman/dive | Go | finished | 14,901 | 3,790 | 69.10% | 74.34% | 77.50% | 57.79% | 69.10% |
| withastro/astro | TypeScript / JS | finished | 152,561 | 47,881 | 65.50% | 68.51% | 61.26% | 42.04% | 65.50% |
| yargs/yargs | TypeScript / JS | finished | 12,205 | 1,114 | 34.29% | 34.84% | 34.86% | 31.68% | 34.29% |

## Rust failed-file influence

These are exact stored unresolved counts. The eligible column uses the earlier audit disposition. The L2 misses column retains tainted library sites whose symbol is unproved. One site with both failure and receiver reasons belongs to the taint item.

| Repository | Unresolved with failed-file reason | Earlier eligible | L2 misses | Tainted and blocked | Also receiver-unverified | All unresolved marked blocked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DioxusLabs/dioxus | 14,423 | 10,445 | 11,277 | 6,210 | 4,135 | 48,359 |
| alacritty/alacritty | 12,344 | 9,697 | 10,232 | 6,311 | 3,307 | 10,100 |
| clap-rs/clap | 0 | 0 | 0 | 0 | 0 | 17,084 |
| rust-lang/mdBook | 444 | 374 | 382 | 279 | 181 | 4,707 |
| rustls/rustls | 19,950 | 16,800 | 17,854 | 9,038 | 5,655 | 21,265 |
| tauri-apps/tauri | 0 | 0 | 0 | 0 | 0 | 31,306 |
| vercel/turborepo | 300,142 | 266,182 | 269,601 | 169,834 | 121,700 | 289,764 |

## Outside-link review checks

These counts use source evidence from the full primary-module breakdown for the SW-1 review cases. For example, yargs imports its own build output, so `missing-module` on those relative paths remains inside. Unproven package links and return types stay unclassified.

| Repository | Outside / unresolved | Outside / unresolved imports |
| --- | ---: | ---: |
| gin-gonic/gin | 5,750 / 9,629 (59.72%) | 490 / 493 |
| yargs/yargs | 1,114 / 8,339 (13.36%) | 130 / 197 |
| alacritty/alacritty | 4,585 / 21,467 (21.36%) | 870 / 1,503 |
