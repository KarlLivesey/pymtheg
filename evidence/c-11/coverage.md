# Level 2 on nine completed pins

This table compares nine completed candidate pins with the archived 0.1.0
SW-3 baseline. The shared-site column restricts C-11 to the same stored
source sites. The two count columns show definite library links on the
candidate graph.

| Repository | 0.1.0 Level 2 | C-11 Level 2 | C-11 shared Level 2 | Stored symbol | Stored unit only |
| --- | ---: | ---: | ---: | ---: | ---: |
| changesets/changesets | 39.87% | 15.45% | 15.20% | 144 | 26 |
| colinhacks/zod | 71.00% | 84.59% | 84.48% | 18,827 | 607 |
| dexie/Dexie.js | 34.91% | 62.65% | 62.07% | 8,742 | 425 |
| honojs/hono | 36.00% | 63.45% | 62.63% | 11,279 | 325 |
| oclif/core | 63.11% | 78.87% | 78.63% | 3,695 | 397 |
| pingdotgg/t3code | 67.21% | 72.65% | 72.45% | 54,725 | 12,005 |
| pmndrs/zustand | 54.38% | 67.28% | 65.94% | 2,051 | 385 |
| react-hook-form/react-hook-form | 41.14% | 45.55% | 42.28% | 6,977 | 5,728 |
| yargs/yargs | 33.41% | 43.32% | 43.07% | 1,320 | 105 |
| **Total** | **55.47%** | **67.23%** | **66.70%** | **107,760** | **20,003** |

The release credited 244,402 of 440,572 links. C-11 credits 301,058 of
447,777 links, or 293,853 of the 440,572 shared links. The all-sites
denominators compare the released graph with a build that includes the
earlier TypeScript changes in C-3 and C-7.

On the T3 Code sweep pin, C-11 preserved all 30,346 main symbol keys,
all 162,711 existing sites and all 63,481 definite checkout destinations.
This sweep pin is separate from the `b387e3a1` default-heap check.

## Previous symbol credit

The paired graph export found 16,950 released Level 2 library credits without
Level 2 credit in C-11. Of these, 14,110 inferred a member without establishing
the owner. The remaining 2,840 name a written export whose outside destination
C-11 withholds for the reasons below.

| Reason | Links | Examples |
| --- | ---: | --- |
| Unproved member owner, now unit only | 11,609 | Hono's `vi.stubGlobal` and `qs.parse` select members from untyped imported values. |
| Unproved deeper member | 2,047 | Dexie's `React.Children.map` and `config.urlConfig.push`, and oclif's `ansis.yellow.bold`, cross an untyped value on the path. |
| Unproved owner under incomplete configuration | 454 | Changesets imports a value and selects a member with no captured declaration. |
| Written export under incomplete configuration | 2,837 | Changesets names `vitest`'s `expect` and `it`, and `jsonc-parser`'s `applyEdits`. The missing base config leaves alias and module resolution open. |
| Written default export under a bundler transform | 2 | T3 Code imports and constructs a `?worker` wrapper in `apps/web/src/components/DiffWorkerPoolProvider.tsx`. The wrapper's export depends on the transformation. |
| Written name omitted by a captured module | 1 | Dexie's `addons/y-dexie/test/unit/dexie-unittest-utils.js:2` imports `config` from `qunit`. The captured module at `addons/y-dexie/test/qunit.d.ts:1` omits that export. |
