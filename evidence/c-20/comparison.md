# Paired TypeScript dependency sweep

| Pin | Bare Level 2 | With installed declarations | Gains | Withdrawals | Net | Install and sweep |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| changesets/changesets | 20.15% | 86.99% | 8453 | 0 | 8453 | pnpm / installed / ok cold, ok warm |
| colinhacks/zod | 83.86% | 83.86% | 0 | 0 | 0 | unsupported / unsupported-package-manager / install-unavailable |
| dexie/Dexie.js | 54.73% | 56.25% | 752 | 198 | 554 | pnpm / installed / ok cold, ok warm |
| excalidraw/excalidraw | 71.93% | 93.36% | 23234 | 834 | 22400 | yarn / installed / incomplete cold, incomplete warm |
| honojs/hono | 58.24% | 64.15% | 4280 | 4 | 4276 | pnpm / installed / ok cold, ok warm |
| mermaid-js/mermaid | 75.34% | 89.17% | 18504 | 1124 | 17380 | pnpm / installed / ok cold, ok warm |
| nestjs/nest | 74.78% | 74.78% | 0 | 0 | 0 | npm / failed / install-unavailable |
| oclif/core | 85.77% | 95.07% | 1379 | 59 | 1320 | yarn / installed / ok cold, ok warm |
| pingdotgg/t3code | 72.34% | 72.34% | 0 | 0 | 0 | unsupported / unsupported-package-manager / install-unavailable |
| pmndrs/zustand | 66.78% | 82.65% | 1134 | 8 | 1126 | pnpm / installed / ok cold, ok warm |
| puppeteer/puppeteer | 64.56% | 78.00% | 8017 | 191 | 7826 | npm / installed / incomplete cold, incomplete warm |
| react-hook-form/react-hook-form | 44.92% | 74.90% | 15087 | 362 | 14725 | pnpm / installed / incomplete cold, ok warm |
| reduxjs/redux-toolkit | 63.87% | 80.02% | 9340 | 104 | 9236 | pnpm / installed / incomplete cold, incomplete warm |
| trpc/trpc | 73.02% | 87.72% | 16718 | 916 | 15802 | pnpm / installed / incomplete cold, incomplete warm |
| vitejs/vite | 56.64% | 82.23% | 14383 | 166 | 14217 | pnpm / installed / incomplete cold, incomplete warm |
| vitest-dev/vitest | 77.21% | 82.26% | 6503 | 625 | 5878 | pnpm / installed / incomplete cold, incomplete warm |
| withastro/astro | 76.98% | 85.35% | 13278 | 502 | 12776 | pnpm / installed / incomplete cold, incomplete warm |
| yargs/yargs | 42.45% | 52.65% | 1250 | 5 | 1245 | npm / installed / ok cold, ok warm |
| **All pins** | **70.42%** | **80.28%** | **142312** | **5098** | **137214** | |

Matched sites 1390561 · 70.42% → 80.28%.

All TypeScript transitions: 142312 gains and 5098 withdrawals.

| Row | New Level 2 links | New unit-only links | New candidate sets | SW-3 reference sites at Level 2 |
| --- | ---: | ---: | ---: | ---: |
| Aliases and globals | 39375 | 16846 | 201 | 21/52 → 36/52 |
| Standard and DOM | 15616 | 0 | 10985 | 48/69 → 54/69 |
| Return types and re-exports | 85952 | 1499 | 95 | 0/77 → 37/77 |

Bare preservation checked all 19304 sites and 1778 symbol keys. The installed attempts added 0 sites and removed 0.

| Change from a definite bare target | Links | Level 2 withdrawals |
| --- | ---: | ---: |
| candidate-set | 2729 | 2644 |
| checkout-declaration | 49 | 0 |
| installed-declaration | 68247 | 1133 |
| other-library-declaration | 24 | 0 |
| same-unit-and-symbol/updated-proof | 61758 | 0 |
| unit-refined-to-member | 8145 | 0 |
| unresolved/any-receiver | 2 | 2 |
| unresolved/external | 1194 | 743 |
| unresolved/external-package | 310 | 310 |
| unresolved/incomplete-config | 21 | 18 |
| unresolved/library-member-written | 2 | 2 |
| unresolved/local | 5 | 5 |
| unresolved/no-symbol | 53 | 53 |
| unresolved/object-producer-unverified | 31 | 31 |
| unresolved/target-unavailable | 1 | 1 |
| unresolved/workspace-manifest-unreadable | 156 | 156 |
| Total | 142727 | 5098 |
