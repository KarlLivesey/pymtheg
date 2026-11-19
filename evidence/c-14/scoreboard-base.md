# SW-3 coverage scoreboard

Result package ` pymtheg@0.1.0 `. The baseline covers 20 pinned repositories.

## A. All 60 finish

**20 of 20 finished.**


## B. Coverage of finished graphs

Level 2 counts resolved checkout links and named library symbols over all stored links. Level 1 also credits named library units. Strict-inside excludes the proven outside partition. Raw credits only the stored resolved outcome.
The closed-set alternative adds the sample estimate for verified complete candidate sets. Candidate evaluations reuse the reference sample.

| Files counted | Module | Graphs | Level 2 | Level 1 | L2 + verified closed sets (95% interval) | L2 median | Strict-inside weighted / median | Raw |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All files | Go | 20 | 77.81% | 79.96% | 77.81% (77.81%–77.95%) | 76.51% | 83.21% / 81.28% | 67.64% |
| All files | Rust | 0 | — | — | — (—–—) | — | — / — | — |
| All files | TypeScript / JS | 7 | 47.14% | 47.36% | 47.14% (47.14%–47.48%) | 45.94% | 48.61% / 47.51% | 45.02% |
| All files | Overall | 20 | 74.65% | 76.60% | 74.65% (74.65%–74.81%) | 75.86% | 79.20% / 81.22% | 65.31% |
| Without bundles | Go | 20 | 77.81% | 79.96% | 77.81% (77.81%–77.95%) | 76.51% | 83.21% / 81.28% | 67.64% |
| Without bundles | Rust | 0 | — | — | — (—–—) | — | — / — | — |
| Without bundles | TypeScript / JS | 7 | 53.76% | 54.57% | 53.76% (53.76%–54.99%) | 46.57% | 55.01% / 45.99% | 46.15% |
| Without bundles | Overall | 20 | 77.07% | 79.17% | 77.07% (77.07%–77.24%) | 76.16% | 82.31% / 81.22% | 66.98% |
| Without broken fixtures | Go | 20 | 77.81% | 79.96% | 77.81% (77.81%–77.95%) | 76.51% | 83.21% / 81.28% | 67.64% |
| Without broken fixtures | Rust | 0 | — | — | — (—–—) | — | — / — | — |
| Without broken fixtures | TypeScript / JS | 7 | 47.14% | 47.36% | 47.14% (47.14%–47.48%) | 45.94% | 48.61% / 47.51% | 45.02% |
| Without broken fixtures | Overall | 20 | 74.65% | 76.60% | 74.65% (74.65%–74.81%) | 75.86% | 79.20% / 81.22% | 65.31% |
| Without templates | Go | 20 | 77.81% | 79.96% | 77.81% (77.81%–77.95%) | 76.51% | 83.21% / 81.28% | 67.64% |
| Without templates | Rust | 0 | — | — | — (—–—) | — | — / — | — |
| Without templates | TypeScript / JS | 7 | 47.14% | 47.36% | 47.14% (47.14%–47.48%) | 45.94% | 48.61% / 47.51% | 45.02% |
| Without templates | Overall | 20 | 74.65% | 76.60% | 74.65% (74.65%–74.81%) | 75.86% | 79.20% / 81.22% | 65.31% |
| Source only | Go | 20 | 77.81% | 79.96% | 77.81% (77.81%–77.95%) | 76.51% | 83.21% / 81.28% | 67.64% |
| Source only | Rust | 0 | — | — | — (—–—) | — | — / — | — |
| Source only | TypeScript / JS | 7 | 53.76% | 54.57% | 53.76% (53.76%–54.99%) | 46.57% | 55.01% / 45.99% | 46.15% |
| Source only | Overall | 20 | 77.07% | 79.17% | 77.07% (77.07%–77.24%) | 76.16% | 82.31% / 81.22% | 66.98% |

## What the released store says about outside links

Unit and symbol counts are exact on stored links with proof of outside origin. The final column estimates additional outside sites whose current facts name neither.
The audit recovers these identities from paths, import bindings, named declaring traits or directives. The target-ID slot points to a symbol in a captured file. The released graph has no first-class external target nodes.

