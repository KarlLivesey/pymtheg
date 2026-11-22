# SW-6 Installed TypeScript coverage refresh and remaining-work list

SW-6 re-runs the installed TypeScript sweep on current main (`2dc05be`, with
C-30, C-32 and C-33). Per D19, the installed figure is the headline. The
sweep covers the 20 TypeScript pins, using the SW-5 runner and install
policy. It changes nothing under `src/` or `test/`. The splits behind the
remaining-work list come from a second installed run of the same commit,
whose group totals match the archive exactly.
[Evidence](../../evidence/sw-6/README.md)

## Headline

Installed Level 2 on the 20 TypeScript pins is **85.79%** without library
module links (1,238,834 of 1,444,057 links), and **87.47%** with them
(1,263,137). Library module links are the 24,303 import links whose
referent is the library module itself, which count at Level 2 under D20.

- **Proven:** 81.72%.
- **Assumption-marked:** 4.07%.
- **Library module links:** 1.68%. Of these, 231 (0.02 points) name an
  imported member with only the package; the archive cannot separate them,
  so the figure with library module links includes them.
- **Change since SW-5:** from 85.23% without library module links. Like
  for like on SW-5's 18 contributing pins (without Turborepo's newly
  counted links), the figure is 87.28%.
- **Pins:** 19 of 20 contribute links. microsoft/TypeScript reached the
  60-minute limit again in its single attempt.
- **Turborepo:** the full mixed-language index now finishes inside the limit
  (1,755 s, peak 5,529 MiB). Its 53,495 TypeScript links are 46.98% Level 2,
  which pulls the headline down.
- **Bare figure** (secondary, reused from SW-4 and not re-run): 70.42%
  without library module links, 72.01% with them.
- **Gap to 90%:** 60,818 Level 2 links (4.21 points) without library module
  links, 36,515 (2.53 points) with them.

Across all pins, with and without library module links:

| Language | Mode | Without | With library module links |
| --- | --- | ---: | ---: |
| TypeScript / JavaScript (20 own pins) | Installed | 85.79% | 87.47% |
| TypeScript / JavaScript (20 own pins) | Bare | 70.42% | 72.01% |
| Go | Bare | 91.94% | 93.92% |
| Go | Offline toolchain | 92.58% | 94.56% |
| Rust | Source only | 44.60% | 44.61% |

Go has 39,683 library module links (`import "pkg"`). Rust has 224
(`extern crate` and `use` of a crate). The archive inventory cannot tell a
`use` of a whole crate from a glob of one of its modules, so all 224 are
counted. That is 0.01 points.

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

Installed Level 2 on the 20 TypeScript pins is **85.79%** without library module links (1,238,834 of 1,444,057 links; 81.72% proven, 4.07% assumption-marked). With the 24,303 library module links (1.68 points) that D20 counts, it is **87.47%**. Reaching 90% needs 60,818 more Level 2 links (4.21 points) without them, or 36,515 (2.53 points) with them. One point is 14,441 links. The bare figure is SW-4's, not re-run.

The graphs show what the library module links name: 20,213 name the module specifier and 3,859 are whole-module bindings (`import * as`, `require`, `export * from`). The other 231 (0.02 points) name an imported member or `default` with only the package, or a `/// <reference lib>`. D20 does not credit these, but the archive inventory cannot tell them apart, so the figure with library module links includes them. [Check](../../evidence/sw-6/module-links.json)

Each group is the first stored blocker, counted exactly over the 19 pins that finished. The table leaves out the library module links, which are Level 2 under D20. Shapes come from 10 sites per group at seed `pymtheg-sw6-2026`, read in the pinned source, and from mechanical splits where the stored facts allow. Splits marked estimate rest on those 10 sites only. [Sites](../../evidence/sw-6/remaining-sites.json) · [Verdicts](../../evidence/sw-6/verdicts.json)

