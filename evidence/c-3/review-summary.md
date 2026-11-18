# C-3 review evidence

The final candidate tarball had SHA-256
`2a866024d85c694dbe03ecf3be6617fc290efebd70083f2eb51e8d1964bdefb0`.
The source-only sweep reran the nine requested pins, Changesets, and the three
repositories from the second review. Floating UI appeared in the first
review's sample and has no pin in SW-3.
[Initial PR measurements](summary.md)

The build, no-emit check and full `npm test` passed on Node 24.21.0. All
2,948 tests and all 13 sweep-script tests passed. Running the previous and
current exporters on the same 13 release stores produced identical per-repo
observations, including the Level 2 inputs.

## TypeScript and JavaScript Level 2

| Comparison with npm 0.1.0 | Before | After |
| --- | ---: | ---: |
| All stored links | 625,699 / 1,222,034 (51.20%) | 715,915 / 1,239,596 (57.75%) |
| Sites present in both stores | 625,699 / 1,222,034 (51.20%) | 698,353 / 1,222,034 (57.15%) |

The shared comparison uses the pinned checkout, file, span, link kind,
target spelling and origin. Both rates use the sweep's production scoring.
A plain local needs no symbol row or new link site. All 1,096 resolved
plain-local references matched an unresolved `local` reference already
stored by the release. A link to its enclosing symbol carries the binding
name and UTF-16 span. Calls through unresolved local values retain their own
rows. The new scoped references and containment links contribute to the
all-site measure. [Coverage exporter](../../scripts/sweep/coverage-export.mjs)

The generated plan overlay retains 55 of 60 finished graphs. TypeScript and
JavaScript Level 2 rises from 47.83% on main to 52.90%. The archived samples
settle 10 of 37 lexical, 8 of 25 nested-function, and 22 of 28 workspace
reference sites. All three rows remain open. The auxiliary Microsoft/TypeScript
export was validated against its completed cold index counts. The Turborepo
export uses its completed warm result. [Coverage plan](../../docs/coverage-plan.md)

| Repository | All-site Level 2 | Shared-site Level 2 | Symbols before → after | Links before → after | Existing plain refs resolved | Configured output absent | Other workspace entry unavailable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| changesets/changesets | 39.87% → 40.49% | 39.87% → 40.31% | 934 → 961 | 12,609 → 12,646 | 2 | 0 | 1,334 |
| excalidraw/excalidraw | 57.79% → 60.32% | 57.79% → 59.88% | 7,434 → 8,245 | 103,386 → 104,519 | 50 | 60 | 3 |
| honojs/hono | 36.00% → 39.54% | 36.00% → 38.19% | 3,770 → 4,638 | 70,761 → 72,340 | 210 | 371 | 0 |
| mermaid-js/mermaid | 54.56% → 56.75% | 54.56% → 56.45% | 13,466 → 14,271 | 124,766 → 125,657 | 31 | 313 | 0 |
| nestjs/nest | 47.92% → 51.89% | 47.92% → 50.66% | 14,474 → 16,840 | 161,185 → 165,330 | 40 | 0 | 29 |
| pingdotgg/t3code | 67.21% → 68.23% | 67.21% → 67.99% | 18,571 → 19,349 | 161,530 → 162,711 | 22 | 0 | 0 |
| puppeteer/puppeteer | 50.75% → 52.53% | 50.75% → 52.29% | 6,031 → 6,234 | 57,957 → 58,244 | 8 | 1,202 | 0 |
| react-hook-form/react-hook-form | 41.14% → 48.09% | 41.14% → 44.98% | 1,184 → 2,601 | 46,333 → 49,115 | 277 | 216 | 0 |
| reduxjs/redux-toolkit | 39.34% → 42.61% | 39.34% → 41.28% | 5,340 → 6,106 | 55,912 → 57,208 | 109 | 219 | 0 |
| trpc/trpc | 53.31% → 56.63% | 53.31% → 55.97% | 11,167 → 12,173 | 105,855 → 107,470 | 289 | 0 | 119 |
| vitejs/vite | 59.87% → 62.17% | 59.87% → 61.80% | 7,486 → 7,882 | 55,027 → 55,575 | 5 | 24 | 713 |
| vitest-dev/vitest | 36.13% → 66.34% | 36.13% → 66.08% | 13,303 → 13,892 | 115,331 → 116,220 | 19 | 0 | 6,860 |
| withastro/astro | 52.89% → 65.50% | 52.89% → 65.23% | 17,473 → 18,237 | 151,382 → 152,561 | 34 | 4,067 | 0 |

