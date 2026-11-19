# C-7 producer proof after the first review

The reviewed build was `6c8b8a9` with TypeScript graph module version 20.
The fixed build used the production code in `403a4ca` and module version 21.
Both builds indexed the same 18 completed pins from the original C-7 sweep.
The two earlier wall-limit attempts remain recorded in the coverage plan.

## Rescan

Two previously definite calls had multiple confirmed producing literals.
Both now have closed two-target candidate sets. Zero of the confirmed
multi-producer calls remain definite in the C-7 changes.

| Repository and call site | Reviewed target | Fixed candidate declarations |
| --- | --- | --- |
| reduxjs/redux-toolkit `packages/toolkit/src/query/fetchBaseQuery.ts:410` | The no-op `clear` | `packages/toolkit/src/query/utils/signals.ts:25` and `:39`, the two properties returned by `anySignal` |
| nestjs/nest `packages/platform-fastify/multipart/multipart/multipart.parser.ts:640` | The no-op `stop` | Lines 304 and 317 in the same file, the no-op and the socket cleanup returned by `rejectWhenDisconnected` |

Another 620 previously resolved links now carry
`object-producer-unverified`. Those sites lack a complete source proof.
The count includes 154 links that already carried a failed-file assumption.
The remaining 466 had been unqualified. Each changed site and its final
outcome is in the comparison archive.

The rescan preserved all 207,414 existing symbol keys, all 440,761 external
outcomes and reasons, and every link site. The separate comparison against
main on Redux Toolkit, Zustand, and yargs preserved all 26,532 previously
definite targets and 7,572 existing symbol keys.

Direct fixture checks against main and the fix recorded three inherited
choices. Main picks the initializer's member for a top-level object binding
reassigned to another literal. It also picks the first named literal's
member for a same-shaped array selection and for a ternary between two named
objects. The fix preserves those three choices at the existing main sites.

The second review found the same failure with a factory whose two `run`
methods have identical signatures. The regression fixture uses that exact
factory. That review also confirmed 36,005 baseline definite links and all
45 sampled targets on the reviewed head. It recorded one backlog case
where `class C { 7 = "text" }` allows `new C()[7]()` to link to the
non-callable numeric field.

[Changed sites](changed-sites.json.gz) · [Comparison script](../compare.mjs)

## Coverage

TypeScript and JavaScript Level 2 moves from **58.50% to 58.46%** in the full
corpus overlay after the review fix. The original main rate was **56.43%**.
Across the 18 matched pins the review fix moves Level 2 from **60.33% to
60.29%**. The all-site and like-for-like rates agree across the same
1,390,561 sites. The settled reference sample counts agree with the
version-20 build, including 23 generic references and seven chain sites.

| Repository | Level 2 reviewed → fixed | TS/JS link sites | Prior resolved outcomes changed |
| --- | ---: | ---: | ---: |
| changesets/changesets | 40.87% → 40.87% | 12,646 | 0 |
| colinhacks/zod | 76.77% → 76.77% | 81,042 | 0 |
| dexie/Dexie.js | 41.70% → 41.68% | 36,431 | 7 |
| excalidraw/excalidraw | 61.56% → 61.54% | 104,519 | 17 |
| honojs/hono | 49.93% → 49.91% | 72,340 | 13 |
| mermaid-js/mermaid | 56.99% → 56.99% | 125,657 | 2 |
| nestjs/nest | 52.91% → 52.90% | 165,330 | 10 |
| oclif/core | 67.84% → 67.84% | 14,188 | 0 |
| pingdotgg/t3code | 68.99% → 68.99% | 162,711 | 0 |
| pmndrs/zustand | 64.15% → 64.15% | 7,099 | 0 |
| puppeteer/puppeteer | 53.98% → 53.97% | 58,244 | 11 |
| react-hook-form/react-hook-form | 50.67% → 50.67% | 49,115 | 0 |
| reduxjs/redux-toolkit | 48.94% → 48.89% | 57,208 | 32 |
| trpc/trpc | 62.17% → 61.91% | 107,470 | 270 |
| vitejs/vite | 62.79% → 62.79% | 55,575 | 2 |
| vitest-dev/vitest | 68.08% → 67.89% | 116,220 | 213 |
| withastro/astro | 66.17% → 66.14% | 152,561 | 45 |
| yargs/yargs | 35.12% → 35.12% | 12,205 | 0 |

- [Twenty hand-checked targets](source-audit.md)
- [Cold index observations](cost.md)
- [Coverage plan input](coverage-plan-input.json.gz)

## Validation

The production build, no-emit type check, and formatting check passed.
All 2,997 repository tests and 16 sweep-tool tests passed. The regression
with the second reviewer's exact factory was added during the full run
and passed in a separate focused check.
