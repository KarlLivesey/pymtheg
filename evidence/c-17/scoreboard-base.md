# SW-3 coverage scoreboard

Result package ` pymtheg@0.1.0 `. The baseline covers 20 pinned repositories.

## A. All 60 finish

**20 of 20 finished.**


## B. Coverage of finished graphs

Level 2 counts resolved checkout links and named library symbols over all stored links. The assumed column counts Level 2 links with recorded assumptions. Level 1 also credits named library units. Strict-inside excludes the proven outside partition. Raw credits only the stored resolved outcome.
The closed-set alternative adds the sample estimate for verified complete candidate sets. Candidate evaluations reuse the reference sample.

| Files counted | Module | Graphs | Level 2 | L2 without assumptions | Assumed L2 links | Level 1 | L2 + verified closed sets (95% interval) | L2 median | Strict-inside weighted / median | Raw |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All files | Go | 20 | 84.87% | 84.87% | 0 | 87.02% | 84.87% (84.87%–85.02%) | 84.43% | 83.94% / 81.92% | 67.64% |
| All files | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| All files | TypeScript / JS | 7 | 57.48% | 57.48% | 0 | 57.84% | 57.48% (57.48%–58.01%) | 60.61% | 51.68% / 52.13% | 45.02% |
| All files | Overall | 20 | 82.05% | 82.05% | 0 | 84.01% | 82.05% (82.05%–82.23%) | 84.29% | 80.37% / 81.92% | 65.31% |
| Without bundles | Go | 20 | 84.87% | 84.87% | 0 | 87.02% | 84.87% (84.87%–85.02%) | 84.43% | 83.94% / 81.92% | 67.64% |
| Without bundles | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Without bundles | TypeScript / JS | 7 | 70.81% | 70.81% | 0 | 72.09% | 70.81% (70.81%–72.48%) | 72.88% | 62.52% / 57.07% | 46.15% |
| Without bundles | Overall | 20 | 84.44% | 84.44% | 0 | 86.56% | 84.44% (84.44%–84.63%) | 84.29% | 83.33% / 81.92% | 66.98% |
| Without broken fixtures | Go | 20 | 84.87% | 84.87% | 0 | 87.02% | 84.87% (84.87%–85.02%) | 84.43% | 83.94% / 81.92% | 67.64% |
| Without broken fixtures | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Without broken fixtures | TypeScript / JS | 7 | 57.48% | 57.48% | 0 | 57.84% | 57.48% (57.48%–58.01%) | 60.61% | 51.68% / 52.13% | 45.02% |
| Without broken fixtures | Overall | 20 | 82.05% | 82.05% | 0 | 84.01% | 82.05% (82.05%–82.23%) | 84.29% | 80.37% / 81.92% | 65.31% |
| Without templates | Go | 20 | 84.87% | 84.87% | 0 | 87.02% | 84.87% (84.87%–85.02%) | 84.43% | 83.94% / 81.92% | 67.64% |
| Without templates | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Without templates | TypeScript / JS | 7 | 57.48% | 57.48% | 0 | 57.84% | 57.48% (57.48%–58.01%) | 60.61% | 51.68% / 52.13% | 45.02% |
| Without templates | Overall | 20 | 82.05% | 82.05% | 0 | 84.01% | 82.05% (82.05%–82.23%) | 84.29% | 80.37% / 81.92% | 65.31% |
| Source only | Go | 20 | 84.87% | 84.87% | 0 | 87.02% | 84.87% (84.87%–85.02%) | 84.43% | 83.94% / 81.92% | 67.64% |
| Source only | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Source only | TypeScript / JS | 7 | 70.81% | 70.81% | 0 | 72.09% | 70.81% (70.81%–72.48%) | 72.88% | 62.52% / 57.07% | 46.15% |
| Source only | Overall | 20 | 84.44% | 84.44% | 0 | 86.56% | 84.44% (84.44%–84.63%) | 84.29% | 83.33% / 81.92% | 66.98% |

## What the released store says about outside links

Unit and symbol counts are exact on stored links with proof of outside origin. The final column estimates additional outside sites whose current facts name neither.
The audit recovers these identities from paths, import bindings, named declaring traits or directives. The target-ID slot points to a symbol in a captured file. The released graph has no first-class external target nodes.