All 120,633 previous TypeScript symbol identities were present. The 10,796
new symbols comprise 9,371 functions, 1,417 classes and 8 enums. Their
targets receive 18,435 call links, 10,796 containment links, 7,189 references
and 64 heritage links. The first PR's plain lexical representation
created 256,575 new definite lexical references on its nine repositories.
The final plain-local representation reuses link rows instead.

A requirement link created by npm 0.1.0 kept its ID and reported `ok` at
line 2 after upgrading and inserting a callback's same-named helper ahead
of the original line 1 declaration. The named `useEffect` regression checks
both the linked location and graph ID after an earlier sibling is inserted.

React Hook Form's `src/__tests__/useForm.test.tsx` has 79 symbols, up from 3.
The 76 additions are scoped declarations. Search for `onSubmit` has 69
matches, 67 of them scoped. The existing two declarations come first within
the bounded results.

The workspace reason totals are 6,472 links to absent configured outputs
and 9,058 other unavailable entries. These counts include reasons qualified
by an incomplete config. The compiler's failed lookup must touch a configured
output directory for the build-output classification. Vitest's 6,860 links
are in the generic count.

The recheck restored 108 of the 110 originally changed targets. The two
remaining changes are merged Vitest type references. The complete comparison
found two further entry corrections in the same repository. All 20
freshly sampled definite links matched the pinned source.
[Changed sites](review-changed-sites.md) · [Source audit](review-source-audit.md)

## Cost against main

The same-session runs supersede these paired timings from a loaded shared
server. This section records the earlier observations.
[Same-session measurements and profile](cost-profile.md)

The paired passes used main `32ca757` and the candidate tarball, fresh copies
of the same pins, Node 24.21.0 with its default heap, and `--trace-gc` on both
sides. Cold wall time includes disk waits on the shared dev server.

| Repository | Cold wall seconds | Peak RSS MiB | User CPU seconds | Largest heap after a full GC, MiB |
| --- | ---: | ---: | ---: | ---: |
| Vitest | 587.03 → 1,091.00 | 1,349 → 1,742 | 116.28 → 125.70 | 393.2 → 407.4 |
| Astro | 813.30 → 1,553.92 | 1,292 → 1,777 | 91.78 → 135.83 | 303.8 → 377.3 |

The paired results exceed the approximately 15% target on cold wall time and
peak RSS for both pins. The final sweep's cold observations were 384.29 s and
1,981 MiB for Vitest, and 509.56 s and 1,596 MiB for Astro. Those observations
came from a different load on the same shared server. The source-only profile
of the review iteration found more compiler scanning, binding and garbage
collection after workspace source became visible. The analyzer now keeps the
original parse cache while releasing the original checker before the
assumption-checking pass.

T3 Code `b387e3a1` completed on the default 4,288 MiB Node heap in C-2's
own-code scope, with `.repos` excluded. The run finished 7,214 files and
stored 106,184 symbols and 1,164,220 links. It reported zero failed files and
1,488 partial files. The largest observed heap immediately before a full GC
was 3,653.9 MiB, and the largest after one was 2,582.7 MiB. Peak RSS was
4,466 MiB over 3,484.50 s. The earlier full-checkout main run included the
third-party copies and exhausted the default heap on 27,468 TypeScript
files. [C-2 scope and observations](../c-2/summary.md)
