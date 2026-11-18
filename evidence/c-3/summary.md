# C-3 coverage evidence

The sweep used nine SW-3 pins and fresh graph stores for the public 0.1.0
release and the local candidate. Each checkout ran without installing its
dependencies. Production builds, type checks, tests and corpus runs took place
on the dev server with Node 24.21.0. The candidate tarball's SHA-256 was
`c2679c0f8233736925dadc39cf58821eaa5519339918dc620305d87edcc421f5`.

Level 2 counts resolved checkout targets and identified library symbols across
all stored links. The full-corpus rate overlays the nine candidate graphs on
the SW-3 archive. The comparison matches links by repository commit, source
file, span, kind and written target. It compares target file, kind, identity
and ordinal across separate stores.
[Reproducible comparison](compare.mjs)

The full build and the no-emit TypeScript check passed. The final `npm test`
run passed all 2,937 tests, and the sweep scripts passed 13 tests.

## Coverage and graph size

TypeScript and JavaScript Level 2 rose from **48.02% to 59.01%** in the corpus
overlay and from **51.35% to 65.75%** across the nine rerun repositories.

| Repository | Level 2 before → after | Symbols before → after | Links before → after | Lexical targets | Missing build links | Other unavailable entries |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| excalidraw/excalidraw | 57.79% → 69.26% | 7,434 → 39,015 | 103,386 → 134,923 | 30,699 | 60 | 3 |
| honojs/hono | 36.00% → 49.62% | 3,770 → 20,265 | 70,761 → 86,965 | 15,578 | 371 | 0 |
| mermaid-js/mermaid | 54.56% → 67.78% | 13,466 → 57,448 | 124,766 → 168,674 | 43,118 | 313 | 0 |
| nestjs/nest | 47.92% → 59.71% | 14,474 → 51,520 | 161,185 → 197,612 | 34,430 | 0 | 29 |
| pingdotgg/t3code | 67.21% → 73.94% | 18,571 → 55,616 | 161,530 → 198,402 | 36,116 | 0 | 0 |
| reduxjs/redux-toolkit | 39.34% → 52.87% | 5,340 → 20,670 | 55,912 → 69,819 | 14,528 | 219 | 0 |
| trpc/trpc | 53.31% → 64.94% | 11,167 → 37,947 | 105,855 → 132,932 | 25,667 | 119 | 0 |
| vitest-dev/vitest | 36.13% → 64.09% | 13,303 → 41,379 | 115,331 → 142,342 | 27,283 | 6,856 | 4 |
| withastro/astro | 52.89% → 72.92% | 17,473 → 62,151 | 151,382 → 194,448 | 43,530 | 4,067 | 0 |

The candidate has 256,575 new definite lexical references and resolves
15,259 previously non-definite same-file calls. Another 8,560 newly definite
cross-file links previously carried `external-package`. These counts exclude
structural containment links and results with recorded assumptions.

The compiler probed missing workspace build paths for **12,005 stored links**.
The count includes the underlying reason where an incomplete configuration
qualifies the result. Another 36 links identify a checkout install whose entry
the compiler could not resolve. [Settled SW-3 reference sites](settled.md)

## Source audit

The fixed seed is `c-3:6a32d988`. The draw takes ten previously unresolved or
ambiguous local calls, five newly definite workspace links and five new
lexical references, excluding links that carry assumptions. The source audit
checks the selected binding or export against the pinned checkout. The
comparison script keeps all changed definite links, including those that
become unverified.

All 20 final sampled targets matched the pinned source. An earlier candidate
assigned a Vitest call to an interface signature. The final candidate leaves
that call unresolved and the fixed-seed draw selects the next eligible link.
[Hand-checked links](source-audit.md)

Of the 110 formerly definite links that changed, 50 extensionless relative
imports became unresolved in their actual ESM mode, 45 workspace interface
calls had no proven runtime target, and 15 Vitest links became candidate sets.
[Changed sites and explanations](changed-sites.md)

## Cold index observations

Elapsed time and peak resident memory are observations from a shared server.

| Repository | Cold elapsed time before → after | Peak RSS before → after |
| --- | ---: | ---: |
| pingdotgg/t3code | 425.6 s → 554.4 s | 3,193 MiB → 4,810 MiB |
| withastro/astro | 1,000.3 s → 1,042.3 s | 2,523 MiB → 4,915 MiB |
