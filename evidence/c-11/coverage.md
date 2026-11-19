# TypeScript and JavaScript Level 2 on the 18 released pins

The replay of release 0.1.0 reproduced the committed SW-3 counts on all
18 pins. The main column uses the merged C-7 coverage archive. The
shared-site comparison matches file, source span, link kind and written
name at the same pin. The last two columns count definite stored library
links in C-11.

| Repository | 0.1.0 all sites | Main all sites | C-11 all sites | 0.1.0 → C-11 shared sites | Stored symbol | Stored unit only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| changesets/changesets | 39.87% | 40.87% | 20.03% | 39.87% → 19.80% | 723 | 154 |
| colinhacks/zod | 71.00% | 76.77% | 83.90% | 71.00% → 83.79% | 18,272 | 602 |
| dexie/Dexie.js | 34.91% | 41.68% | 53.30% | 34.91% → 52.57% | 5,336 | 372 |
| excalidraw/excalidraw | 57.79% | 61.55% | 70.56% | 57.79% → 70.23% | 12,416 | 1,325 |
| honojs/hono | 36.00% | 49.91% | 56.47% | 36.00% → 55.50% | 6,198 | 337 |
| mermaid-js/mermaid | 54.56% | 56.99% | 69.37% | 54.56% → 69.16% | 32,963 | 2,182 |
| nestjs/nest | 47.92% | 52.91% | 59.84% | 47.92% → 58.81% | 19,822 | 1,948 |
| oclif/core | 63.11% | 67.84% | 78.23% | 63.11% → 77.98% | 3,604 | 397 |
| pingdotgg/t3code | 67.21% | 68.99% | 71.93% | 67.21% → 71.72% | 53,555 | 12,005 |
| pmndrs/zustand | 54.38% | 64.15% | 66.63% | 54.38% → 65.27% | 2,005 | 385 |
| puppeteer/puppeteer | 50.75% | 53.97% | 63.18% | 50.75% → 63.00% | 13,396 | 1,029 |
| react-hook-form/react-hook-form | 41.14% | 50.67% | 44.85% | 41.14% → 41.54% | 6,635 | 5,693 |
| reduxjs/redux-toolkit | 39.34% | 48.94% | 54.20% | 39.34% → 53.14% | 7,016 | 1,484 |
| trpc/trpc | 53.31% | 61.94% | 68.80% | 53.31% → 68.32% | 20,877 | 5,151 |
| vitejs/vite | 59.87% | 62.79% | 56.70% | 59.87% → 56.27% | 8,250 | 599 |
| vitest-dev/vitest | 36.13% | 67.89% | 76.43% | 36.13% → 76.25% | 16,213 | 2,335 |
| withastro/astro | 52.89% | 66.15% | 76.69% | 52.89% → 76.51% | 51,874 | 6,203 |
| yargs/yargs | 33.41% | 35.12% | 42.45% | 33.41% → 42.19% | 1,214 | 105 |
| **Total** | **51.92%** | **60.29%** | **66.87%** | **51.92% → 66.40%** | **280,369** | **42,306** |

C-11 credits 929,811 of 1,390,561 links at Level 2. The 280,369 stored
library links with symbols contribute 20.16 percentage points. The 42,306
unit-only links account for 3.04% of all sites and earn Level 1. Release
0.1.0 credited 711,979 of 1,371,373 links. C-11 credits 910,623 on those same sites.
The difference in the all-sites denominators comes from TypeScript changes
merged before C-11.

## Checkout identity

The comparison against main at `595ec7b` matched all 105,415 symbol keys,
713,036 link sites and 326,793 definite checkout destinations across six
repositories. It identified each destination by file and symbol key. Level
2 rose from 61.14% to 67.19% on the same 713,036 sites.

| Repository | Symbol keys | Link sites | Definite checkout destinations preserved |
| --- | ---: | ---: | ---: |
| Hono | 5,773 | 72,340 | 34,618 |
| T3 Code | 30,346 | 162,711 | 63,481 |
| Astro | 26,243 | 152,561 | 65,124 |
| Excalidraw | 13,405 | 104,519 | 61,330 |
| NestJS | 19,464 | 165,330 | 79,114 |
| Vite | 10,184 | 55,575 | 23,126 |

Hono gains 36 checkout links. The `hono` route in
`adapters/deno/test/deno.json:11` points to `src/index.ts`. The checker
can follow its exports to `src/hono.ts`, `src/hono-base.ts` and
`src/context.ts`.

Vite resolves 136 additional existing sites to checkout declarations.
Its configs explicitly load `vite/client`. Honoring that option makes
the existing asset module declarations in `packages/vite/client.d.ts`
visible at 68 of those sites, and the hot-reload declarations in
`packages/vite/types/hot.d.ts` visible at the other 68. The module uses
its existing rule for checkout declarations at those sites.