| Module | Proven outside | Named unit, including L2 | Unit only | Unit and symbol | Neither, proven outside | Additional outside with neither (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | 293,813 | 293,272 | 32,531 | 260,741 | 541 | 23,756 (20,915–140,275) |
| Rust | 0 | 0 | 0 | 0 | 0 | 0 (0–0) |
| TypeScript / JS | 22,424 | 22,299 | 620 | 21,679 | 125 | 3,527 (968–35,478) |
| Overall | 316,237 | 315,571 | 33,151 | 282,420 | 666 | 27,283 (23,459–174,176) |

### Recorded library identities by encoding

| Module | Encoding | Level 1 only | Level 2 | Example |
| --- | --- | ---: | ---: | --- |
| Go | import-binding | 0 | 211,901 | charmbracelet/bubbletea ` color.go:39 ` ` image/color → Color ` |
| Go | import-path | 32,531 | 0 | charmbracelet/bubbletea ` color.go:4 ` ` image/color ` |
| Go | declared-builtin | 0 | 48,840 | charmbracelet/bubbletea ` commands.go:42 ` ` builtin → append ` |
| TypeScript / JS | import-binding | 0 | 4,338 | cli/cli ` .github/extensions/terminal-mockup/extension.mjs:7 ` ` http → createServer ` |
| TypeScript / JS | import-path | 620 | 0 | cli/cli ` .github/extensions/terminal-mockup/extension.mjs:7 ` ` http ` |
| TypeScript / JS | declared-builtin | 0 | 4,810 | cli/cli ` .github/extensions/terminal-mockup/assets/ansi.js:21 ` ` es → Set ` |
| TypeScript / JS | declaring-owner | 0 | 12,531 | cli/cli ` .github/extensions/terminal-mockup/assets/ansi.js:34 ` ` es → Array.prototype.push ` |

## Source scopes

Counts include every observed link. Broken and template files that produced no links appear in the failed-source column.

| Module | Scope | Resolved | Ambiguous | Inside | Outside | Unclassified | Failed source files |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | source | 1,023,393 | 36,693 | 181 | 293,813 | 158,918 | 3 |
| Go | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Go | broken-fixture | 0 | 0 | 0 | 0 | 0 | 14 |
| Go | template | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | source | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | template | 0 | 0 | 0 | 0 | 0 | 0 |
| TypeScript / JS | source | 22,293 | 1,759 | 888 | 12,652 | 10,717 | 0 |
| TypeScript / JS | bundle | 56,064 | 121 | 20,116 | 9,772 | 39,656 | 0 |
| TypeScript / JS | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| TypeScript / JS | template | 0 | 0 | 0 | 0 | 0 | 0 |

## Repository results

Totals include every module in a finished checkout. For each attempt, the archive holds the full link breakdown and the explicit inside, outside and unclassified counts for every file scope.

| Repository | Selected language | Outcome | Links | Proven outside | Level 2 | L2 without assumptions | Assumed L2 links | Level 1 | Strict-inside | Raw | Source-only L2 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| charmbracelet/bubbletea | Go | finished | 12,533 | 2,956 | 81.33% | 81.33% | 0 | 85.26% | 80.89% | 61.81% | 81.33% |
| cilium/ebpf | Go | finished | 50,239 | 11,802 | 87.15% | 87.15% | 0 | 90.09% | 87.04% | 66.59% | 87.15% |
| cli/cli | Go | finished | 218,286 | 56,064 | 85.68% | 85.68% | 0 | 88.83% | 85.02% | 63.18% | 86.11% |
| cockroachdb/pebble | Go | finished | 214,346 | 38,068 | 86.11% | 86.11% | 0 | 88.01% | 85.43% | 70.25% | 87.47% |
| etcd-io/bbolt | Go | finished | 16,898 | 4,078 | 84.75% | 84.75% | 0 | 87.75% | 83.85% | 63.62% | 84.75% |
| evanw/esbuild | Go | finished | 118,250 | 14,585 | 94.98% | 94.98% | 0 | 95.55% | 94.93% | 83.22% | 94.98% |
| gin-gonic/gin | Go | finished | 21,081 | 7,045 | 83.01% | 83.01% | 0 | 85.34% | 78.00% | 51.93% | 83.01% |
| go-task/task | Go | finished | 18,984 | 4,894 | 84.16% | 84.16% | 0 | 87.63% | 83.37% | 61.88% | 84.16% |
| gofiber/fiber | Go | finished | 143,673 | 34,172 | 78.12% | 78.12% | 0 | 79.75% | 73.48% | 56.00% | 78.12% |
| golang/tools | Go | finished | 253,517 | 58,349 | 81.29% | 81.29% | 0 | 84.09% | 79.43% | 61.15% | 81.83% |
| junegunn/fzf | Go | finished | 25,947 | 3,894 | 85.74% | 85.74% | 0 | 87.05% | 84.77% | 72.05% | 85.74% |
| labstack/echo | Go | finished | 31,880 | 10,471 | 84.69% | 84.69% | 0 | 86.97% | 80.70% | 54.19% | 84.69% |
| mattn/go-sqlite3 | Go | finished | 9,650 | 2,414 | 59.58% | 59.58% | 0 | 62.45% | 50.35% | 37.75% | 59.58% |
| pocketbase/pocketbase | Go | finished | 197,148 | 23,515 | 63.05% | 63.05% | 0 | 64.16% | 59.33% | 52.26% | 76.84% |
| protocolbuffers/protobuf-go | Go | finished | 217,087 | 10,547 | 86.83% | 86.83% | 0 | 87.40% | 86.76% | 82.54% | 86.83% |
| restic/restic | Go | finished | 64,165 | 14,085 | 84.42% | 84.42% | 0 | 87.87% | 84.62% | 66.05% | 84.42% |
| samber/lo | Go | finished | 29,697 | 9,231 | 73.84% | 73.84% | 0 | 74.83% | 63.97% | 44.09% | 73.84% |
| spf13/cobra | Go | finished | 8,886 | 1,723 | 82.20% | 82.20% | 0 | 84.20% | 80.40% | 64.81% | 82.20% |
| stretchr/testify | Go | finished | 19,868 | 3,980 | 84.44% | 84.44% | 0 | 85.55% | 81.93% | 65.52% | 84.44% |
| wagoodman/dive | Go | finished | 14,901 | 4,364 | 81.91% | 81.91% | 0 | 87.16% | 81.91% | 57.92% | 81.91% |

## Rust failed-file influence

These are exact stored unresolved counts. The eligible column uses the earlier audit disposition. The L2 misses column retains tainted library sites whose symbol is unproved. One site with both failure and receiver reasons belongs to the taint item.

| Repository | Unresolved with failed-file reason | Earlier eligible | L2 misses | Tainted and blocked | Also receiver-unverified | All unresolved marked blocked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |

## Outside-link review checks

These counts use source evidence from the full primary-module breakdown for the SW-1 review cases. For example, yargs imports its own build output, so `missing-module` on those relative paths remains inside. Unproven package links and return types stay unclassified.

| Repository | Outside / unresolved | Outside / unresolved imports |
| --- | ---: | ---: |
| gin-gonic/gin | 7,045 / 9,582 (73.52%) | 490 / 490 |
