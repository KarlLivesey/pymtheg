# SW-3 coverage scoreboard

Result package ` pymtheg@0.1.0 `. Candidate records replace 43 matching baseline pins.

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
| All files | Go | 25 | 79.65% | 81.63% | 79.65% (79.65%–79.77%) | 76.54% | 85.15% / 81.91% | 70.89% |
| All files | Rust | 19 | 31.90% | 31.92% | 31.94% (31.91%–31.96%) | 35.20% | 26.82% / 27.39% | 23.96% |
| All files | TypeScript / JS | 32 | 58.49% | 59.95% | 58.53% (58.49%–58.61%) | 51.92% | 58.19% / 52.59% | 46.27% |
| All files | Overall | 58 | 58.46% | 59.68% | 58.49% (58.46%–58.56%) | 56.94% | 58.23% / 58.19% | 48.90% |
| Without bundles | Go | 25 | 79.65% | 81.63% | 79.65% (79.65%–79.77%) | 76.54% | 85.15% / 81.91% | 70.89% |
| Without bundles | Rust | 19 | 31.90% | 31.92% | 31.94% (31.91%–31.96%) | 35.20% | 26.82% / 27.39% | 23.96% |
| Without bundles | TypeScript / JS | 32 | 59.84% | 61.43% | 59.89% (59.84%–59.98%) | 51.92% | 59.61% / 52.59% | 46.52% |
| Without bundles | Overall | 58 | 58.85% | 60.10% | 58.88% (58.85%–58.95%) | 59.27% | 58.61% / 59.86% | 49.04% |
| Without broken fixtures | Go | 25 | 79.65% | 81.63% | 79.65% (79.65%–79.77%) | 76.54% | 85.15% / 81.91% | 70.89% |
| Without broken fixtures | Rust | 19 | 31.90% | 31.92% | 31.94% (31.91%–31.96%) | 35.20% | 26.82% / 27.39% | 23.96% |
| Without broken fixtures | TypeScript / JS | 32 | 58.49% | 59.95% | 58.53% (58.49%–58.61%) | 51.92% | 58.19% / 52.59% | 46.27% |
| Without broken fixtures | Overall | 58 | 58.46% | 59.68% | 58.49% (58.46%–58.56%) | 56.94% | 58.23% / 58.19% | 48.90% |
| Without templates | Go | 25 | 79.65% | 81.63% | 79.65% (79.65%–79.77%) | 76.54% | 85.15% / 81.91% | 70.89% |
| Without templates | Rust | 19 | 31.90% | 31.92% | 31.94% (31.91%–31.96%) | 35.20% | 26.82% / 27.39% | 23.96% |
| Without templates | TypeScript / JS | 32 | 58.49% | 59.95% | 58.53% (58.49%–58.61%) | 51.92% | 58.19% / 52.59% | 46.27% |
| Without templates | Overall | 58 | 58.46% | 59.68% | 58.49% (58.46%–58.56%) | 56.94% | 58.23% / 58.19% | 48.90% |
| Source only | Go | 25 | 79.65% | 81.63% | 79.65% (79.65%–79.77%) | 76.54% | 85.15% / 81.91% | 70.89% |
| Source only | Rust | 19 | 31.90% | 31.92% | 31.94% (31.91%–31.96%) | 35.20% | 26.82% / 27.39% | 23.96% |
| Source only | TypeScript / JS | 32 | 59.84% | 61.43% | 59.88% (59.84%–59.98%) | 51.92% | 59.61% / 52.59% | 46.52% |
| Source only | Overall | 58 | 58.85% | 60.10% | 58.88% (58.85%–58.95%) | 59.27% | 58.61% / 59.86% | 49.04% |

### Candidate sampling

| Module | Remaining reference sites used | Missed links outside the remaining projection |
| --- | ---: | ---: |
| Go | 274 | 38,810 |
| Rust | 430 | 152,137 |
| TypeScript / JS | 347 | 58,212 |

## What the released store says about outside links

Unit and symbol counts are exact on stored links with proof of outside origin. The final column estimates additional outside sites whose current facts name neither.
The audit recovers these identities from paths, import bindings, named declaring traits or directives. The target-ID slot points to a symbol in a captured file. The released graph has no first-class external target nodes.