The T3 Code sweep pin is separate from the `b387e3a1` default-heap check.

## Second-review outcome changes

The comparison uses the same sites in module 27 and the final module 28.
All rows start from a definite library outcome. The last column counts
the subset that previously had a symbol and earned Level 2.

| Review point | Final outcome | Sites | Previously Level 2 |
| --- | --- | ---: | ---: |
| 5 · Missing evidence for a package route | Unresolved | 3,718 | 3,406 |
| 6 · Missing global type declarations | Candidate set | 2,781 | 2,781 |
| 6 · Missing global type declarations | Unresolved | 19,431 | 19,431 |
| 6 · Tied compiler configurations disagree on global type availability | Unresolved | 3,158 | 3,158 |
| 7 · Node builtin and declared npm polyfill | Candidate set | 9 | 3 |
| **Total** | **2,790 candidate sets and 26,307 unresolved links** | **29,097** | **28,779** |

Excalidraw's `@site/src/initialData` and `@theme-original/MDXComponents`,
tRPC's `std/async/delay.ts` remote Deno route and Vitest's `uno.css` virtual
module stay unresolved. Vitest's `test/browser/test/polyfill-lib.test.ts:2`
stores both the Node and npm `url` candidates.
[Paired outcome counter](review-transitions.mjs)

## Previously credited library symbols

The paired export found 35,601 released Level 2 library credits that C-11
withholds, down from 39,645 in the first review build. Explicit Node routes
survive incomplete compiler configuration when the route is independently
known. Unrelated unreadable source no longer suppresses a written outside
binding when the module route is proven. Qualified import aliases and
type-only ambient heritage recover 19 previous credits in the last replay.

| Reason for withholding Level 2 | Links | Source evidence |
| --- | ---: | --- |
| Unsupported legacy member attribution | 24,788 | The old reconstruction took an imported value's property spelling as an export path. Of these sites, 19,685 now earn unit-only credit. |
| Legacy credit for a bundler transform | 5 | T3 Code constructs a `?worker` wrapper at `apps/web/src/components/DiffWorkerPoolProvider.tsx:43`. The default export depends on the transform. |
| Legacy credit for a name omitted by a captured module | 1 | Dexie imports `config` from `qunit` at `addons/y-dexie/test/unit/dexie-unittest-utils.js:2`. The captured declaration at `addons/y-dexie/test/qunit.d.ts:1` omits that export. |
| Written name without evidence of an external package route | 167 | A bare name can select a framework alias, virtual module or missing workspace entry. |
| Written name with competing Node and npm routes | 3 | Vite imports `URL` from a declared bare `url` polyfill at `playground/cli-module/vite.config.js:2`. |
| Written name with incomplete compiler configuration | 2,655 | Changesets names `vitest`'s `expect` and `it` in `packages/apply-release-plan/src/edit-json.test.ts:1`. Its missing base config leaves module resolution open. |
| Written name with an unreadable workspace manifest | 7,974 | The manifest in Vite's `playground/resolve/utf8-bom-package` fixture leaves the workspace package inventory incomplete. This includes cases also carrying the `no-unseen-declarations` assumption. |
| Written name with an unverified Deno route | 5 | Hono names `vite-plus` in `adapters/deno/vite.config.ts:1`. The nearest captured Deno map does not establish the route. |
| Written name with unseen declaration context | 3 | Astro's Preact compatibility fixture imports a written `react` binding from `packages/astro/e2e/fixtures/preact-compat-component/src/components/Counter.jsx:1`. |

The legacy measurements accepted these outside names using source
reconstruction. The current measure credits only stored definite targets.

The 7,974 workspace cases are recoverable from the pinned source once the
manifest reader handles its leading UTF-8 BOM. In a separate copy of the
Vite pin, removing only that marker exposed the workspace package name
`@vitejs/test-utf8-bom-package`. After cold and warm indexing and pairing
with the release from the same pin, withheld written-name credits fell
from 7,979 to 5. The pinned comparison and coverage plan still use the
original manifest bytes.

## Coverage-plan examples

| Support item | Newly settled reference sites | Recorded example |
| --- | ---: | --- |
| `ts-runtime` | 40 | Astro's `packages/astro/src/assets/utils/vendor/image-size/detector.ts:22` names `es Map.prototype.get`. |
| `ts-package` | 2 | Astro's `packages/integrations/markdoc/src/runtime-assets-config.ts:6` names `@markdoc/markdoc Config`. |
| `ts-package-chain` | 0 | A missing dependency declaration or package route still leaves the sampled chains open. |

[Coverage-plan input](coverage-plan-input.json.gz) · [Pinned source audit](audit.md)
