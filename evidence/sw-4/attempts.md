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
| changesets/changesets | finished | 86.99% | 59.2 | 2816.4 | 28.3 | 779.7 | pnpm installed · ok, 0 failed files |
| colinhacks/zod | install-unavailable | 83.86% (bare) | 1.5 | 14.9 | — | — | unsupported unsupported-package-manager |
| dexie/Dexie.js | finished | 56.25% | 131.4 | 2132.5 | 85.6 | 1448.2 | pnpm installed · ok, 0 failed files |
| excalidraw/excalidraw | finished | 93.36% | 491.9 | 2785.2 | 373.3 | 2785.2 | yarn installed · incomplete, 0 failed files |
| honojs/hono | finished | 64.15% | 133.1 | 1749.6 | 109.3 | 1749.6 | pnpm installed · ok, 0 failed files |
| mermaid-js/mermaid | finished | 89.17% | 408.0 | 2950.5 | 312.8 | 2386.1 | pnpm installed · ok, 0 failed files |
| microsoft/TypeScript | wall-limit | — (bare) | 3610.9 | 3672.8 | 3565.3 | 3672.8 | npm installed · cold · exit 137 · graph analyze typescript: 0/27194 |
| nestjs/nest | install-unavailable | 74.78% (bare) | 4.4 | 186.6 | — | — | npm failed ERESOLVE · install · exit 1 |
| oclif/core | finished | 95.07% | 60.7 | 854.6 | 29.5 | 854.6 | yarn installed · ok, 0 failed files |
| pingdotgg/t3code | install-unavailable | 72.34% (bare) | 2.9 | 41.1 | — | — | unsupported unsupported-package-manager |
| pmndrs/zustand | finished | 82.65% | 39.2 | 2032.8 | 15.2 | 651.6 | pnpm installed · ok, 0 failed files |
| puppeteer/puppeteer | finished | 78.00% | 175.7 | 2114.7 | 90.8 | 2114.7 | npm installed · incomplete, 1 failed files (1 TypeScript / JavaScript) |
| react-hook-form/react-hook-form | finished | 74.90% | 128.2 | 1752.2 | 88.3 | 1314.4 | pnpm installed · ok, 0 failed files |
| reduxjs/redux-toolkit | finished | 80.02% | 149.0 | 3687.3 | 112.2 | 1889.4 | pnpm installed · incomplete, 0 failed files |
| trpc/trpc | finished | 88.80% | 673.8 | 2793.5 | 372.8 | 2707.2 | pnpm installed · incomplete, 6 failed files (6 TypeScript / JavaScript) |
| vercel/turborepo | install-unavailable | — (bare) | 10.9 | 108.0 | — | — | pnpm failed rejected --virtual-store-dir · install · exit 2 |
| vitejs/vite | finished | 82.23% | 243.2 | 1805.1 | 151.3 | 1805.1 | pnpm installed · incomplete, 4 failed files (4 TypeScript / JavaScript) |
| vitest-dev/vitest | finished | 82.26% | 478.7 | 3482.1 | 401.8 | 3385.8 | pnpm installed · incomplete, 3 failed files (3 TypeScript / JavaScript) |
| withastro/astro | finished | 85.38% | 804.4 | 3842.8 | 651.0 | 3183.3 | pnpm installed · incomplete, 4 failed files (4 TypeScript / JavaScript) |
| yargs/yargs | finished | 52.65% | 28.8 | 516.3 | 12.5 | 516.3 | npm installed · ok, 0 failed files |

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
