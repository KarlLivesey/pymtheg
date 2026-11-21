# C-28 evidence: TypeScript `no-symbol` links

[Change note](../../docs/changes/C-28.md) · [Hand-check](hand-check.md) · [Summary data](summary.json)

This chunk changes no product code. Everything here describes main
`5364e87`, measured on the dev server on 21 November 2026.

## Files

- `pins.json`: the sweep manifest subset (10 TypeScript-module pins at their
  sweep commits).
- `diagnose.patch`: the diagnosis-only change to
  `src/graph/languages/typescript/extract.ts`. It adds a `diag` fact to every
  link whose final reason is `no-symbol`, recording what the compiler knows at
  the site and, for an error-typed receiver, the traced origin of the error.
  It is not part of the product.
- `summary.json`: per mode and pin, the TypeScript link count, the Level 2
  count and the `no-symbol` count from main's own run. It also gives each
  class/detail count from the diagnosis run, the bundle counts, and
  `diagnosisSameOutcomes`. That flag is true when the diagnosis build's
  resolution × reason counts equal main's. They are equal on all 19 finished
  attempts.
- `hand-check.md`, `hand-check-installed.jsonl`, `hand-check-bare.jsonl`:
  the 60 reviewed sites.
- `computed-key-calls-installed.txt`: the 97 installed computed-key calls
  whose selected signature is a named checkout function or method. About 70
  of them use a constant symbol key.
- `tools/`: `classify.mjs` exports and labels the `no-symbol` links of a
  run. `summary.mjs` counts them. `tables.mjs` renders the tables below.
  `draw.mjs` makes the fixed-seed draw. `owner.mjs` prints the owning
  config the project model assigns to a file. `keys.mjs` lists the
  computed-key calls.

## Reproduce

All commands run on the dev server from the mirrored tree. `$S` is a scratch
directory. `$S/main` is a built copy of main. `$S/diag` is the same copy
with `diagnose.patch` applied and built.

```sh
node scripts/sweep/run.mjs --manifest evidence/c-28/pins.json --scratch $S/sw \
  --local-build $S/main --output $S/main-bare.json --parallel 4
node scripts/sweep/run.mjs --manifest evidence/c-28/pins.json --scratch $S/sw \
  --local-build $S/main --installed --output $S/main-inst.json --parallel 4
node scripts/sweep/run.mjs --manifest evidence/c-28/pins.json --scratch $S/sw \
  --local-build $S/diag --output $S/diag3-bare.json --parallel 4
node scripts/sweep/run.mjs --manifest evidence/c-28/pins.json --scratch $S/sw \
  --local-build $S/diag --installed --output $S/diag3-inst.json --parallel 4
node evidence/c-28/tools/classify.mjs $S/diag3-bare.json $S/diag3-bare-ns.jsonl $S/sw
node evidence/c-28/tools/classify.mjs $S/diag3-inst.json $S/diag3-inst-ns.jsonl $S/sw
node evidence/c-28/tools/summary.mjs $S summary.json diag3
node evidence/c-28/tools/tables.mjs summary.json
node evidence/c-28/tools/draw.mjs $S/diag3-inst-ns.jsonl $S/diag3-inst.json $S/sw 10 \
  pymtheg-c28-2026 receiver-error,undeclared-name,computed-callee,missing-property
node evidence/c-28/tools/draw.mjs $S/diag3-bare-ns.jsonl $S/diag3-bare.json $S/sw 10 \
  pymtheg-c28-2026 receiver-error,computed-callee
```

Main reproduces the SW-4 `no-symbol` counts exactly on all ten bare pins.
The summary prints its per-pin line to standard output before the JSON.

## Classes

Each link gets one class and one detail (`summary.mjs`, function
`reported`):

- **error-receiver**: a member whose receiver has the compiler's error type.
  The detail is the traced origin. It is `module:<stored reason>` for an
  import whose module failed, `undeclared-root` for a chain starting at an
  undeclared name, and `untraced` when the trace ends elsewhere: a `lib`
  generic, a contextual parameter, a depth limit.
- **anonymous-callee**: the callee is an expression. The detail is
  `immediately-invoked-function`, `returned-callable` (a call or `new`
  result), `computed-key:named-checkout-signature` or `computed-key:other`
  (element access with a non-literal key), `qualified-name` (an unresolved
  qualified type name), or `other:<syntax>`.
- **undeclared-name**: a bare name the owning program does not declare. The
  detail is `test-global`, `runtime-global` (a name Node itself defines) or
  `other`.
