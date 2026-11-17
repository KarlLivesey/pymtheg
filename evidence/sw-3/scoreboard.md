# SW-3 coverage scoreboard

Result package ` pymtheg@0.1.0 `. The baseline covers 60 pinned repositories.

## A. All 60 finish

**53 of 60 finished.**

- [ ] DioxusLabs/dioxus · Rust analysis stalled at the wall limit · open
- [ ] embassy-rs/embassy · Rust analysis stalled at the wall limit · open
- [ ] microsoft/TypeScript · Node heap exhausted · open
- [ ] rustls/rustls · Rust resolution stalled at the wall limit · open
- [ ] serde-rs/serde · Rust analysis stalled at the wall limit · open
- [ ] swc-project/swc · Rust analysis stalled at the wall limit · open
- [ ] vercel/turborepo · Node heap exhausted · open

## B. Coverage of finished graphs

Raw counts every link. Strict removes proved outside unresolved links. Estimated-true also removes sampled outside links and keeps cannot-tell links in the denominator.
Language rates use each module's links across the finished checkouts. The interval reflects sampling uncertainty. Candidate rates reuse the reference sample and can be less representative as the graphs change.

| Files counted | Module | Graphs with links | Raw weighted | Strict weighted | Strict median | Estimated-true weighted (95% interval) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| All files | Go | 23 | 63.80% | 77.75% | 77.93% | 87.92% (86.95%–88.86%) |
| All files | Rust | 15 | 25.05% | 28.29% | 28.15% | 39.27% (37.58%–41.21%) |
| All files | TypeScript / JS | 31 | 35.47% | 44.80% | 44.13% | 61.49% (59.38%–63.76%) |
| All files | Overall | 53 | 44.91% | 54.74% | 50.54% | 69.34% (68.22%–70.51%) |
| Without bundles | Go | 23 | 63.80% | 77.75% | 77.93% | 87.92% (86.95%–88.86%) |
| Without bundles | Rust | 15 | 25.05% | 28.29% | 28.15% | 39.27% (37.58%–41.21%) |
| Without bundles | TypeScript / JS | 31 | 38.05% | 48.82% | 45.08% | 68.98% (66.52%–71.55%) |
| Without bundles | Overall | 53 | 46.22% | 56.62% | 51.03% | 72.26% (71.09%–73.46%) |
| Without broken fixtures | Go | 23 | 63.80% | 77.75% | 77.93% | 87.92% (86.95%–88.86%) |
| Without broken fixtures | Rust | 15 | 25.05% | 28.29% | 28.15% | 39.27% (37.58%–41.21%) |
| Without broken fixtures | TypeScript / JS | 31 | 35.47% | 44.80% | 44.13% | 61.49% (59.38%–63.76%) |
| Without broken fixtures | Overall | 53 | 44.91% | 54.74% | 50.54% | 69.34% (68.22%–70.51%) |
| Without templates | Go | 23 | 63.80% | 77.75% | 77.93% | 87.92% (86.95%–88.86%) |
| Without templates | Rust | 15 | 25.05% | 28.29% | 28.15% | 39.27% (37.58%–41.21%) |
| Without templates | TypeScript / JS | 31 | 35.47% | 44.80% | 44.13% | 61.49% (59.38%–63.76%) |
| Without templates | Overall | 53 | 44.91% | 54.74% | 50.54% | 69.34% (68.22%–70.51%) |
| Source only | Go | 23 | 63.80% | 77.75% | 77.93% | 87.92% (86.95%–88.86%) |
| Source only | Rust | 15 | 25.05% | 28.29% | 28.15% | 39.27% (37.58%–41.21%) |
| Source only | TypeScript / JS | 31 | 38.05% | 48.82% | 45.08% | 68.99% (66.53%–71.55%) |
| Source only | Overall | 53 | 46.22% | 56.62% | 51.03% | 72.26% (71.09%–73.46%) |

## Source scopes

Counts include every observed link. Broken and template files that produced no links appear in the failed-source column.

| Module | Scope | Resolved | Ambiguous | Inside | Outside | Unclassified | Failed source files |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | source | 947,503 | 38,500 | 644 | 266,635 | 231,940 | 3 |
| Go | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Go | broken-fixture | 0 | 0 | 0 | 0 | 0 | 14 |
| Go | template | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | source | 170,020 | 781 | 42,732 | 77,829 | 387,406 | 32 |
| Rust | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | template | 0 | 0 | 0 | 0 | 0 | 10 |
| TypeScript / JS | source | 546,516 | 4,274 | 179,612 | 316,729 | 389,109 | 7 |
| TypeScript / JS | bundle | 1,136 | 1 | 60,055 | 4,968 | 41,723 | 0 |
| TypeScript / JS | broken-fixture | 1 | 0 | 11 | 0 | 0 | 11 |
| TypeScript / JS | template | 0 | 0 | 0 | 0 | 0 | 1 |

## Repository results