| Module | Proven outside | Named unit, including L2 | Unit only | Unit and symbol | Neither, proven outside | Additional outside with neither (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | 283,113 | 186,398 | 32,530 | 153,868 | 96,715 | 96,188 (86,116–108,541) |
| Rust | 0 | 0 | 0 | 0 | 0 | 0 (0–0) |
| TypeScript / JS | 12,840 | 4,070 | 393 | 3,677 | 8,770 | 8,707 (3,949–40,204) |
| Overall | 295,953 | 190,468 | 32,923 | 157,545 | 105,485 | 104,894 (92,322–146,488) |

### Recorded library identities by encoding

| Module | Encoding | Level 1 only | Level 2 | Example |
| --- | --- | ---: | ---: | --- |
| Go | path | 32,530 | 0 | charmbracelet/bubbletea ` color.go:4 ` ` image/color ` |
| Go | import-binding | 0 | 153,868 | charmbracelet/bubbletea ` color.go:39 ` ` image/color → Color ` |
| TypeScript / JS | path | 338 | 0 | cli/cli ` .github/extensions/terminal-mockup/extension.mjs:7 ` ` node:http ` |
| TypeScript / JS | import-binding | 55 | 3,677 | cli/cli ` .github/extensions/terminal-mockup/extension.mjs:7 ` ` node:http → createServer ` |

## Source scopes

Counts include every observed link. Broken and template files that produced no links appear in the failed-source column.

| Module | Scope | Resolved | Ambiguous | Inside | Outside | Unclassified | Failed source files |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | source | 1,023,393 | 36,693 | 205 | 221,949 | 230,758 | 3 |
| Go | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Go | broken-fixture | 0 | 0 | 0 | 0 | 0 | 14 |
| Go | template | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | source | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | template | 0 | 0 | 0 | 0 | 0 | 0 |
| TypeScript / JS | source | 22,293 | 1,301 | 893 | 7,773 | 16,049 | 0 |
| TypeScript / JS | bundle | 56,064 | 1 | 20,326 | 5,059 | 44,279 | 0 |
| TypeScript / JS | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| TypeScript / JS | template | 0 | 0 | 0 | 0 | 0 | 0 |

## Repository results

Totals include every module in a finished checkout. For each attempt, the archive holds the full link breakdown and the explicit inside, outside and unclassified counts for every file scope.

| Repository | Selected language | Outcome | Links | Proven outside | Level 2 | Level 1 | Strict-inside | Raw | Source-only L2 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| charmbracelet/bubbletea | Go | finished | 12,533 | 2,460 | 71.84% | 75.78% | 76.91% | 61.81% | 71.84% |
| cilium/ebpf | Go | finished | 50,239 | 11,651 | 78.13% | 81.03% | 86.70% | 66.59% | 78.13% |
| cli/cli | Go | finished | 218,286 | 52,675 | 75.60% | 78.69% | 83.28% | 63.18% | 76.20% |
| cockroachdb/pebble | Go | finished | 214,346 | 35,708 | 76.41% | 78.32% | 84.30% | 70.25% | 78.32% |
| etcd-io/bbolt | Go | finished | 16,898 | 3,955 | 76.12% | 79.12% | 83.06% | 63.62% | 76.12% |
| evanw/esbuild | Go | finished | 118,250 | 11,336 | 87.96% | 88.43% | 92.04% | 83.22% | 87.96% |
| gin-gonic/gin | Go | finished | 21,081 | 7,016 | 69.92% | 72.25% | 77.84% | 51.93% | 69.92% |
| go-task/task | Go | finished | 18,984 | 4,624 | 74.65% | 78.10% | 81.80% | 61.88% | 74.65% |
| gofiber/fiber | Go | finished | 143,673 | 31,981 | 66.17% | 67.80% | 72.04% | 56.00% | 66.17% |
| golang/tools | Go | finished | 253,517 | 57,579 | 76.15% | 78.96% | 79.12% | 61.15% | 76.81% |
| junegunn/fzf | Go | finished | 25,947 | 3,346 | 77.94% | 79.24% | 82.72% | 72.05% | 77.94% |
| labstack/echo | Go | finished | 31,880 | 10,457 | 74.75% | 77.02% | 80.64% | 54.19% | 74.75% |
| mattn/go-sqlite3 | Go | finished | 9,650 | 2,414 | 56.00% | 58.87% | 50.35% | 37.75% | 56.00% |
| pocketbase/pocketbase | Go | finished | 197,148 | 18,266 | 56.88% | 58.00% | 57.59% | 52.26% | 70.41% |
| protocolbuffers/protobuf-go | Go | finished | 217,087 | 10,342 | 84.87% | 85.43% | 86.67% | 82.54% | 84.87% |
| restic/restic | Go | finished | 64,165 | 13,539 | 79.17% | 82.62% | 83.71% | 66.05% | 79.17% |
| samber/lo | Go | finished | 29,697 | 9,152 | 62.74% | 63.75% | 63.72% | 44.09% | 62.74% |
| spf13/cobra | Go | finished | 8,886 | 1,685 | 78.46% | 80.46% | 79.98% | 64.81% | 78.46% |
| stretchr/testify | Go | finished | 19,868 | 3,977 | 79.38% | 80.49% | 81.91% | 65.52% | 79.38% |
| wagoodman/dive | Go | finished | 14,901 | 3,790 | 69.23% | 74.47% | 77.68% | 57.92% | 69.23% |

## Rust failed-file influence

These are exact stored unresolved counts. The eligible column uses the earlier audit disposition. The L2 misses column retains tainted library sites whose symbol is unproved. One site with both failure and receiver reasons belongs to the taint item.

| Repository | Unresolved with failed-file reason | Earlier eligible | L2 misses | Tainted and blocked | Also receiver-unverified | All unresolved marked blocked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |

## Outside-link review checks

These counts use source evidence from the full primary-module breakdown for the SW-1 review cases. For example, yargs imports its own build output, so `missing-module` on those relative paths remains inside. Unproven package links and return types stay unclassified.

| Repository | Outside / unresolved | Outside / unresolved imports |
| --- | ---: | ---: |
| gin-gonic/gin | 5,750 / 9,582 (60.01%) | 490 / 490 |