- **undeclared-member**: the receiver's type is known and lacks the
  property. The detail is `javascript` (a JS file), `index-signature-arm`, or
  the receiver's type form.
- **merged-variants**: a link merged across several configurations. The merge
  drops the diagnosis fact.
- **other-receiver**: an `any`, `never` or `unknown` receiver.

A file is counted as bundled or minified when it sits under `dist/`,
`public/libs/`, `static/` or `vendor/`, is a `*.min.js` file, has an
8-character hashed asset suffix, or has a line over 1,000 characters. The
counts include these files. The tables report them separately.

## Tables

### bare

| Class | Detail | Total | zod | Dexie.js | hono | nest | pocketbase | puppeteer | redux-toolkit | trpc | vitest | astro |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| error-receiver | undeclared-root | 49,527 | 98 | 294 | 7,888 | 20,038 | 8,706 | 284 | 5,975 | 5,295 | 736 | 213 |
| error-receiver | untraced | 13,856 | 143 | 1,100 | 191 | 1,211 | 2,912 | 1,243 | 2,184 | 1,366 | 1,747 | 1,759 |
| error-receiver | module:external-package | 10,778 | 159 | 3,296 | 156 | 1,229 | 8 | 325 | 273 | 1,443 | 879 | 3,010 |
| error-receiver | module:workspace-build-output-missing | 6,484 | — | — | 170 | — | — | 6,261 | 29 | — | — | 24 |
| error-receiver | module:resolved-no-declaration | 1,152 | — | 1 | 8 | — | — | 42 | 42 | — | 1,054 | 5 |
| error-receiver | module:workspace-entry-unavailable | 596 | 8 | 510 | — | 2 | — | — | — | 35 | 41 | — |
| error-receiver | module:untyped-require | 567 | — | — | — | 567 | — | — | — | — | — | — |
| error-receiver | module:missing-module | 352 | — | 36 | 201 | — | — | 3 | — | 86 | 3 | 23 |
| error-receiver | module:deno-import-unverified | 9 | — | — | — | — | — | — | — | 9 | — | — |
| anonymous-callee | immediately-invoked-function | 5,058 | 8 | 27 | 21 | 37 | 4,820 | 33 | 18 | 26 | 56 | 12 |
| anonymous-callee | returned-callable | 2,566 | 66 | 187 | 176 | 819 | 151 | 149 | 239 | 338 | 378 | 63 |
| anonymous-callee | qualified-name | 564 | 1 | 1 | 12 | 449 | — | — | 34 | 34 | 10 | 23 |
| anonymous-callee | computed-key:other | 395 | 11 | 47 | 20 | 76 | 60 | 7 | 42 | 81 | 28 | 23 |
| anonymous-callee | other:ConditionalExpression | 127 | — | 9 | 2 | — | 105 | 10 | — | — | — | 1 |
| anonymous-callee | computed-key:named-checkout-signature | 89 | — | — | 2 | — | 4 | 60 | — | 1 | 11 | 11 |
| anonymous-callee | other:BinaryExpression | 39 | 2 | 3 | 9 | — | 17 | — | 1 | 1 | 6 | — |
| anonymous-callee | other:TaggedTemplateExpression | 31 | — | — | 18 | — | — | — | — | — | 13 | — |
| anonymous-callee | other:SuperKeyword | 30 | — | 13 | — | 5 | — | 3 | 1 | — | 7 | 1 |
| anonymous-callee | other:ClassExpression | 16 | — | — | — | 12 | — | — | — | 1 | 3 | — |
| anonymous-callee | other:PropertyAccessExpression | 9 | — | 2 | — | — | — | — | 5 | — | 2 | — |
| anonymous-callee | other:AwaitExpression | 1 | — | — | — | 1 | — | — | — | — | — | — |
| anonymous-callee | other:ThisKeyword | 1 | — | — | — | — | — | — | — | — | 1 | — |
| anonymous-callee | other:ExpressionWithTypeArguments | 1 | — | — | — | — | — | — | — | — | — | 1 |
| undeclared-name | test-global | 5,049 | — | 2 | 27 | 2,835 | — | 2,140 | 26 | — | — | 19 |
| undeclared-name | other | 2,365 | — | 61 | 91 | 3 | 458 | 2 | 1,197 | 519 | 24 | 10 |
| undeclared-name | runtime-global | 414 | — | 1 | — | 31 | — | 47 | — | 6 | 329 | — |
| undeclared-member | javascript | 2,087 | — | 294 | — | — | 1,739 | 8 | 13 | — | 20 | 13 |
| undeclared-member | anonymous | 713 | 1 | — | 33 | 561 | — | 29 | — | 6 | 16 | 67 |
| undeclared-member | reference | 377 | — | 12 | — | 145 | — | 3 | 66 | 18 | 132 | 1 |
| undeclared-member | type-parameter | 112 | — | 9 | 1 | 90 | — | 2 | — | 6 | 2 | 2 |
| undeclared-member | interface | 45 | — | 2 | 2 | — | — | 3 | 5 | 9 | 23 | 1 |
| undeclared-member | mapped | 31 | — | — | 31 | — | — | — | — | — | — | — |
| undeclared-member | index-signature-arm | 28 | 1 | 4 | — | 1 | 2 | 5 | 10 | 4 | 1 | — |
| undeclared-member | primitive | 21 | — | — | — | 8 | — | 11 | — | 1 | 1 | — |
| undeclared-member | union | 15 | — | 2 | — | 2 | — | — | — | 4 | 3 | 4 |
| undeclared-member | intersection | 9 | — | — | 2 | 1 | — | — | — | — | 5 | 1 |
| other-receiver | never | 9 | — | 1 | 2 | 4 | 2 | — | — | — | — | — |
| other-receiver | any | 8 | — | 7 | — | — | — | — | — | 1 | — | — |
| other-receiver | unknown | 2 | — | — | — | — | — | — | — | — | 2 | — |
| **All no-symbol** | | **103,533** | 498 | 5,921 | 9,063 | 28,127 | 18,984 | 10,670 | 10,160 | 9,290 | 5,533 | 5,287 |
| of which in bundled or minified files | | 13,632 | 54 | 231 | — | — | 13,327 | 15 | — | 2 | — | 3 |