| Module | Proven outside | Named unit, including L2 | Unit only | Unit and symbol | Neither, proven outside | Additional outside with neither (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | 334,766 | 214,787 | 39,683 | 175,104 | 119,979 | 122,818 (109,956–138,941) |
| Rust | 170,634 | 127,191 | 420 | 126,771 | 43,443 | 429,561 (338,178–531,437) |
| TypeScript / JS | 325,030 | 217,102 | 23,180 | 193,922 | 107,928 | 339,421 (310,983–371,078) |
| Overall | 830,430 | 559,080 | 63,283 | 495,797 | 271,350 | 891,800 (786,938–1,013,637) |

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
| Go | source | 1,417,384 | 40,348 | 1,534 | 263,047 | 277,063 | 3 |
| Go | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Go | broken-fixture | 13 | 0 | 0 | 2 | 6 | 14 |
| Go | template | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | source | 382,374 | 938 | 91,510 | 161,058 | 960,257 | 41 |
| Rust | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | template | 0 | 0 | 0 | 0 | 0 | 10 |
| TypeScript / JS | source | 677,384 | 4,042 | 75,033 | 316,676 | 382,955 | 30,248 |
| TypeScript / JS | bundle | 56,882 | 1 | 22,785 | 5,392 | 45,805 | 8 |
| TypeScript / JS | broken-fixture | 10 | 0 | 2 | 0 | 0 | 50 |
| TypeScript / JS | template | 0 | 0 | 0 | 0 | 0 | 1 |

## Repository results

Totals include every module in a finished checkout. For each attempt, the archive holds the full link breakdown and the explicit inside, outside and unclassified counts for every file scope.

| Repository | Selected language | Outcome | Links | Proven outside | Level 2 | Level 1 | Strict-inside | Raw | Source-only L2 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BurntSushi/ripgrep | Rust | finished | 39,086 | 3,616 | 41.68% | 41.70% | 38.68% | 35.10% | 41.68% |
| DioxusLabs/dioxus | Rust | finished | 149,963 | 24,712 | 37.31% | 37.37% | 30.96% | 25.86% | 37.15% |
| RustCrypto/hashes | Rust | finished | 12,870 | 2,213 | 40.69% | 41.13% | 29.78% | 24.66% | 40.69% |
| actix/actix-web | Rust | finished | 85,053 | 14,371 | 31.02% | 31.05% | 25.88% | 21.50% | 31.02% |
| alacritty/alacritty | Rust | finished | 30,052 | 4,955 | 39.39% | 39.41% | 34.17% | 28.54% | 39.39% |
| cberner/redb | Rust | finished | 73,191 | 2,945 | 29.04% | 29.06% | 26.09% | 25.04% | 29.04% |
| changesets/changesets | TypeScript / JS | finished | 12,646 | 6,292 | 40.87% | 43.49% | 28.49% | 14.31% | 40.87% |
| charmbracelet/bubbletea | Go | finished | 12,533 | 2,460 | 71.84% | 75.78% | 76.91% | 61.81% | 71.84% |
| cilium/ebpf | Go | finished | 50,239 | 11,651 | 78.14% | 81.04% | 86.71% | 66.60% | 78.14% |
| clap-rs/clap | Rust | finished | 50,949 | 3,422 | 26.96% | 27.00% | 23.42% | 21.85% | 26.96% |
| cli/cli | Go | finished | 218,286 | 52,675 | 75.60% | 78.69% | 83.28% | 63.18% | 76.20% |
| cockroachdb/pebble | Go | finished | 214,346 | 35,708 | 76.41% | 78.32% | 84.30% | 70.25% | 78.32% |
| colinhacks/zod | TypeScript / JS | finished | 81,042 | 25,453 | 76.77% | 77.37% | 89.45% | 61.36% | 76.77% |
| crossbeam-rs/crossbeam | Rust | finished | 34,043 | 5,844 | 31.29% | 31.35% | 27.58% | 22.85% | 31.29% |
| dexie/Dexie.js | TypeScript / JS | finished | 36,431 | 3,123 | 41.68% | 42.57% | 42.28% | 38.65% | 45.29% |
| etcd-io/bbolt | Go | finished | 16,898 | 3,955 | 76.12% | 79.12% | 83.06% | 63.62% | 76.12% |
| evanw/esbuild | Go | finished | 118,250 | 11,336 | 87.96% | 88.43% | 92.04% | 83.22% | 87.96% |
| excalidraw/excalidraw | TypeScript / JS | finished | 104,519 | 8,652 | 61.55% | 62.15% | 63.97% | 58.68% | 61.55% |
| fjall-rs/fjall | Rust | finished | 13,275 | 2,896 | 35.99% | 36.02% | 28.54% | 22.31% | 35.99% |
| gin-gonic/gin | Go | finished | 21,081 | 7,016 | 69.92% | 72.25% | 77.84% | 51.93% | 69.92% |
| go-task/task | Go | finished | 18,984 | 4,624 | 74.65% | 78.10% | 81.80% | 61.88% | 74.65% |
| gofiber/fiber | Go | finished | 143,673 | 31,981 | 66.17% | 67.80% | 72.04% | 56.00% | 66.17% |
| golang/tools | Go | finished | 253,517 | 57,579 | 76.15% | 78.96% | 79.12% | 61.15% | 76.81% |
| helix-editor/helix | Rust | finished | 86,281 | 9,627 | 33.23% | 33.25% | 29.83% | 26.50% | 33.23% |
| honojs/hono | TypeScript / JS | finished | 72,340 | 5,111 | 49.91% | 50.13% | 51.49% | 47.85% | 49.91% |
| junegunn/fzf | Go | finished | 25,947 | 3,346 | 77.94% | 79.24% | 82.72% | 72.05% | 77.94% |
| labstack/echo | Go | finished | 31,880 | 10,457 | 74.75% | 77.02% | 80.64% | 54.19% | 74.75% |
| mattn/go-sqlite3 | Go | finished | 9,650 | 2,414 | 56.00% | 58.87% | 50.35% | 37.75% | 56.00% |
| mermaid-js/mermaid | TypeScript / JS | finished | 125,657 | 33,431 | 56.99% | 57.82% | 58.78% | 43.14% | 56.99% |
| microsoft/TypeScript | TypeScript / JS | finished | 485,580 | 51,378 | 85.39% | 86.85% | 90.64% | 81.05% | 85.39% |
| nestjs/nest | TypeScript / JS | finished | 165,330 | 17,987 | 52.91% | 53.90% | 53.69% | 47.85% | 52.91% |
| oclif/core | TypeScript / JS | finished | 14,188 | 4,256 | 67.84% | 69.38% | 75.46% | 52.83% | 67.84% |
| pingdotgg/t3code | TypeScript / JS | finished | 162,711 | 65,155 | 68.99% | 72.93% | 65.07% | 39.01% | 68.99% |
| pmndrs/zustand | TypeScript / JS | finished | 7,099 | 3,101 | 64.15% | 65.32% | 68.16% | 38.39% | 64.15% |
| pocketbase/pocketbase | Go | finished | 197,148 | 18,266 | 56.88% | 58.00% | 57.59% | 52.26% | 70.41% |
| protocolbuffers/protobuf-go | Go | finished | 217,087 | 10,342 | 84.87% | 85.43% | 86.67% | 82.54% | 84.87% |
| puppeteer/puppeteer | TypeScript / JS | finished | 58,244 | 15,750 | 53.97% | 55.36% | 55.07% | 40.18% | 53.97% |
| ratatui/ratatui | Rust | finished | 57,390 | 3,082 | 31.34% | 31.37% | 28.74% | 27.19% | 31.34% |
| react-hook-form/react-hook-form | TypeScript / JS | finished | 49,115 | 11,483 | 50.67% | 51.47% | 40.91% | 31.34% | 50.67% |
| reduxjs/redux-toolkit | TypeScript / JS | finished | 57,208 | 6,887 | 48.94% | 49.84% | 47.68% | 41.94% | 48.94% |
| restic/restic | Go | finished | 64,165 | 13,539 | 79.17% | 82.62% | 83.71% | 66.05% | 79.17% |
| rust-embedded/cortex-m | Rust | finished | 5,200 | 775 | 54.10% | 55.52% | 48.61% | 41.37% | 54.10% |
| rust-lang/mdBook | Rust | finished | 19,753 | 2,558 | 23.63% | 23.66% | 16.67% | 14.51% | 24.49% |
| rustls/rustls | Rust | finished | 69,251 | 6,395 | 26.91% | 26.93% | 22.09% | 20.05% | 26.91% |
| samber/lo | Go | finished | 29,697 | 9,152 | 62.74% | 63.75% | 63.72% | 44.09% | 62.74% |
| serde-rs/serde | Rust | finished | 29,641 | 5,865 | 36.47% | 36.50% | 21.53% | 17.27% | 36.47% |
| spf13/cobra | Go | finished | 8,886 | 1,685 | 78.46% | 80.46% | 79.98% | 64.81% | 78.46% |
| stretchr/testify | Go | finished | 19,868 | 3,977 | 79.38% | 80.49% | 81.91% | 65.52% | 79.38% |
| tauri-apps/tauri | Rust | finished | 91,170 | 15,361 | 37.31% | 37.40% | 31.94% | 26.56% | 37.31% |
| tokio-rs/axum | Rust | finished | 39,950 | 6,985 | 35.18% | 35.20% | 26.31% | 21.71% | 35.18% |
| tree-sitter/tree-sitter | Rust | finished | 58,825 | 6,995 | 33.60% | 33.68% | 28.75% | 25.33% | 33.60% |
| trpc/trpc | TypeScript / JS | finished | 107,470 | 22,710 | 61.94% | 63.77% | 62.62% | 49.39% | 61.94% |
| vercel/turborepo | TypeScript / JS | finished | 673,381 | 52,124 | 29.69% | 29.72% | 25.18% | 23.23% | 29.69% |
| vitejs/vite | TypeScript / JS | finished | 55,575 | 20,043 | 62.79% | 65.12% | 65.08% | 41.61% | 62.79% |
| vitest-dev/vitest | TypeScript / JS | finished | 116,220 | 12,100 | 67.89% | 69.30% | 69.74% | 62.48% | 67.89% |
| wagoodman/dive | Go | finished | 14,901 | 3,790 | 69.23% | 74.47% | 77.68% | 57.92% | 69.23% |
| withastro/astro | TypeScript / JS | finished | 152,561 | 45,710 | 66.15% | 69.16% | 60.95% | 42.69% | 66.15% |
| yargs/yargs | TypeScript / JS | finished | 12,205 | 1,114 | 35.12% | 35.67% | 35.77% | 32.50% | 35.12% |

## Rust failed-file influence

These are exact stored unresolved counts. The eligible column uses the earlier audit disposition. The L2 misses column retains tainted library sites whose symbol is unproved. One site with both failure and receiver reasons belongs to the taint item.

| Repository | Unresolved with failed-file reason | Earlier eligible | L2 misses | Tainted and blocked | Also receiver-unverified | All unresolved marked blocked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DioxusLabs/dioxus | 14,423 | 10,445 | 11,277 | 6,210 | 4,135 | 48,359 |
| alacritty/alacritty | 12,344 | 9,697 | 10,232 | 6,311 | 3,307 | 10,100 |
| clap-rs/clap | 0 | 0 | 0 | 0 | 0 | 19,973 |
| rust-lang/mdBook | 444 | 374 | 382 | 279 | 181 | 4,707 |
| rustls/rustls | 19,950 | 16,800 | 17,854 | 9,038 | 5,655 | 21,265 |
| tauri-apps/tauri | 0 | 0 | 0 | 0 | 0 | 31,306 |
| vercel/turborepo | 300,142 | 266,182 | 269,601 | 169,834 | 121,700 | 289,764 |

## Outside-link review checks

These counts use source evidence from the full primary-module breakdown for the SW-1 review cases. For example, yargs imports its own build output, so `missing-module` on those relative paths remains inside. Unproven package links and return types stay unclassified.

| Repository | Outside / unresolved | Outside / unresolved imports |
| --- | ---: | ---: |
| gin-gonic/gin | 5,750 / 9,582 (60.01%) | 490 / 490 |
| yargs/yargs | 1,114 / 8,238 (13.52%) | 130 / 197 |
| alacritty/alacritty | 4,585 / 21,467 (21.36%) | 870 / 1,503 |
