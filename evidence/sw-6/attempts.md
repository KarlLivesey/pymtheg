# Sweep attempts

Peak is the largest recorded resident-memory peak across the attempt's stages. Wall covers checkout, setup, both indexes and queries. Cold columns cover the first index. Level 2 uses the pin language and marks every score carried forward from bare mode.

## bare

| Pin | Outcome | Level 2 | Wall (s) | Peak (MiB) | Cold (s) | Cold peak (MiB) | Detail |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| BurntSushi/ripgrep | finished | 65.56% | 97.4 | 821.3 | 77.4 | 821.3 | ok, 0 failed files |
| DioxusLabs/dioxus | finished | 46.07% | 1158.8 | 2709.7 | 770.5 | 2683.4 | ok, 0 failed files |
| RustCrypto/hashes | finished | 47.71% | 41.9 | 470.4 | 30.5 | 470.4 | ok, 0 failed files |
| actix/actix-web | finished | 40.31% | 223.6 | 1389.8 | 175.4 | 1329.0 | ok, 0 failed files |
| alacritty/alacritty | finished | 47.93% | 93.1 | 721.0 | 72.8 | 721.0 | ok, 0 failed files |
| cberner/redb | finished | 42.40% | 191.1 | 1007.7 | 158.2 | 1007.7 | ok, 0 failed files |
| changesets/changesets | finished | 20.15% | 23.9 | 419.3 | 15.6 | 419.3 | incomplete, 0 failed files |
| charmbracelet/bubbletea | finished | 86.71% | 52.7 | 339.0 | 40.5 | 339.0 | ok, 0 failed files |
| cilium/ebpf | finished | 92.36% | 141.7 | 707.1 | 123.6 | 695.7 | ok, 0 failed files |
| clap-rs/clap | finished | 33.61% | 191.2 | 865.2 | 161.8 | 865.2 | ok, 0 failed files |
| cli/cli | finished | 90.79% | 618.7 | 2282.9 | 546.9 | 2282.9 | ok, 0 failed files |
| cockroachdb/pebble | finished | 91.77% | 450.8 | 2271.5 | 399.8 | 2124.7 | ok, 0 failed files |
| colinhacks/zod | finished | 83.86% | 114.8 | 1666.0 | 92.7 | 1666.0 | ok, 0 failed files |
| crossbeam-rs/crossbeam | finished | 51.21% | 129.7 | 773.4 | 110.4 | 773.4 | ok, 0 failed files |
| dexie/Dexie.js | finished | 54.73% | 77.6 | 811.3 | 62.6 | 811.3 | ok, 0 failed files |
| embassy-rs/embassy | wall-limit | — | 3601.0 | 4550.7 | 3280.5 | 4550.7 | warm · exit 124 · graph analyze rust: 0/2514 |
| etcd-io/bbolt | finished | 93.09% | 44.7 | 368.2 | 34.8 | 368.2 | ok, 0 failed files |
| evanw/esbuild | finished | 98.45% | 365.4 | 1134.3 | 336.2 | 1134.3 | ok, 0 failed files |
| excalidraw/excalidraw | finished | 71.93% | 123.1 | 2344.2 | 100.4 | 2344.2 | incomplete, 0 failed files |
| fjall-rs/fjall | finished | 44.28% | 56.4 | 542.8 | 37.9 | 542.8 | ok, 0 failed files |
| gin-gonic/gin | finished | 93.49% | 53.0 | 450.7 | 42.7 | 423.2 | ok, 0 failed files |
| go-task/task | finished | 92.22% | 52.6 | 465.8 | 41.5 | 465.8 | ok, 0 failed files |
| gofiber/fiber | finished | 87.30% | 396.5 | 1522.2 | 352.3 | 1522.2 | ok, 0 failed files |
| golang/tools | finished | 92.93% | 801.5 | 2139.4 | 714.0 | 2139.4 | incomplete, 17 failed files (17 Go) |
| helix-editor/helix | finished | 44.42% | 224.8 | 1220.5 | 167.3 | 1220.5 | ok, 0 failed files |
| honojs/hono | finished | 58.24% | 123.6 | 1743.8 | 106.7 | 1743.8 | ok, 0 failed files |
| junegunn/fzf | finished | 89.54% | 52.1 | 495.0 | 41.1 | 495.0 | ok, 0 failed files |
| labstack/echo | finished | 95.17% | 82.8 | 590.5 | 68.4 | 590.5 | ok, 0 failed files |
| mattn/go-sqlite3 | finished | 84.09% | 42.2 | 326.6 | 32.7 | 326.6 | ok, 0 failed files |
| mermaid-js/mermaid | finished | 75.34% | 194.2 | 2221.2 | 156.2 | 2221.2 | ok, 0 failed files |
| microsoft/TypeScript | finished | — | 2608.3 | 4988.3 | 1848.6 | 4586.7 | 1 analysis error · TypeScript compiler assertion (Debug Failure. False expression.) · 1 resolution error · incomplete, 27,194 failed files (27,194 TypeScript / JavaScript) |
| nestjs/nest | finished | 74.78% | 257.2 | 1882.8 | 221.1 | 1882.8 | ok, 0 failed files |
| oclif/core | finished | 85.77% | 37.4 | 636.7 | 29.5 | 636.7 | ok, 0 failed files |
| pingdotgg/t3code | finished | 72.34% | 230.7 | 2107.7 | 192.2 | 2107.7 | incomplete, 0 failed files |
| pmndrs/zustand | finished | 66.78% | 23.7 | 385.7 | 15.8 | 385.7 | ok, 0 failed files |
| pocketbase/pocketbase | finished | 91.61% | 464.8 | 2063.3 | 422.4 | 2063.3 | ok, 0 failed files |
| protocolbuffers/protobuf-go | finished | 88.56% | 497.8 | 2215.5 | 439.4 | 2078.3 | ok, 0 failed files |
| puppeteer/puppeteer | finished | 64.56% | 70.6 | 811.7 | 54.5 | 811.7 | incomplete, 1 failed files (1 TypeScript / JavaScript) |
| ratatui/ratatui | finished | 39.48% | 160.6 | 1107.0 | 114.8 | 1107.0 | ok, 0 failed files |
| react-hook-form/react-hook-form | finished | 44.92% | 69.7 | 801.7 | 57.1 | 801.7 | ok, 0 failed files |
| reduxjs/redux-toolkit | finished | 63.87% | 89.8 | 1184.7 | 72.2 | 1184.7 | incomplete, 0 failed files |
| restic/restic | finished | 90.68% | 131.0 | 706.0 | 108.8 | 706.0 | ok, 0 failed files |
| rust-embedded/cortex-m | finished | 55.09% | 32.6 | 376.5 | 23.0 | 376.5 | ok, 0 failed files |
| rust-lang/mdBook | finished | 51.75% | 64.3 | 660.7 | 48.4 | 660.7 | incomplete, 2 failed files (2 Rust) |
| rustls/rustls | finished | 28.64% | 321.2 | 1503.3 | 220.3 | 1432.8 | ok, 0 failed files |
| samber/lo | finished | 87.19% | 70.2 | 563.1 | 58.2 | 563.1 | incomplete, 0 failed files |
| serde-rs/serde | finished | 26.96% | 119.9 | 944.1 | 87.8 | 837.3 | ok, 0 failed files |
| spf13/cobra | finished | 92.20% | 29.6 | 305.6 | 21.6 | 305.6 | ok, 0 failed files |
| stretchr/testify | finished | 93.30% | 47.3 | 428.4 | 38.0 | 401.5 | ok, 0 failed files |
| swc-project/swc | wall-limit | — | 3601.4 | 4182.9 | 3550.4 | 4182.9 | cold · exit 124 · graph analyze rust: 0/1523 |
| tauri-apps/tauri | finished | 47.60% | 221.4 | 1632.6 | 165.9 | 1509.3 | incomplete, 9 failed files (8 Rust, 1 TypeScript / JavaScript) |
| tokio-rs/axum | finished | 39.48% | 163.7 | 924.8 | 135.5 | 924.8 | ok, 0 failed files |
| tree-sitter/tree-sitter | finished | 43.34% | 139.0 | 1120.6 | 108.4 | 1120.6 | ok, 0 failed files |
| trpc/trpc | finished | 73.02% | 224.9 | 1145.8 | 164.1 | 998.9 | incomplete, 6 failed files (6 TypeScript / JavaScript) |
| vercel/turborepo | finished | — | 2510.2 | 5652.7 | 1966.7 | 5601.3 | 1 analysis error · 3,094 files marked failed due to an invalid UTF-16 range · 1 resolution error · incomplete, 3,094 failed files (3,094 TypeScript / JavaScript) |
| vitejs/vite | finished | 56.64% | 119.7 | 1045.9 | 75.5 | 1045.9 | incomplete, 4 failed files (4 TypeScript / JavaScript) |
| vitest-dev/vitest | finished | 77.21% | 187.3 | 1966.2 | 154.4 | 1966.2 | incomplete, 3 failed files (3 TypeScript / JavaScript) |
| wagoodman/dive | finished | 86.98% | 45.5 | 345.8 | 35.4 | 345.8 | ok, 0 failed files |
| withastro/astro | finished | 76.98% | 272.2 | 2911.7 | 221.5 | 2911.7 | incomplete, 4 failed files (4 TypeScript / JavaScript) |
| yargs/yargs | finished | 42.45% | 26.2 | 394.8 | 16.0 | 394.8 | ok, 0 failed files |

