# SW-5 installed-declarations replay

SW-4 carried five TypeScript pins' bare results into the installed score.
This replay uses the pinned package manager and frozen lockfile with scripts
disabled. The installed receipts name their actual tool version, arguments,
product commit and build digest. The bare graphs, other installed results,
Go toolchain results and source review come from SW-4.
[Replay evidence](../../evidence/sw-5/README.md)

All five installers completed. Zod, Nest and T3 Code added 67,600
Level 2 links without recorded assumptions. On the 20 TypeScript pins,
installed Level 2 rose from 80.37% to 85.23%. Proven coverage rose from
76.84% to 81.70%, and assumption-marked links account for 3.53% in both
measurements. Microsoft TypeScript still uses its bare receipt after the
60-minute cold-index limit. Turborepo finished the sweep with an incomplete graph containing
Go and Rust links and zero TypeScript links.
[Per-pin measurements](../../evidence/sw-5/README.md#replay-results) · [Generated plan](../coverage-plan.md)

## TypeScript compiler and range failures

**microsoft/TypeScript.** SW-4 recorded `Debug Failure. False expression.`
across its TypeScript analysis. TypeScript 5.9.3's
`evaluateElementAccessExpression` asserts that a merged enum's member and
enum value declaration are in the same source file. The reduced program
has `a.ts` with `enum E { A = E["B"] }`, `b.ts` with `enum E { B = 1 }`,
and `c.ts` with `const v = { x: E.A };`. The current build's existing
regression test reproduces the assertion and localizes it to `c.ts`.
The separate flow failure reproduces with the pinned
`tsc/testdata/tests/cases/compiler/unreachableFlowAfterThrowingForHead1.ts`.
TypeScript 5.9.3 `getPreEmitDiagnostics` on that single file throws
`RangeError: Maximum call stack size exceeded` in `isReachableFlowNodeWorker`.
The same stack failure reproduced with `strict`, `noLib` and
`allowUnreachableCode: false` on this 117-character source:
`try { for ((function(){throw 1})(); (function*(){throw 2})(); (function*(){throw 3})()) { console.log(1) } } catch {}`.
[Existing assertion test](../../test/graph-typescript-large.test.mjs) ·
[Pinned flow fixture](https://github.com/microsoft/TypeScript/blob/21ba970871efd2766ee46813d0bb67253e7878fa/tsc/testdata/tests/cases/compiler/unreachableFlowAfterThrowingForHead1.ts) ·
[C-13 diagnosis](C-13.md)

**vercel/turborepo.** `examples/with-yarn/packages/eslint-config/next.js`
is 68 UTF-16 units long, but its analysis returns a module range of
`[0, 903)`, causing `Invalid UTF-16 range`. The two example workspaces
resolve `@repo/eslint-config@0.0.0` to distinct `next.js` files. The checker
redirects the shorter file's package identity to the 903-unit file in
`examples/basic`, and the graph validates the resulting offsets against
the shorter file. Four original JavaScript sources and seven workspace
contexts reproduce the error offline with no installed packages.
[Pinned shorter file](https://github.com/vercel/turborepo/blob/eda8172408e89671cf71c39a2ffe4e05e07624bf/examples/with-yarn/packages/eslint-config/next.js) ·
[Reduced replay](../../evidence/sw-5/repro-turborepo.mjs)