| First stored reason | Links | Points | Pins (largest) | Example | Shape and split | Provable from source and installed declarations? |
| --- | ---: | ---: | --- | --- | --- | --- |
| `local` | 43,168 | 2.99 | 19 (redux-toolkit 6,503, react-hook-form 5,249, vitest 4,292) | vercel/turborepo `packages/turbo-codemod/__tests__/get-turbo-upgrade-command.test.ts:722` | The checker selects a declaration in the checkout that has no graph symbol. Five of the ten sites call a member of an object literal or a type literal (`api.util.invalidateTags`, `actionDecreaseFontSize.keyTest`, `signal1.resolve`, `api.persistence.removeSavedEnvironmentSecret`, an inline `AppRouterInputs` type). The other five call a local or destructured binding (`setCount`, `handleSubmit`, `unregisterRight`, `useFixture`, `subscription`).<br>members of object or type literals (estimate, 5 of 10 sites): 21,584 (1.49 pp)<br>calls of local or destructured bindings (estimate, 5 of 10 sites): 21,584 (1.49 pp) | Members: yes. The declaration is proved and needs a graph anchor of its own (a real declared member, not padding). Local bindings: only by tracing the value to its origin. |
| `no-symbol` | 29,609 | 2.05 | 19 (puppeteer 7,532, Dexie.js 5,495, yargs 3,343) | nestjs/nest `integration/query-method/e2e/query-method-fastify.spec.ts:92` | The compiler binds nothing at the site (C-28). Four of the ten sites are Puppeteer `page.*` calls whose `page` type comes from `puppeteer-core/internal/*` build output. Two are Dexie calls through its self-import of `dexie`. Two are `it.each(...)(…)` / `describe.each(...)(…)` returned callables. One is a Nest `expect` that no config declares, and one a yargs fluent chain.<br>Puppeteer, downstream of missing build output: 7,532 (0.52 pp)<br>other pins: 22,077 (1.53 pp) | Not at the site. Recoverable only by fixing the upstream cause (build-output mapping for Puppeteer, about 7,532 links). Returned callables and undeclared globals are ceilings. |
| `external` | 20,954 | 1.45 | 19 (vitest 5,006, turborepo 4,026, vite 3,826) | vercel/turborepo `packages/turbo-gen/scripts/embed-templates.mjs:76` | A declaration outside the checkout with no named library target. Where the link carries C-13's `no-unseen-declarations` marker, its program contains an unread file and C-13 withholds the library target: `lines.push`, `process.argv.slice`, `Object.defineProperty`, `.map`, `String(…)` and Vitest matchers in the sample. `as const` assertions, stored as `references` links to `const` with or without the marker, are their own part. (The file result's `failedFiles` is module-wide, so it cannot tell these apart.)<br>carries the C-13 marker (computed beside an unread file), without `as const`: 13,883 (0.96 pp)<br>`as const` assertions: 2,665 (0.18 pp)<br>no marker, without `as const`: 4,406 (0.31 pp) | Marked links: yes, where the target does not depend on the unread file (C-39 item 4 decides this per link). `as const` links are a defect: they should not be links at all. |
| `(candidate set)` | 19,157 | 1.33 | 19 (astro 5,221, hono 2,146, zod 1,813) | vitejs/vite `packages/vite/src/shared/moduleRunnerTransport.ts:267` | Several declarations. Most are one global name declared by several environment typings (DOM, `@types/node`, `bun-types`): `Response`, `URL`, `console.log`, `AbortController`, `WebSocket`.<br>one global name, several library typings: 14,366 (0.99 pp)<br>checkout candidates only: 2,794 (0.19 pp)<br>other library or mixed sets: 1,997 (0.14 pp) | Not as one declaration. Crediting a global declared by several typings would need a policy ruling. Checkout-only sets are real alternatives. |
| `incomplete-config` | 17,225 | 1.19 | 6 (turborepo 14,626, astro 1,321, redux-toolkit 1,167) | vercel/turborepo `packages/turbo-workspaces/__tests__/index.test.ts:286` | The owning config `extends` a config by package name, and the module records the extended settings as missing. The cause is that `project.ts` treats every package-name `extends` as external without resolving it. A second barrier is that the context capture only matches `*tsconfig*.json` names, so a base such as `astro/tsconfigs/strict.json` is not read even when reached. In Astro, configs under `packages/` and `examples/` extend `astro/tsconfigs/{strict,strictest,base}`, and `astro` is installed as a workspace link into the checkout (`examples/ssr/node_modules/astro` points to `packages/astro`). In Turborepo, the `packages/` configs extend `@turbo/tsconfig/{library,base}.json`, installed as a workspace link. Turborepo's `examples/` are separate pnpm workspaces that the root install does not link. Redux Toolkit's Expo examples extend `expo/tsconfig.base`, which is not installed.<br>Astro, `astro/tsconfigs/*` through an installed workspace link: 1,321 (0.09 pp); next blockers `workspace-build-output-missing` 474, `external` 385, `external-package` 297<br>Turborepo `packages/`, `@turbo/tsconfig/*` through an installed workspace link: 12,410 (0.86 pp); next blockers `external` 7,759, `(none: no other blocker)` 3,859, `no-symbol` 637<br>Turborepo `examples/` (separate workspaces, not installed): 2,168 (0.15 pp); next blockers `external-package` 1,125, `external` 350, `(none: no other blocker)` 239<br>Turborepo `crates/`: 48 (0.00 pp); next blockers `(none: no other blocker)` 17, `no-symbol` 15, `workspace-entry-unavailable` 12<br>other pins (packages that are not installed): 1,278 (0.09 pp) | Astro and Turborepo `packages/`: yes, the extended config is installed as a workspace link into the checkout. Turborepo `examples/` and Redux Toolkit's Expo examples: no, not installed. |
| `any-receiver` | 15,999 | 1.11 | 19 (mermaid 3,807, turborepo 2,678, Dexie.js 1,863) | yargs/yargs `test/command.mjs:1718` | The receiver is typed `any`: untyped JavaScript (Mermaid's d3 `svgDraw.js`, yargs' chai `should`), minified build fixtures in Turborepo, untyped helpers. | Mostly no. There is no static type. A small part may be recoverable by tracing the value's origin. |
| `workspace-entry-unavailable` | 10,380 | 0.72 | 9 (vitest 6,865, Dexie.js 871, trpc 818) | vitest-dev/vitest `test/browser/fixtures/expect-dom/toHaveStyle.test.ts:208` | A sibling workspace package's entry is build output that is not present. Vitest's own tests import `vitest`, whose declarations are a rollup (C-25 withholds rollups); Changesets, Dexie, tRPC and Vite have similar entries. | Only with the build output, or with an assumption-marked source mapping (C-25 extended to rollups). |
| `(unit only)` | 8,314 | 0.58 | 18 (react-hook-form 4,715, mermaid 1,255, turborepo 779) | react-hook-form/react-hook-form `src/__tests__/useForm/register.test.tsx:1232` | A library member link that names only the package (`screen.getByRole`, `fireEvent.click`, `it.each`, `assert.equal` from `assert/strict`). The module links of imports (`import { Fragment } from "react"`) are also unit-only; they are Level 2 under D20 and are not in this row. | Yes, from the installed declarations the checker selects. |
| `external-package` | 6,332 | 0.44 | 16 (Dexie.js 3,149, turborepo 984, react-hook-form 516) | vitest-dev/vitest `test/e2e/fixtures/conditions-projects/project-a/basic.test.js:8` | A package that is not installed. Dexie's tests import `QUnit` (the package is `qunit`) and its own built `dexie`; test fixtures name fixture packages that are not installed. | No. Missing material. |
| `workspace-build-output-missing` | 4,632 | 0.32 | 9 (astro 2,392, puppeteer 1,202, hono 308) | puppeteer/puppeteer `test-d/ElementHandle.test-d.ts:698` | Exports reached through a workspace package's missing build output: Astro fixtures' `astro/config`, Puppeteer's internal paths. | Only through an assumption-marked source mapping. |
| `missing-module` | 2,943 | 0.20 | 17 (mermaid 1,351, astro 452, vite 398) | mermaid-js/mermaid `packages/parser/tests/eventmodeling.test.ts:8` | Imports of CSS, Vue or generated files (Mermaid's generated Langium `ast.js`). | No. These are non-TypeScript assets or generated files. |
| Remaining reasons | 2,207 | 0.15 |  |  | object-producer-unverified 880, computed-specifier 419, library-member-written 373, untyped-require 249, unresolved-alias 96, deno-import-unverified 77, index-signature 34, unknown-receiver 23, directory-import-not-allowed-in-esm 16, not-a-module 11, createrequire-base 9, ambiguous-project 6, (no reason) 6, dynamic-scope 4, invalid-code 2, target-unavailable 2 | Mixed; together under 0.2 points. |

**Route to 90%.** Each figure is a group's full size, an upper bound: when a cause is fixed, some of its links will fall into another group instead of reaching Level 2.

1. Provable without new assumptions, about 3.98 points (89.77% without library module links, 91.45% with them, if all are recovered):
   - library targets withheld beside an unread file, the links that carry C-13's per-link marker (13,883, 0.96 points);
   - library member calls that name only the package (8,314, 0.58 points);
   - members of checkout object and type literals that lack a graph symbol (an estimated 21,584, 1.49 points);
   - configs extended by package name whose base is installed as a workspace link: Astro's `astro/tsconfigs/*` and Turborepo's `packages/` extending `@turbo/tsconfig/*` (13,731, 0.95 points).

   Without library module links, even full recovery, including the estimated half of `local`, comes to 89.77%. With them, the three exactly counted items (35,928 links) come to 89.96%, so reaching 90% also needs about 587 of the estimated `local` members.

2. Add the assumption-marked build-output route: workspace entries and build output (15,012, 1.04 points), and Puppeteer's links downstream of it (7,532, 0.52 points). That makes about 5.54 points (91.33% without library module links, 93.02% with them).
3. As an alternative to part of step 2: a ruling that a global declared by several environment typings is one target (14,366, 0.99 points).

**Honest ceilings.** These should not become definite under the current definition:

- receivers typed `any`, most of the no-symbol group (returned callables, undeclared globals, values downstream of other failures), and real candidate sets;
- missing material under the scripts-disabled install: `external-package`, `missing-module`, and the configs that extend packages that are not installed (Turborepo's `examples/` workspaces, Redux Toolkit's Expo examples).

microsoft/TypeScript contributes no installed figure: it reached the 60-minute limit again.

## Defects found, not fixed

- **`as const` creates links.** 2,719 `as const` assertions across 19 pins
  are stored as unresolved `references` links named `const`: 2,665 with
  reason `external` (84 of them beside an unread file) and 54 with
  `incomplete-config`. An assertion is not a reference to a declaration, so
  these links only add misses to the denominator. Removing them would raise
  the headline by about 0.16 points. `const-count.mjs` regenerates the count.
- **A config extended by package name is never resolved.** `project.ts`
  (lines 860–863 at the measured commit) treats every package-name `extends`
  as external without trying to resolve it. It records "extends ... from an
  external package; node_modules is never captured" even when the package
  is a workspace link into the checkout. This affects about 13,731 links
  (0.95 points):
  - Astro: 1,321 links extending `astro/tsconfigs/strict` (773),
    `strictest` (415) and `base` (133), under `packages/` and `examples/`;
  - Turborepo `packages/`: 12,410 links extending `@turbo/tsconfig/library.json`
    (12,161) and `base.json` (249).

  A second barrier stands behind the first: the context capture matches only
  `*tsconfig*.json` names, so a base such as `astro/tsconfigs/strict.json`
  would not be read even once reached. The stored `reasonWithoutConfig`
  gives the next blockers:
  - Astro: `workspace-build-output-missing` 474, `external` 385,
    `external-package` 297;
  - Turborepo `packages/`: `external` 7,759, `no-symbol` 637,
    `workspace-entry-unavailable` 114.

  3,859 of the Turborepo links and 64 of Astro's have no other blocker.
  The other `incomplete-config` links are not this defect:
  - Turborepo's 2,168 `examples/` links are separate pnpm workspaces that
    the root install does not link;
  - Turborepo's 48 `crates/` links fail on relative bases and paths;
  - the other pins extend packages that are not installed (Redux Toolkit's
    Expo and React Native examples, 1,167).

- **C-13 withholding.** In a program that contains an unread file, the
  module withholds library targets and stamps the
  `no-unseen-declarations` marker on each link it computes. Split by that
  per-link marker, 13,967 `external` links carry it, 13,883 without
  `as const` (0.96 points). They are in Vitest (4,599), Turborepo (3,916),
  Vite (3,564), Astro (988) and Puppeteer (900).

  The first version of this note gave 15,263. That split used the file
  result's `failedFiles`, which is module-wide: it marks every file of a
  module with any failed file, so it counted links from programs with no
  unread file. On those five pins, 1,296 such links were counted (1,186 of
  11,237 on the four pins other than Turborepo). The
  corrected split is in `unseen-split.json`. C-39 item 4 addresses this
  group.

## Fixed in this pull request

- **The plan generator hard-coded the archive name.** It wrote `sw-5` into
  two evidence links. `coverage.mjs --plan` now takes the archive folder
  from the `--results` path, and `renderPlan` accepts it. The SW-6
  post-step no longer rewrites the links.
- **D20, library module links.** `coverage-rules.mjs` counts them as a
  separate part, `libraryModuleLinks`: an `imports` link whose library unit
  is named, with no symbol and no stored reason. The plan shows the part per
  language beside proven and assumption-marked, and gives each figure and
  gap with and without it. Tests cover each language and check that a
  member link naming only its package stays below Level 2.

## Checks

- `npm run format:check` passes.
- The sweep tests pass, including the byte-for-byte plan regeneration, now
  from the SW-6 archive and post-step, and the D20 test. A new test checks that SW-6 replaces
  every installed TypeScript receipt and keeps the bare, Go-toolchain and
  sample parts of SW-5's archive.
