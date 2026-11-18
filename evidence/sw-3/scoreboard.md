# SW-3 coverage scoreboard

Result package ` pymtheg@0.1.0 `. The baseline covers 60 pinned repositories.

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
| All files | Go | 23 | 77.01% | 79.20% | 77.01% (77.01%–77.17%) | 77.70% | 81.87% / 83.29% | 63.80% |
| All files | Rust | 15 | 33.48% | 33.52% | 33.56% (33.51%–33.60%) | 35.36% | 28.58% / 28.59% | 25.05% |
| All files | TypeScript / JS | 31 | 48.02% | 49.52% | 48.07% (48.02%–48.16%) | 47.57% | 44.91% / 44.13% | 35.47% |
| All files | Overall | 53 | 56.97% | 58.48% | 57.01% (56.97%–57.11%) | 54.29% | 56.04% / 50.61% | 44.91% |
| Without bundles | Go | 23 | 77.01% | 79.20% | 77.01% (77.01%–77.17%) | 77.70% | 81.87% / 83.29% | 63.80% |
| Without bundles | Rust | 15 | 33.48% | 33.52% | 33.56% (33.51%–33.60%) | 35.36% | 28.58% / 28.59% | 25.05% |
| Without bundles | TypeScript / JS | 31 | 51.70% | 53.32% | 51.75% (51.70%–51.85%) | 47.92% | 49.12% / 45.96% | 38.16% |
| Without bundles | Overall | 53 | 58.72% | 60.27% | 58.75% (58.72%–58.85%) | 54.38% | 58.09% / 51.95% | 46.28% |
| Without broken fixtures | Go | 23 | 77.01% | 79.20% | 77.01% (77.01%–77.17%) | 77.70% | 81.87% / 83.29% | 63.80% |
| Without broken fixtures | Rust | 15 | 33.48% | 33.52% | 33.56% (33.51%–33.60%) | 35.36% | 28.58% / 28.59% | 25.05% |
| Without broken fixtures | TypeScript / JS | 31 | 48.02% | 49.52% | 48.07% (48.02%–48.16%) | 47.57% | 44.91% / 44.13% | 35.47% |
| Without broken fixtures | Overall | 53 | 56.97% | 58.48% | 57.01% (56.97%–57.11%) | 54.29% | 56.04% / 50.61% | 44.91% |
| Without templates | Go | 23 | 77.01% | 79.20% | 77.01% (77.01%–77.17%) | 77.70% | 81.87% / 83.29% | 63.80% |
| Without templates | Rust | 15 | 33.48% | 33.52% | 33.56% (33.51%–33.60%) | 35.36% | 28.58% / 28.59% | 25.05% |
| Without templates | TypeScript / JS | 31 | 48.02% | 49.52% | 48.07% (48.02%–48.16%) | 47.57% | 44.91% / 44.13% | 35.47% |
| Without templates | Overall | 53 | 56.97% | 58.48% | 57.01% (56.97%–57.11%) | 54.29% | 56.04% / 50.61% | 44.91% |
| Source only | Go | 23 | 77.01% | 79.20% | 77.01% (77.01%–77.17%) | 77.70% | 81.87% / 83.29% | 63.80% |
| Source only | Rust | 15 | 33.48% | 33.52% | 33.56% (33.51%–33.60%) | 35.36% | 28.58% / 28.59% | 25.05% |
| Source only | TypeScript / JS | 31 | 51.70% | 53.32% | 51.75% (51.70%–51.85%) | 47.92% | 49.12% / 45.96% | 38.16% |
| Source only | Overall | 53 | 58.72% | 60.27% | 58.75% (58.72%–58.85%) | 54.38% | 58.09% / 51.95% | 46.28% |

## What the released store says about outside links

Unit and symbol counts are exact on stored links with proof of outside origin. The final column estimates additional outside sites whose current facts name neither.
The schema can recover these identities from paths, import bindings, typed-receiver spellings or directives. The target-ID slot points to a symbol in a captured file. The released graph has no first-class external target nodes.