| Pin | TypeScript links | Level 2 | Level 2 % | no-symbol | no-symbol % of links |
| --- | ---: | ---: | ---: | ---: | ---: |
| colinhacks/zod | 81,042 | 67,963 | 83.86% | 498 | 0.61% |
| dexie/Dexie.js | 36,431 | 19,940 | 54.73% | 5,921 | 16.25% |
| honojs/hono | 72,340 | 42,129 | 58.24% | 9,063 | 12.53% |
| nestjs/nest | 165,330 | 123,638 | 74.78% | 28,127 | 17.01% |
| pocketbase/pocketbase | 126,519 | 66,268 | 52.38% | 18,984 | 15.00% |
| puppeteer/puppeteer | 58,244 | 37,602 | 64.56% | 10,670 | 18.32% |
| reduxjs/redux-toolkit | 57,208 | 36,541 | 63.87% | 10,160 | 17.76% |
| trpc/trpc | 107,470 | 78,475 | 73.02% | 9,290 | 8.64% |
| vitest-dev/vitest | 116,220 | 89,729 | 77.21% | 5,533 | 4.76% |
| withastro/astro | 152,561 | 117,435 | 76.98% | 5,287 | 3.47% |
| **10 pins** | 973,365 | 679,720 | 69.83% | 103,533 | 10.64% |

### installed