## installed

| Pin | Outcome | Level 2 | Wall (s) | Peak (MiB) | Cold (s) | Cold peak (MiB) | Detail |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| changesets/changesets | finished | 86.99% | 40.3 | 2940.4 | 17.2 | 839.6 | pnpm 11.13.1 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · ok, 0 failed files |
| colinhacks/zod | finished | 94.65% | 126.9 | 2519.7 | 99.7 | 2346.3 | nub 0.8.3 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · ok, 0 failed files |
| dexie/Dexie.js | finished | 56.40% | 69.1 | 2111.1 | 48.2 | 1522.0 | pnpm 10.15.1 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · ok, 0 failed files |
| excalidraw/excalidraw | finished | 94.26% | 291.6 | 2909.9 | 187.3 | 2909.9 | yarn 1.22.22 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · incomplete, 0 failed files |
| honojs/hono | finished | 91.22% | 86.1 | 1567.4 | 71.9 | 1567.4 | pnpm 12.6.0 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · ok, 0 failed files |
| mermaid-js/mermaid | finished | 89.24% | 271.3 | 2989.6 | 231.4 | 2750.4 | pnpm 10.30.3 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · ok, 0 failed files |
| microsoft/TypeScript | wall-limit | — (bare) | 3610.7 | 4952.4 | 3581.1 | 4952.4 | npm 11.21.1 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · cold · exit 137 · graph analyze typescript: 0/27194 |
| nestjs/nest | finished | 94.11% | 496.9 | 2741.8 | 450.3 | 2741.8 | npm 11.19.0 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · ok, 0 failed files |
| oclif/core | finished | 95.07% | 44.1 | 981.9 | 20.3 | 981.9 | yarn 1.22.22 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · ok, 0 failed files |
| pingdotgg/t3code | finished | 91.52% | 246.2 | 3356.5 | 223.3 | 3356.5 | bun 1.3.11 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · ok, 0 failed files |
| pmndrs/zustand | finished | 82.70% | 24.1 | 1925.5 | 10.1 | 617.9 | pnpm 11.3.0 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · ok, 0 failed files |
| puppeteer/puppeteer | finished | 78.01% | 109.6 | 1599.4 | 56.7 | 1599.4 | npm 11.19.0 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · incomplete, 1 failed files (1 TypeScript / JavaScript) |
| react-hook-form/react-hook-form | finished | 75.85% | 54.2 | 1752.9 | 40.1 | 1220.2 | pnpm 10.15.1 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · ok, 0 failed files |
| reduxjs/redux-toolkit | finished | 80.15% | 104.3 | 3465.0 | 75.9 | 1873.6 | pnpm 11.23.0 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · incomplete, 0 failed files |
| trpc/trpc | finished | 89.55% | 534.0 | 2917.8 | 280.2 | 2882.8 | pnpm 12.4.1 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · incomplete, 6 failed files (6 TypeScript / JavaScript) |
| vercel/turborepo | finished | 46.98% | 1755.4 | 5529.3 | 1272.4 | 5529.3 | pnpm 12.0.0 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · incomplete, 26 failed files (26 TypeScript / JavaScript) |
| vitejs/vite | finished | 83.34% | 154.8 | 2789.0 | 85.3 | 2476.1 | pnpm 12.21.0 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · incomplete, 3 failed files (3 TypeScript / JavaScript) |
| vitest-dev/vitest | finished | 82.41% | 303.4 | 3544.8 | 254.2 | 3086.3 | pnpm 11.28.6 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · incomplete, 3 failed files (3 TypeScript / JavaScript) |
| withastro/astro | finished | 86.28% | 719.5 | 3754.8 | 640.4 | 3386.2 | pnpm 11.28.11 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · incomplete, 4 failed files (4 TypeScript / JavaScript) |
| yargs/yargs | finished | 52.65% | 19.4 | 547.3 | 9.9 | 547.3 | npm 11.19.0 installed · measured at ` 2dc05bebd4d38fc44075c98637a58c15bd614ba3 ` · ok, 0 failed files |