| Module | Proven outside | Named unit, including L2 | Unit only | Unit and symbol | Neither, proven outside | Additional outside with neither (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | 327,801 | 228,765 | 32,537 | 196,228 | 99,036 | 78,133 (67,486–89,076) |
| Rust | 83,974 | 57,529 | 276 | 57,253 | 26,445 | 178,395 (159,385–203,708) |
| TypeScript / JS | 324,659 | 217,020 | 23,140 | 193,880 | 107,639 | 347,664 (319,047–391,746) |
| Overall | 736,434 | 503,314 | 55,953 | 447,361 | 233,120 | 604,192 (565,310–665,138) |

### Recorded library identities by encoding

| Module | Encoding | Level 1 only | Level 2 | Example |
| --- | --- | ---: | ---: | --- |
| Go | path | 32,537 | 0 | charmbracelet/bubbletea ` color.go:4 ` ` image/color ` |
| Go | import-binding | 0 | 153,882 | charmbracelet/bubbletea ` color.go:39 ` ` image/color → Color ` |
| Go | typed-receiver | 0 | 42,346 | charmbracelet/bubbletea ` commands_test.go:9 ` ` testing → T.Parallel ` |
| Rust | path | 276 | 23,025 | BurntSushi/ripgrep ` build.rs:15 ` ` std → env::var ` |
| Rust | import-binding | 0 | 32,774 | BurntSushi/ripgrep ` crates/cli/src/decompress.rs:29 ` ` std → path::PathBuf ` |
| Rust | typed-receiver | 0 | 1,454 | BurntSushi/ripgrep ` crates/cli/src/decompress.rs:454 ` ` std → path::Path::metadata ` |
| TypeScript / JS | path | 19,321 | 0 | changesets/changesets ` docs/.vitepress/config.ts:1 ` ` unplugin-icons/vite ` |
| TypeScript / JS | import-binding | 3,808 | 193,880 | changesets/changesets ` docs/.vitepress/config.ts:1 ` ` unplugin-icons/vite → default ` |
| TypeScript / JS | reference-directive | 11 | 0 | dexie/Dexie.js ` samples/dexie-cloud-todo-app/src/sw.ts:1 ` ` typescript/lib/webworker ` |

## Source scopes

Counts include every observed link. Broken and template files that produced no links appear in the failed-source column.

| Module | Scope | Resolved | Ambiguous | Inside | Outside | Unclassified | Failed source files |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | source | 947,551 | 38,470 | 644 | 266,635 | 231,922 | 3 |
| Go | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Go | broken-fixture | 0 | 0 | 0 | 0 | 0 | 14 |
| Go | template | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | source | 170,020 | 781 | 42,730 | 77,829 | 387,408 | 32 |
| Rust | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | template | 0 | 0 | 0 | 0 | 0 | 10 |
| TypeScript / JS | source | 546,513 | 4,274 | 176,994 | 316,416 | 387,807 | 7 |
| TypeScript / JS | bundle | 1,139 | 1 | 61,580 | 5,281 | 44,118 | 0 |
| TypeScript / JS | broken-fixture | 1 | 0 | 11 | 0 | 0 | 11 |
| TypeScript / JS | template | 0 | 0 | 0 | 0 | 0 | 1 |

## Repository results

Totals include every module in a finished checkout. For each attempt, the archive holds the full link breakdown and the explicit inside, outside and unclassified counts for every file scope.

| Repository | Selected language | Outcome | Links | Proven outside | Level 2 | Level 1 | Strict-inside | Raw | Source-only L2 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BurntSushi/ripgrep | Rust | finished | 39,086 | 3,716 | 41.91% | 41.93% | 38.79% | 35.10% | 41.91% |
| RustCrypto/hashes | Rust | finished | 12,870 | 2,214 | 40.70% | 41.14% | 29.79% | 24.66% | 40.70% |
| actix/actix-web | Rust | finished | 85,053 | 14,455 | 31.12% | 31.14% | 25.91% | 21.50% | 31.12% |
| alacritty/alacritty | Rust | finished | 30,052 | 5,012 | 39.58% | 39.60% | 34.25% | 28.54% | 39.58% |
| cberner/redb | Rust | finished | 73,191 | 2,975 | 29.09% | 29.10% | 26.11% | 25.04% | 29.09% |
| changesets/changesets | TypeScript / JS | finished | 12,609 | 3,717 | 39.87% | 42.50% | 18.77% | 13.24% | 39.87% |
| charmbracelet/bubbletea | Go | finished | 12,498 | 2,875 | 74.63% | 78.57% | 79.65% | 61.33% | 74.63% |
| cilium/ebpf | Go | finished | 49,614 | 13,250 | 79.37% | 82.31% | 88.08% | 64.56% | 79.37% |
| clap-rs/clap | Rust | finished | 50,949 | 3,529 | 27.17% | 27.21% | 23.48% | 21.85% | 27.17% |
| cli/cli | Go | finished | 207,303 | 57,204 | 70.64% | 73.89% | 76.62% | 55.48% | 71.41% |
| cockroachdb/pebble | Go | finished | 210,500 | 38,664 | 72.93% | 74.87% | 79.95% | 65.26% | 76.38% |
| colinhacks/zod | TypeScript / JS | finished | 80,462 | 25,453 | 71.00% | 71.61% | 81.15% | 55.48% | 71.00% |
| crossbeam-rs/crossbeam | Rust | finished | 34,043 | 5,848 | 31.30% | 31.36% | 27.59% | 22.85% | 31.30% |
| dexie/Dexie.js | TypeScript / JS | finished | 35,874 | 3,535 | 34.91% | 35.82% | 35.32% | 31.84% | 38.13% |
| etcd-io/bbolt | Go | finished | 16,741 | 5,079 | 80.05% | 83.08% | 87.18% | 60.73% | 80.05% |
| evanw/esbuild | Go | finished | 116,564 | 11,958 | 87.05% | 87.53% | 91.05% | 81.71% | 87.05% |
| excalidraw/excalidraw | TypeScript / JS | finished | 103,386 | 8,652 | 57.79% | 58.40% | 59.90% | 54.89% | 57.79% |
| fjall-rs/fjall | Rust | finished | 13,275 | 2,905 | 36.06% | 36.09% | 28.56% | 22.31% | 36.06% |
| gin-gonic/gin | Go | finished | 20,364 | 7,801 | 69.04% | 71.45% | 79.35% | 48.95% | 69.04% |
| go-task/task | Go | finished | 18,445 | 5,504 | 76.78% | 80.33% | 84.33% | 59.17% | 76.78% |
| gofiber/fiber | Go | finished | 139,671 | 40,908 | 68.20% | 69.88% | 72.96% | 51.59% | 68.20% |
| golang/tools | Go | finished | 251,402 | 63,952 | 75.25% | 78.09% | 77.30% | 57.64% | 75.98% |
| helix-editor/helix | Rust | finished | 86,281 | 9,777 | 33.40% | 33.42% | 29.89% | 26.50% | 33.40% |
| honojs/hono | TypeScript / JS | finished | 70,761 | 5,125 | 36.00% | 36.22% | 36.54% | 33.89% | 36.00% |
| junegunn/fzf | Go | finished | 25,820 | 3,879 | 78.76% | 80.07% | 83.29% | 70.78% | 78.76% |
| labstack/echo | Go | finished | 30,180 | 11,700 | 70.07% | 72.47% | 75.32% | 46.12% | 70.07% |
| mattn/go-sqlite3 | Go | finished | 9,598 | 3,459 | 64.09% | 66.97% | 55.04% | 35.21% | 64.09% |
| mermaid-js/mermaid | TypeScript / JS | finished | 124,766 | 33,430 | 54.56% | 55.39% | 55.47% | 40.61% | 54.56% |
| nestjs/nest | TypeScript / JS | finished | 161,185 | 17,900 | 47.92% | 48.94% | 48.07% | 42.73% | 47.92% |
| oclif/core | TypeScript / JS | finished | 14,031 | 4,256 | 63.11% | 64.67% | 68.80% | 47.93% | 63.11% |
| pingdotgg/t3code | TypeScript / JS | finished | 161,530 | 65,152 | 67.21% | 71.18% | 62.04% | 37.02% | 67.21% |
| pmndrs/zustand | TypeScript / JS | finished | 6,821 | 3,101 | 54.38% | 55.59% | 50.54% | 27.56% | 54.38% |
| pocketbase/pocketbase | Go | finished | 180,199 | 22,582 | 34.46% | 35.68% | 30.93% | 27.06% | 70.91% |
| protocolbuffers/protobuf-go | Go | finished | 216,552 | 12,269 | 82.49% | 83.06% | 84.06% | 79.30% | 82.49% |
| puppeteer/puppeteer | TypeScript / JS | finished | 57,957 | 15,711 | 50.75% | 52.15% | 50.61% | 36.89% | 50.75% |
| ratatui/ratatui | Rust | finished | 57,390 | 3,195 | 31.54% | 31.56% | 28.80% | 27.19% | 31.54% |
| react-hook-form/react-hook-form | TypeScript / JS | finished | 46,333 | 11,483 | 41.14% | 42.00% | 27.47% | 20.66% | 41.14% |
| reduxjs/redux-toolkit | TypeScript / JS | finished | 55,912 | 6,872 | 39.34% | 40.27% | 36.69% | 32.18% | 39.34% |
| restic/restic | Go | finished | 63,408 | 15,248 | 79.11% | 82.61% | 83.30% | 63.26% | 79.11% |
| rust-embedded/cortex-m | Rust | finished | 5,200 | 785 | 54.29% | 55.71% | 48.72% | 41.37% | 54.29% |
| rust-lang/mdBook | Rust | finished | 19,753 | 2,592 | 23.80% | 23.83% | 16.70% | 14.51% | 24.67% |
| samber/lo | Go | finished | 27,801 | 12,565 | 66.91% | 67.99% | 63.31% | 34.70% | 66.91% |
| spf13/cobra | Go | finished | 8,792 | 2,404 | 84.93% | 86.95% | 86.91% | 63.15% | 84.93% |
| stretchr/testify | Go | finished | 19,521 | 5,057 | 81.54% | 82.67% | 84.44% | 62.56% | 81.54% |
| tauri-apps/tauri | Rust | finished | 91,170 | 15,904 | 37.90% | 37.99% | 32.17% | 26.56% | 37.90% |
| tokio-rs/axum | Rust | finished | 39,950 | 7,052 | 35.34% | 35.36% | 26.36% | 21.71% | 35.34% |
| tree-sitter/tree-sitter | Rust | finished | 58,825 | 7,157 | 33.88% | 33.95% | 28.84% | 25.33% | 33.88% |
| trpc/trpc | TypeScript / JS | finished | 105,855 | 23,191 | 53.31% | 55.17% | 51.95% | 40.56% | 53.31% |
| vitejs/vite | TypeScript / JS | finished | 55,027 | 20,041 | 59.87% | 62.23% | 60.53% | 38.48% | 59.87% |
| vitest-dev/vitest | TypeScript / JS | finished | 115,331 | 12,217 | 36.13% | 37.55% | 34.31% | 30.68% | 36.13% |
| wagoodman/dive | Go | finished | 14,691 | 4,215 | 70.21% | 75.53% | 78.43% | 55.93% | 70.21% |
| withastro/astro | TypeScript / JS | finished | 151,382 | 47,799 | 52.89% | 55.93% | 42.75% | 29.25% | 52.89% |
| yargs/yargs | TypeScript / JS | finished | 12,151 | 1,110 | 33.41% | 33.96% | 33.88% | 30.79% | 33.41% |

## Rust failed-file influence

These are exact stored unresolved counts. The eligible column uses the earlier audit disposition. The L2 misses column retains tainted library sites whose symbol is unproved. One site with both failure and receiver reasons belongs to the taint item.

| Repository | Unresolved with failed-file reason | Earlier eligible | L2 misses | Tainted and blocked | Also receiver-unverified | All unresolved marked blocked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| alacritty/alacritty | 12,344 | 9,697 | 10,191 | 6,311 | 3,307 | 10,100 |
| clap-rs/clap | 0 | 0 | 0 | 0 | 0 | 19,973 |
| rust-lang/mdBook | 444 | 374 | 381 | 279 | 181 | 4,707 |
| tauri-apps/tauri | 0 | 0 | 0 | 0 | 0 | 31,306 |

## Outside-link review checks

These counts use source evidence from the full primary-module breakdown for the SW-1 review cases. For example, yargs imports its own build output, so `missing-module` on those relative paths remains inside. Unproven package links and return types stay unclassified.

| Repository | Outside / unresolved | Outside / unresolved imports |
| --- | ---: | ---: |
| gin-gonic/gin | 6,535 / 9,835 (66.45%) | 490 / 493 |
| yargs/yargs | 1,110 / 8,410 (13.20%) | 130 / 197 |
| alacritty/alacritty | 4,585 / 21,467 (21.36%) | 870 / 1,503 |
