# SW-6 Installed TypeScript coverage refresh and remaining-work list

SW-6 re-runs the installed TypeScript sweep on current main (`2dc05be`, with
C-30, C-32 and C-33). Per D19, the installed figure is the headline. The
sweep covers the 20 TypeScript pins, using the SW-5 runner and install
policy. It changes nothing under `src/` or `test/`.
[Evidence](../../evidence/sw-6/README.md)

## Headline

Installed Level 2 on the 20 TypeScript pins is **85.79%**: 1,238,834 of
1,444,057 links.

- **Proven:** 81.72%.
- **Assumption-marked:** 4.07%.
- **Change since SW-5:** from 85.23%. Like for like on SW-5's 18 contributing
  pins (without Turborepo's newly counted links), the figure is 87.28%.
- **Pins:** 19 of 20 contribute links. microsoft/TypeScript reached the
  60-minute limit again in its single attempt.
- **Turborepo:** the full mixed-language index now finishes inside the limit
  (1,755 s, peak 5,529 MiB). Its 53,495 TypeScript links are 46.98% Level 2,
  which pulls the headline down.
- **Bare figure** (secondary, reused from SW-4 and not re-run): 70.42%.
- **Gap to 90%:** 60,818 Level 2 links, 4.21 points.

The Go and Rust sections of the plan are unchanged since SW-5.

C-24, C-35 and C-26 merged after the measured commit, and are not in these
figures. C-26 (pull request 35) is the analysis watchdog aimed at
microsoft/TypeScript, so that pin's outcome here predates it. Its installed
figure needs a new attempt on current main.

## Per-pin installed TypeScript Level 2

| Pin | Installed attempt | Links | Level 2 SW-5 → SW-6 | Proven SW-6 | Assumption-marked SW-6 |
| --- | --- | ---: | ---: | ---: | ---: |
| microsoft/TypeScript | wall-limit (bare receipt) | 0 | — → — | — | — |
| pingdotgg/t3code | finished | 162,711 | 91.48% → 91.52% | 91.52% | 0.00% |
| withastro/astro | finished | 152,561 | 85.38% → 86.28% | 82.39% | 3.89% |
| nestjs/nest | finished | 165,330 | 91.55% → 94.11% | 94.11% | 0.00% |
| excalidraw/excalidraw | finished | 104,519 | 93.36% → 94.26% | 94.18% | 0.08% |
| vitest-dev/vitest | finished | 116,220 | 82.26% → 82.41% | 50.49% | 31.92% |
| mermaid-js/mermaid | finished | 125,657 | 89.17% → 89.24% | 89.19% | 0.05% |
| trpc/trpc | finished | 107,470 | 88.80% → 89.55% | 89.55% | 0.00% |
| puppeteer/puppeteer | finished | 58,244 | 78.00% → 78.01% | 77.06% | 0.95% |
| colinhacks/zod | finished | 81,042 | 94.65% → 94.65% | 94.65% | 0.00% |
| vitejs/vite | finished | 55,576 | 82.23% → 83.34% | 72.02% | 11.33% |
| reduxjs/redux-toolkit | finished | 57,208 | 80.02% → 80.15% | 80.15% | 0.00% |
| honojs/hono | finished | 72,340 | 64.15% → 91.22% | 91.22% | 0.00% |
| react-hook-form/react-hook-form | finished | 49,115 | 74.90% → 75.85% | 75.85% | 0.00% |
| vercel/turborepo | finished | 53,495 | — → 46.98% | 30.61% | 16.37% |
| dexie/Dexie.js | finished | 36,431 | 56.25% → 56.40% | 56.40% | 0.00% |
| changesets/changesets | finished | 12,646 | 86.99% → 86.99% | 86.99% | 0.00% |
| oclif/core | finished | 14,188 | 95.07% → 95.07% | 95.07% | 0.00% |
| pmndrs/zustand | finished | 7,099 | 82.65% → 82.70% | 82.70% | 0.00% |
| yargs/yargs | finished | 12,205 | 52.65% → 52.65% | 52.65% | 0.00% |
| **All 20** | 19 contribute links | 1,444,057 | 85.23% → 85.79% | 81.72% | 4.07% |

## What is left, ranked by points


Installed Level 2 on the 20 TypeScript pins is **85.79%** (1,238,834 of 1,444,057 links; 81.72% proven, 4.07% assumption-marked). Reaching 90% needs 60,818 more Level 2 links, 4.21 points. One point is 14,441 links. The bare figure is SW-4's, not re-run.

Each group is the first stored blocker, counted exactly over the 19 pins that finished. Shapes come from 10 sites per group at seed `pymtheg-sw6-2026`, read in the pinned source, and from mechanical splits where the stored facts allow. Splits marked estimate rest on those 10 sites only. [Sites](../../evidence/sw-6/remaining-sites.json) · [Verdicts](../../evidence/sw-6/verdicts.json)

| First stored reason | Links | Points | Pins (largest) | Example | Shape and split | Provable from source and installed declarations? |
| --- | ---: | ---: | --- | --- | --- | --- |
| `local` | 43,168 | 2.99 | 19 (redux-toolkit 6,503, react-hook-form 5,249, vitest 4,292) | vercel/turborepo `packages/turbo-codemod/__tests__/get-turbo-upgrade-command.test.ts:722` | The checker selects a declaration in the checkout that has no graph symbol. Five of the ten sites call a member of an object literal or a type literal (`api.util.invalidateTags`, `actionDecreaseFontSize.keyTest`, `signal1.resolve`, `api.persistence.removeSavedEnvironmentSecret`, an inline `AppRouterInputs` type). The other five call a local or destructured binding (`setCount`, `handleSubmit`, `unregisterRight`, `useFixture`, `subscription`).<br>members of object or type literals (estimate, 5 of 10 sites): 21,584 (1.49 pp)<br>calls of local or destructured bindings (estimate, 5 of 10 sites): 21,584 (1.49 pp) | Members: yes. The declaration is proved and needs a graph anchor of its own (a real declared member, not padding). Local bindings: only by tracing the value to its origin. |
| `(unit only)` | 32,617 | 2.26 | 19 (t3code 6,016, react-hook-form 5,103, astro 4,975) | react-hook-form/react-hook-form `src/__tests__/useForm/register.test.tsx:1232` | Imports: the module link of an import (`import { Fragment } from "react"`) names a module, which has no symbol by definition. Calls: a library member call that names only the package (`screen.getByRole`, `fireEvent.click`, `it.each`, `assert.equal` from `assert/strict`).<br>imports (module links): 24,303 (1.68 pp)<br>calls and other member links: 8,314 (0.58 pp) | Imports: no, a definitional ceiling under Level 2. Calls: yes, from the installed declarations the checker selects. |
| `no-symbol` | 29,609 | 2.05 | 19 (puppeteer 7,532, Dexie.js 5,495, yargs 3,343) | nestjs/nest `integration/query-method/e2e/query-method-fastify.spec.ts:92` | The compiler binds nothing at the site (C-28). Four of the ten sites are Puppeteer `page.*` calls whose `page` type comes from `puppeteer-core/internal/*` build output. Two are Dexie calls through its self-import of `dexie`. Two are `it.each(...)(…)` / `describe.each(...)(…)` returned callables. One is a Nest `expect` that no config declares, and one a yargs fluent chain.<br>Puppeteer, downstream of missing build output: 7,532 (0.52 pp)<br>other pins: 22,077 (1.53 pp) | Not at the site. Recoverable only by fixing the upstream cause (build-output mapping for Puppeteer, about 7,532 links). Returned callables and undeclared globals are ceilings. |
| `external` | 20,954 | 1.45 | 19 (vitest 5,006, turborepo 4,026, vite 3,826) | vercel/turborepo `packages/turbo-gen/scripts/embed-templates.mjs:76` | A declaration outside the checkout with no named library target. In programs that contain a failed file, C-13 withholds every library target: `lines.push`, `process.argv.slice`, `Object.defineProperty`, `.map`, `String(…)` and Vitest matchers in the sample. The rest includes 2,719 `as const` assertions stored as `references` links to `const`.<br>in a program with a failed file (C-13 withholding): 15,263 (1.06 pp)<br>other: 5,691 (0.39 pp) | In failed-file programs: yes, where the target does not depend on the failed file (the taint judge can decide this). `as const` links are a defect: they should not be links at all. |
| `(candidate set)` | 19,157 | 1.33 | 19 (astro 5,221, hono 2,146, zod 1,813) | vitejs/vite `packages/vite/src/shared/moduleRunnerTransport.ts:267` | Several declarations. Most are one global name declared by several environment typings (DOM, `@types/node`, `bun-types`): `Response`, `URL`, `console.log`, `AbortController`, `WebSocket`.<br>one global name, several library typings: 14,366 (0.99 pp)<br>checkout candidates only: 2,794 (0.19 pp)<br>other library or mixed sets: 1,997 (0.14 pp) | Not as one declaration. Crediting a global declared by several typings would need a policy ruling. Checkout-only sets are real alternatives. |
| `incomplete-config` | 17,225 | 1.19 | 6 (turborepo 14,626, astro 1,321, redux-toolkit 1,167) | vercel/turborepo `packages/turbo-workspaces/__tests__/index.test.ts:286` | The owning config `extends` a config by package name, and the module records the extended settings as missing. In Turborepo, each example is its own pnpm workspace with its own lockfile, so the root install does not link it; the extended `@repo/typescript-config/*.json` is in the checkout, named by the example's `pnpm-workspace.yaml`. In Astro, the examples are installed and linked (`examples/ssr/node_modules/astro` points to `packages/astro`), and `astro/tsconfigs/strict` is in the checkout, but the module still records it as missing (a defect: the file is reached through the installed workspace link and its name does not match the `*tsconfig*.json` context pattern). Redux Toolkit's Expo examples extend `expo/tsconfig.base`, which is not installed.<br>Turborepo example workspaces (config package in the checkout, workspace not installed): 14,626 (1.01 pp)<br>Astro (config reached through an installed workspace link): 1,321 (0.09 pp)<br>other pins (uninstalled external packages): 1,278 (0.09 pp) | Turborepo and Astro: yes, the extended config is in the checkout. Redux Toolkit's Expo examples: no, missing material. |
| `any-receiver` | 15,999 | 1.11 | 19 (mermaid 3,807, turborepo 2,678, Dexie.js 1,863) | yargs/yargs `test/command.mjs:1718` | The receiver is typed `any`: untyped JavaScript (Mermaid's d3 `svgDraw.js`, yargs' chai `should`), minified build fixtures in Turborepo, untyped helpers. | Mostly no. There is no static type. A small part may be recoverable by tracing the value's origin. |
| `workspace-entry-unavailable` | 10,380 | 0.72 | 9 (vitest 6,865, Dexie.js 871, trpc 818) | vitest-dev/vitest `test/browser/fixtures/expect-dom/toHaveStyle.test.ts:208` | A sibling workspace package's entry is build output that is not present. Vitest's own tests import `vitest`, whose declarations are a rollup (C-25 withholds rollups); Changesets, Dexie, tRPC and Vite have similar entries. | Only with the build output, or with an assumption-marked source mapping (C-25 extended to rollups). |
| `external-package` | 6,332 | 0.44 | 16 (Dexie.js 3,149, turborepo 984, react-hook-form 516) | vitest-dev/vitest `test/e2e/fixtures/conditions-projects/project-a/basic.test.js:8` | A package that is not installed. Dexie's tests import `QUnit` (the package is `qunit`) and its own built `dexie`; test fixtures name fixture packages that are not installed. | No. Missing material. |
| `workspace-build-output-missing` | 4,632 | 0.32 | 9 (astro 2,392, puppeteer 1,202, hono 308) | puppeteer/puppeteer `test-d/ElementHandle.test-d.ts:698` | Exports reached through a workspace package's missing build output: Astro fixtures' `astro/config`, Puppeteer's internal paths. | Only through an assumption-marked source mapping. |
| `missing-module` | 2,943 | 0.20 | 17 (mermaid 1,351, astro 452, vite 398) | mermaid-js/mermaid `packages/parser/tests/eventmodeling.test.ts:8` | Imports of CSS, Vue or generated files (Mermaid's generated Langium `ast.js`). | No. These are non-TypeScript assets or generated files. |
| Remaining reasons | 2,207 | 0.15 | | | object-producer-unverified 880, computed-specifier 419, library-member-written 373, untyped-require 249, unresolved-alias 96, deno-import-unverified 77, index-signature 34, unknown-receiver 23, directory-import-not-allowed-in-esm 16, not-a-module 11, createrequire-base 9, ambiguous-project 6, (no reason) 6, dynamic-scope 4, invalid-code 2, target-unavailable 2 | Mixed; together under 0.2 points. |

**Route to 90%.** Each figure is a group's full size, an upper bound: when a cause is fixed, some of its links will fall into another group instead of reaching Level 2.

1. Provable without new assumptions, about 4.23 points (90.02% if all are recovered):
   - library targets withheld in programs that contain a failed file (15,263, 1.06 points);
   - library member calls that name only the package (8,314, 0.58 points);
   - members of checkout object and type literals that lack a graph symbol (an estimated 21,584, 1.49 points);
   - configs extended by package name whose base is in the checkout: Turborepo's example workspaces and Astro's installed workspace link (15,947, 1.10 points).

   Even fully recovered, these only just reach 90%, and that rests on the estimated half of `local`. They are not enough on their own. (Turborepo's figure includes 48 links whose configs fail for other reasons.)
2. Add the assumption-marked build-output route: workspace entries and build output (15,012, 1.04 points), and Puppeteer's links downstream of it (7,532, 0.52 points). That makes about 5.79 points, or 91.58%, which clears 90% with margin.
3. As an alternative to part of step 2: a ruling that a global declared by several environment typings is one target (14,366, 0.99 points).

**Honest ceilings.** These should not become definite under the current definition:

- module links of imports (24,303, 1.68 points), which name a module, never a symbol;
- receivers typed `any`, most of the no-symbol group (returned callables, undeclared globals, values downstream of other failures), and real candidate sets;
- missing material under the scripts-disabled install: `external-package`, `missing-module` and the configs that extend uninstalled packages.

microsoft/TypeScript contributes no installed figure: it reached the 60-minute limit again.

## Defects found, not fixed

- **`as const` creates links.** 2,719 `as const` assertions across 19 pins
  are stored as unresolved `references` links named `const`, with reason
  `external`. An assertion is not a reference to a declaration, so these
  links only add misses to the denominator. Removing them would raise the
  headline by about 0.16 points.
- **A config extended through an installed workspace link is treated as
  missing.** Astro's examples extend `astro/tsconfigs/strict`.
  `examples/ssr/node_modules/astro` links to `packages/astro`, and the
  extended file is in the checkout. The module still records "extends ... from
  an external package; node_modules is never captured" for 1,321 links in
  107 files. The file is reached through the installed link, and its name
  does not match the `*tsconfig*.json` context pattern.
- **C-13 withholding is the largest provable item.** In a program that
  contains a failed file, every library target is withheld. That is 15,263
  `external` links (1.06 points), mostly in Vitest, Turborepo, Vite, Astro
  and Puppeteer. C-32 already lists this as further work.
- **The plan generator hard-codes the archive name.** It writes `sw-5` into
  two evidence links. The SW-6 post-step rewrites them instead of changing
  the generator.

## Checks

- `npm run format:check` passes.
- The sweep tests pass, including the byte-for-byte plan regeneration, now
  from the SW-6 archive and post-step. A new test checks that SW-6 replaces
  every installed TypeScript receipt and keeps the bare, Go-toolchain and
  sample parts of SW-5's archive.
