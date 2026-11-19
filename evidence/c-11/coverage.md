# TypeScript and JavaScript Level 2 on the 18 released pins

The replay of release 0.1.0 reproduced the committed SW-3 counts on all
18 pins. The main column uses the merged C-7 coverage archive. The
shared-site comparison matches file, source span, link kind and written
name at the same pin. The last two columns count definite stored library
links in C-11.

| Repository | 0.1.0 all sites | Main all sites | C-11 all sites | 0.1.0 → C-11 shared sites | Stored symbol | Stored unit only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| changesets/changesets | 39.87% | 40.87% | 15.45% | 39.87% → 15.20% | 144 | 26 |
| colinhacks/zod | 71.00% | 76.77% | 84.59% | 71.00% → 84.48% | 18,827 | 607 |
| dexie/Dexie.js | 34.91% | 41.68% | 62.65% | 34.91% → 62.07% | 8,742 | 425 |
| excalidraw/excalidraw | 57.79% | 61.55% | 72.95% | 57.79% → 72.66% | 14,919 | 1,385 |
| honojs/hono | 36.00% | 49.91% | 63.45% | 36.00% → 62.63% | 11,279 | 325 |
| mermaid-js/mermaid | 54.56% | 56.99% | 70.72% | 54.56% → 70.51% | 34,655 | 2,186 |
| nestjs/nest | 47.92% | 52.91% | 60.23% | 47.92% → 59.21% | 20,466 | 1,967 |
| oclif/core | 63.11% | 67.84% | 78.87% | 63.11% → 78.63% | 3,695 | 397 |
| pingdotgg/t3code | 67.21% | 68.99% | 72.65% | 67.21% → 72.45% | 54,725 | 12,005 |
| pmndrs/zustand | 54.38% | 64.15% | 67.28% | 54.38% → 65.94% | 2,051 | 385 |
| puppeteer/puppeteer | 50.75% | 53.97% | 64.47% | 50.75% → 64.30% | 14,150 | 911 |
| react-hook-form/react-hook-form | 41.14% | 50.67% | 45.55% | 41.14% → 42.28% | 6,977 | 5,728 |
| reduxjs/redux-toolkit | 39.34% | 48.94% | 55.16% | 39.34% → 54.12% | 7,565 | 1,496 |
| trpc/trpc | 53.31% | 61.94% | 71.39% | 53.31% → 70.96% | 23,648 | 5,172 |
| vitejs/vite | 59.87% | 62.79% | 55.99% | 59.87% → 55.55% | 7,856 | 397 |
| vitest-dev/vitest | 36.13% | 67.89% | 76.06% | 36.13% → 75.88% | 15,786 | 1,788 |
| withastro/astro | 52.89% | 66.15% | 80.74% | 52.89% → 80.59% | 58,059 | 5,989 |
| yargs/yargs | 33.41% | 35.12% | 43.32% | 33.41% → 43.07% | 1,320 | 105 |
| **Total** | **51.92%** | **60.29%** | **68.63%** | **51.92% → 68.19%** | **304,864** | **41,294** |

C-11 credits 954,288 of 1,390,561 links at Level 2. The 304,864 stored
library links with symbols contribute 21.92 points of that score. The 41,294 unit-only
links account for 2.97% of all sites and earn Level 1. Release 0.1.0 credited
711,979 of 1,371,373 links. C-11 credits 935,100 on those same sites.
The difference in the all-sites denominators comes from TypeScript changes
merged before C-11.

## Checkout identity

The exact comparisons matched every symbol key and existing link site by
source location and each definite checkout destination by file and symbol
key. All five comparisons found zero added or removed symbols and link
sites, and zero changed definite checkout destinations. Level 2 on those
same 640,696 sites rose from 62.41% to 69.98%.

| Repository | Symbol keys | Link sites | Definite checkout destinations preserved |
| --- | ---: | ---: | ---: |
| T3 Code | 30,346 | 162,711 | 63,481 |
| Astro | 26,243 | 152,561 | 65,124 |
| Excalidraw | 13,405 | 104,519 | 61,330 |
| NestJS | 19,464 | 165,330 | 79,114 |
| Vite | 10,184 | 55,575 | 23,126 |

Vite resolves 136 additional existing sites to checkout declarations.
Its configs explicitly load `vite/client`. Honoring that option makes
the existing asset module declarations in `packages/vite/client.d.ts`
visible at 68 of those sites, and the hot-reload declarations in
`packages/vite/types/hot.d.ts` visible at the other 68. The module uses
its existing rule for checkout declarations at those sites.

The T3 Code sweep pin is separate from the `b387e3a1` default-heap check.

## Previously credited library symbols

The paired export found 39,645 released Level 2 library credits that
C-11 withholds. The old reconstruction credited 24,788 member accesses
without establishing the declaring owner. This includes 19,616 sites
that now earn unit-only credit. Another six previous credits selected a
bundler-generated export or a name omitted by a captured declaration.

At 14,857 sites the source writes or selects an export name. The rows
below show why the corresponding Level 2 identity is withheld, including
those six old attributions. The 37 name-reference cases include source
proof that the current implementation does not capture.

| Reason for withholding a written name | Links | Source example |
| --- | ---: | --- |
| Incomplete compiler configuration | 3,257 | Changesets names `vitest`'s `expect` and `it` in `packages/apply-release-plan/src/edit-json.test.ts:1`. Its missing base config leaves module resolution open. |
| Unseen declarations after source failures | 6,975 | Puppeteer writes `readFile` from `node:fs/promises` at `Herebyfile.mjs:9`. The program carries the `no-unseen-declarations` assumption. |
| Unreadable workspace manifest | 4,582 | The manifest in Vite's `playground/resolve/utf8-bom-package` fixture leaves the workspace package inventory incomplete. |
| Type and JSX reference shapes | 37 | NestJS uses `typeof pathToRegexp` through a type-only import at `packages/core/router/utils/exclude-route.util.ts:50`. Redux Toolkit selects `ReactRouterDom.Link` in `examples/type-portability/nodenext-cjs/src/App.tsx:8`. |
| Bundler transforms | 5 | T3 Code constructs a `?worker` wrapper at `apps/web/src/components/DiffWorkerPoolProvider.tsx:43`. The default export depends on the transform. |
| Name omitted by a captured module | 1 | Dexie imports `config` from `qunit` at `addons/y-dexie/test/unit/dexie-unittest-utils.js:2`. The captured declaration at `addons/y-dexie/test/qunit.d.ts:1` omits that export. |

Vite's final replay retains 7,856 symbol-bearing library links and 397
unit-only links. The workspace guard withholds npm targets where the
package boundary depends on the unreadable manifest. Node builtins and
checker-proven standard declarations still have known units.

## Coverage-plan examples

| Support item | Newly settled reference sites | Recorded example |
| --- | ---: | --- |
| `ts-runtime` | 54 | Astro's `packages/astro/src/assets/utils/vendor/image-size/detector.ts:22` names `es Map.prototype.get`. |
| `ts-package` | 5 | Astro's `packages/integrations/markdoc/src/runtime-assets-config.ts:6` names `@markdoc/markdoc Config`. |
| `ts-package-chain` | 1 | Redux Toolkit's `packages/toolkit/.size-limit.cjs:22` names `webpack NormalModuleReplacementPlugin`. |

[Coverage-plan input](coverage-plan-input.json.gz) · [Pinned source audit](audit.md)