## go-toolchain

| Pin | Outcome | Level 2 | Wall (s) | Peak (MiB) | Cold (s) | Cold peak (MiB) | Detail |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| charmbracelet/bubbletea | finished | 88.12% | 73.8 | 367.4 | 61.9 | 367.4 | used · 2/2 clean packages · ok, 0 failed files |
| cilium/ebpf | finished | 95.23% | 139.5 | 777.5 | 118.2 | 777.5 | used · 78/80 clean packages · ok, 0 failed files |
| cli/cli | finished | 90.80% | 795.8 | 2324.4 | 715.1 | 2324.4 | used · 43/604 clean packages · ok, 0 failed files |
| cockroachdb/pebble | finished | 91.77% | 645.5 | 2216.6 | 571.0 | 1852.1 | used · 13/206 clean packages · ok, 0 failed files |
| etcd-io/bbolt | finished | 94.61% | 87.7 | 402.8 | 69.7 | 397.5 | used · 24/27 clean packages · ok, 0 failed files |
| evanw/esbuild | finished | 98.45% | 369.7 | 1361.2 | 337.5 | 1161.9 | used · 2/47 clean packages · ok, 0 failed files |
| gin-gonic/gin | finished | 95.98% | 98.6 | 563.1 | 84.0 | 563.1 | used · 14/14 clean packages · ok, 0 failed files |
| go-task/task | finished | 95.57% | 113.6 | 500.3 | 97.8 | 500.3 | used · 55/55 clean packages · ok, 0 failed files |
| gofiber/fiber | finished | 87.30% | 557.6 | 1522.5 | 504.9 | 1522.5 | used · 14/166 clean packages · ok, 0 failed files |
| golang/tools | finished | 93.31% | 912.0 | 2622.6 | 788.0 | 2622.6 | used · 226/399 clean packages · incomplete, 17 failed files (17 Go) |
| junegunn/fzf | finished | 90.84% | 88.3 | 576.9 | 73.1 | 576.9 | used · 10/10 clean packages · ok, 0 failed files |
| labstack/echo | finished | 95.67% | 154.9 | 706.3 | 136.9 | 618.8 | used · 9/9 clean packages · ok, 0 failed files |
| mattn/go-sqlite3 | finished | 84.21% | 69.9 | 314.1 | 55.5 | 300.6 | used · 1/3 clean packages · ok, 0 failed files |
| pocketbase/pocketbase | finished | 91.69% | 681.3 | 2473.6 | 626.5 | 2473.6 | used · 32/96 clean packages · ok, 0 failed files |
| protocolbuffers/protobuf-go | finished | 91.87% | 788.6 | 2468.3 | 696.5 | 2468.3 | used · 229/244 clean packages · ok, 0 failed files |
| restic/restic | finished | 91.42% | 178.9 | 882.8 | 140.3 | 755.5 | used · 91/142 clean packages · ok, 0 failed files |
| samber/lo | finished | 87.34% | 112.1 | 569.5 | 93.0 | 537.1 | used · 8/14 clean packages · incomplete, 0 failed files |
| spf13/cobra | finished | 96.71% | 56.2 | 329.9 | 45.2 | 329.9 | used · 2/5 clean packages · ok, 0 failed files |
| stretchr/testify | finished | 94.08% | 93.5 | 483.5 | 81.6 | 433.0 | used · 19/19 clean packages · ok, 0 failed files |
| wagoodman/dive | finished | 86.98% | 79.2 | 363.4 | 61.0 | 363.4 | used · 0/49 clean packages · ok, 0 failed files |