| Class | Detail | Total | Dexie.js | hono | nest | puppeteer | redux-toolkit | trpc | vitest | astro |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| error-receiver | module:workspace-build-output-missing | 6,315 | — | — | — | 6,262 | 29 | — | — | 24 |
| error-receiver | module:external-package | 3,055 | 2,815 | 49 | 45 | 18 | 104 | — | 10 | 14 |
| error-receiver | untraced | 2,799 | 1,032 | 167 | 102 | 968 | 165 | 239 | 102 | 24 |
| error-receiver | undeclared-root | 2,181 | 24 | 6 | 2,116 | 7 | 12 | 8 | 8 | — |
| error-receiver | module:workspace-entry-unavailable | 1,463 | 880 | 170 | 2 | — | — | 332 | 79 | — |
| error-receiver | module:missing-module | 1,068 | 36 | 201 | — | 3 | — | 805 | — | 23 |
| error-receiver | module:untyped-require | 567 | — | — | 567 | — | — | — | — | — |
| error-receiver | module:resolved-no-declaration | 88 | 47 | 8 | 1 | — | 24 | — | 3 | 5 |
| error-receiver | module:deno-import-unverified | 9 | — | — | — | — | — | 9 | — | — |
| anonymous-callee | returned-callable | 2,238 | 187 | 65 | 819 | 149 | 239 | 338 | 378 | 63 |
| anonymous-callee | computed-key:other | 306 | 47 | 13 | 74 | 7 | 44 | 74 | 25 | 22 |
| anonymous-callee | immediately-invoked-function | 230 | 27 | 21 | 37 | 33 | 18 | 26 | 56 | 12 |
| anonymous-callee | computed-key:named-checkout-signature | 97 | — | 2 | 2 | 60 | — | 8 | 14 | 11 |
| anonymous-callee | qualified-name | 26 | 1 | 1 | 7 | — | 12 | 2 | — | 3 |
| anonymous-callee | other:ConditionalExpression | 22 | 9 | 2 | — | 10 | — | — | — | 1 |
| anonymous-callee | other:BinaryExpression | 20 | 3 | 9 | — | — | 1 | 1 | 6 | — |
| anonymous-callee | other:ClassExpression | 16 | — | — | 12 | — | — | 1 | 3 | — |
| anonymous-callee | other:TaggedTemplateExpression | 13 | — | — | — | — | — | — | 13 | — |
| anonymous-callee | other:SuperKeyword | 9 | 7 | — | 2 | — | — | — | — | — |
| anonymous-callee | other:PropertyAccessExpression | 7 | 2 | — | — | — | 5 | — | — | — |
| anonymous-callee | other:AwaitExpression | 1 | — | — | 1 | — | — | — | — | — |
| anonymous-callee | other:ThisKeyword | 1 | — | — | — | — | — | — | 1 | — |
| anonymous-callee | other:ExpressionWithTypeArguments | 1 | — | — | — | — | — | — | — | 1 |
| undeclared-name | test-global | 2,863 | 2 | — | 2,835 | — | 26 | — | — | — |
| undeclared-name | other | 69 | 61 | 2 | 2 | — | — | — | 1 | 3 |
| undeclared-name | runtime-global | 8 | 1 | — | 7 | — | — | — | — | — |
| undeclared-member | javascript | 324 | 294 | — | — | 8 | 13 | — | 8 | 1 |
| undeclared-member | index-signature-arm | 54 | 4 | — | 2 | 5 | 10 | 2 | 2 | 29 |
| undeclared-member | anonymous | 49 | — | 33 | 16 | — | — | — | — | — |
| undeclared-member | mapped | 31 | — | 31 | — | — | — | — | — | — |
| undeclared-member | reference | 29 | 5 | 2 | 15 | 2 | — | — | 5 | — |
| undeclared-member | interface | 13 | 2 | — | — | — | — | 2 | 9 | — |
| undeclared-member | type-parameter | 11 | 6 | — | 4 | — | — | 1 | — | — |
| undeclared-member | intersection | 3 | — | 2 | — | — | — | — | 1 | — |
| undeclared-member | union | 2 | — | — | — | — | — | — | — | 2 |
| merged-variants | - | 136 | — | 136 | — | — | — | — | — | — |
| other-receiver | any | 7 | 7 | — | — | — | — | — | — | — |
| other-receiver | never | 7 | 1 | 2 | 4 | — | — | — | — | — |
| **All no-symbol** | | **24,138** | 5,500 | 922 | 6,672 | 7,532 | 702 | 1,848 | 724 | 238 |
| of which in bundled or minified files | | 248 | 231 | — | — | 15 | — | 1 | — | 1 |

| Pin | TypeScript links | Level 2 | Level 2 % | no-symbol | no-symbol % of links |
| --- | ---: | ---: | ---: | ---: | ---: |
| dexie/Dexie.js | 36,431 | 20,522 | 56.33% | 5,500 | 15.10% |
| honojs/hono | 72,340 | 46,405 | 64.15% | 922 | 1.27% |
| nestjs/nest | 165,330 | 151,358 | 91.55% | 6,672 | 4.04% |
| puppeteer/puppeteer | 58,244 | 45,437 | 78.01% | 7,532 | 12.93% |
| reduxjs/redux-toolkit | 57,208 | 45,838 | 80.13% | 702 | 1.23% |
| trpc/trpc | 107,470 | 95,508 | 88.87% | 1,848 | 1.72% |
| vitest-dev/vitest | 116,220 | 95,768 | 82.40% | 724 | 0.62% |
| withastro/astro | 152,561 | 130,412 | 85.48% | 238 | 0.16% |
| **8 pins** | 765,804 | 631,248 | 82.43% | 24,138 | 3.15% |