Rows include every module in a finished checkout. For each attempt, the archive holds the full link breakdown and the explicit inside, outside and unclassified counts for every file scope.

| Repository | Selected language | Outcome | Links | Outside | Unclassified | All raw / adjusted | Source only raw / adjusted |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| BurntSushi/ripgrep | Rust | finished | 39,086 | 3,354 | 21,079 | 35.10% / 38.39% | 35.10% / 38.39% |
| RustCrypto/hashes | Rust | finished | 12,870 | 1,986 | 7,367 | 24.66% / 29.16% | 24.66% / 29.16% |
| actix/actix-web | Rust | finished | 85,053 | 13,611 | 48,013 | 21.50% / 25.60% | 21.50% / 25.60% |
| alacritty/alacritty | Rust | finished | 30,052 | 4,585 | 14,710 | 28.54% / 33.67% | 28.54% / 33.67% |
| cberner/redb | Rust | finished | 73,191 | 2,785 | 49,862 | 25.04% / 26.03% | 25.04% / 26.03% |
| changesets/changesets | TypeScript / JS | finished | 12,609 | 3,713 | 4,373 | 13.24% / 18.76% | 13.24% / 18.76% |
| charmbracelet/bubbletea | Go | finished | 12,498 | 2,504 | 2,302 | 61.33% / 76.70% | 61.33% / 76.70% |
| cilium/ebpf | Go | finished | 49,614 | 11,728 | 4,086 | 64.56% / 84.54% | 64.56% / 84.54% |
| clap-rs/clap | Rust | finished | 50,949 | 3,218 | 31,118 | 21.85% / 23.32% | 21.85% / 23.32% |
| cli/cli | Go | finished | 207,303 | 47,309 | 41,208 | 55.48% / 71.88% | 56.08% / 72.77% |
| cockroachdb/pebble | Go | finished | 210,500 | 34,542 | 30,282 | 65.30% / 78.12% | 68.39% / 81.90% |
| colinhacks/zod | TypeScript / JS | finished | 80,462 | 25,446 | 3,572 | 55.48% / 81.14% | 55.48% / 81.14% |
| crossbeam-rs/crossbeam | Rust | finished | 34,043 | 5,623 | 18,556 | 22.85% / 27.37% | 22.85% / 27.37% |
| dexie/Dexie.js | TypeScript / JS | finished | 35,874 | 3,531 | 14,172 | 31.84% / 35.31% | 34.77% / 38.77% |
| etcd-io/bbolt | Go | finished | 16,741 | 4,554 | 1,626 | 60.73% / 83.42% | 60.73% / 83.42% |
| evanw/esbuild | Go | finished | 116,564 | 10,236 | 9,050 | 81.71% / 89.58% | 81.71% / 89.58% |
| excalidraw/excalidraw | TypeScript / JS | finished | 103,386 | 8,645 | 30,334 | 54.89% / 59.90% | 54.89% / 59.90% |
| fjall-rs/fjall | Rust | finished | 13,275 | 2,744 | 6,877 | 22.31% / 28.13% | 22.31% / 28.13% |
| gin-gonic/gin | Go | finished | 20,364 | 6,535 | 3,297 | 48.95% / 72.09% | 48.95% / 72.09% |
| go-task/task | Go | finished | 18,445 | 4,670 | 2,758 | 59.17% / 79.22% | 59.17% / 79.22% |
| gofiber/fiber | Go | finished | 139,671 | 32,756 | 29,792 | 51.58% / 67.38% | 51.58% / 67.38% |
| golang/tools | Go | finished | 251,402 | 46,715 | 57,559 | 57.59% / 70.74% | 57.59% / 70.74% |
| helix-editor/helix | Rust | finished | 86,281 | 9,215 | 48,010 | 26.50% / 29.67% | 26.50% / 29.67% |
| honojs/hono | TypeScript / JS | finished | 70,761 | 5,125 | 28,508 | 33.89% / 36.54% | 33.89% / 36.54% |
| junegunn/fzf | Go | finished | 25,820 | 3,538 | 3,356 | 70.78% / 82.02% | 70.78% / 82.02% |
| labstack/echo | Go | finished | 30,180 | 9,657 | 6,432 | 46.12% / 67.83% | 46.12% / 67.83% |
| mattn/go-sqlite3 | Go | finished | 9,598 | 2,977 | 2,865 | 35.21% / 51.03% | 35.21% / 51.03% |
| mermaid-js/mermaid | TypeScript / JS | finished | 124,766 | 33,428 | 35,507 | 40.61% / 55.47% | 40.61% / 55.47% |
| nestjs/nest | TypeScript / JS | finished | 161,185 | 17,869 | 65,388 | 42.73% / 48.06% | 42.73% / 48.06% |
| oclif/core | TypeScript / JS | finished | 14,031 | 4,255 | 2,242 | 47.93% / 68.79% | 47.93% / 68.79% |
| pingdotgg/t3code | TypeScript / JS | finished | 161,530 | 63,117 | 28,658 | 37.02% / 60.76% | 37.02% / 60.76% |
| pmndrs/zustand | TypeScript / JS | finished | 6,821 | 3,101 | 361 | 27.56% / 50.54% | 27.56% / 50.54% |
| pocketbase/pocketbase | Go | finished | 180,199 | 19,517 | 55,747 | 27.06% / 30.34% | 54.24% / 66.76% |
| protocolbuffers/protobuf-go | Go | finished | 216,552 | 11,210 | 14,983 | 79.30% / 83.63% | 79.30% / 83.63% |
| puppeteer/puppeteer | TypeScript / JS | finished | 57,957 | 15,273 | 17,532 | 36.89% / 50.09% | 36.89% / 50.09% |
| ratatui/ratatui | Rust | finished | 57,390 | 2,814 | 31,242 | 27.19% / 28.59% | 27.19% / 28.59% |
| react-hook-form/react-hook-form | TypeScript / JS | finished | 46,333 | 11,483 | 17,151 | 20.66% / 27.47% | 20.66% / 27.47% |
| reduxjs/redux-toolkit | TypeScript / JS | finished | 55,912 | 6,859 | 19,436 | 32.18% / 36.68% | 32.18% / 36.68% |
| restic/restic | Go | finished | 63,408 | 11,965 | 9,840 | 63.26% / 77.98% | 63.26% / 77.98% |
| rust-embedded/cortex-m | Rust | finished | 5,200 | 719 | 1,962 | 41.37% / 48.00% | 41.37% / 48.00% |
| rust-lang/mdBook | Rust | finished | 19,753 | 2,349 | 12,453 | 14.51% / 16.47% | 15.04% / 17.06% |
| samber/lo | Go | finished | 27,801 | 9,594 | 8,499 | 34.70% / 52.98% | 34.70% / 52.98% |
| spf13/cobra | Go | finished | 8,792 | 1,906 | 1,332 | 63.15% / 80.63% | 63.15% / 80.63% |
| stretchr/testify | Go | finished | 19,521 | 3,849 | 3,241 | 62.56% / 77.93% | 62.56% / 77.93% |
| tauri-apps/tauri | Rust | finished | 91,170 | 14,809 | 47,644 | 26.56% / 31.71% | 26.56% / 31.71% |
| tokio-rs/axum | Rust | finished | 39,950 | 6,438 | 21,040 | 21.71% / 25.88% | 21.71% / 25.88% |
| tree-sitter/tree-sitter | Rust | finished | 58,825 | 6,719 | 34,213 | 25.33% / 28.60% | 25.33% / 28.60% |
| trpc/trpc | TypeScript / JS | finished | 105,855 | 23,019 | 26,760 | 40.56% / 51.84% | 40.56% / 51.84% |
| vitejs/vite | TypeScript / JS | finished | 55,027 | 19,955 | 10,160 | 38.48% / 60.38% | 38.48% / 60.38% |
| vitest-dev/vitest | TypeScript / JS | finished | 115,331 | 12,197 | 19,850 | 30.68% / 34.30% | 30.68% / 34.31% |
| wagoodman/dive | Go | finished | 14,691 | 3,639 | 2,789 | 55.93% / 74.34% | 55.93% / 74.34% |
| withastro/astro | TypeScript / JS | finished | 151,382 | 47,665 | 34,237 | 29.25% / 42.69% | 29.25% / 42.69% |
| yargs/yargs | TypeScript / JS | finished | 12,151 | 1,110 | 6,747 | 30.79% / 33.88% | 30.79% / 33.88% |

## Rust failed-file influence

These are exact stored unresolved counts. The eligible column excludes proved outside targets. The blocked and receiver columns count the stored flags. The receiver count covers tainted links. A row with both failure and receiver reasons belongs to the taint support item only.

| Repository | Unresolved with failed-file reason | Eligible | Tainted and blocked | Also receiver-unverified | All unresolved marked blocked |
| --- | ---: | ---: | ---: | ---: | ---: |
| alacritty/alacritty | 12,344 | 9,697 | 6,311 | 3,307 | 10,100 |
| clap-rs/clap | 0 | 0 | 0 | 0 | 19,973 |
| rust-lang/mdBook | 444 | 374 | 279 | 181 | 4,707 |
| tauri-apps/tauri | 0 | 0 | 0 | 0 | 31,306 |

## Outside-link review checks

These counts use source evidence from the full primary-module breakdown for the SW-1 review cases. For example, yargs imports its own build output, so `missing-module` on those relative paths remains inside. Unproven package links and return types stay unclassified.

| Repository | Outside / unresolved | Outside / unresolved imports |
| --- | ---: | ---: |
| gin-gonic/gin | 6,535 / 9,835 (66.45%) | 490 / 493 |
| yargs/yargs | 1,110 / 8,410 (13.20%) | 130 / 197 |
| alacritty/alacritty | 4,585 / 21,467 (21.36%) | 870 / 1,503 |
