# Source sample review

The fixed seed selected **1,331** source sites. Each has a label and a review basis in [the sample archive](samples.json.gz).

Sampling allocates about 420 sites per module in proportion to the observed eligible gap, with a minimum of six in buckets of at least 100 links and one in smaller buckets. Buckets combine the recorded reason family, source scope and strict disposition. The lowest fixed-seed hashes are selected within each bucket.

Inside below means a source-supported shape or a site with legitimate runtime ambiguity that stays in the denominator. Cannot-tell sites stay eligible. The outside share for each unresolved bucket has a 95% Wilson interval. The language interval pools using the population weights and their effective sample size. These intervals describe sampling error. Source-trace judgment and unknown sites can introduce additional uncertainty.

| Module, reason, scope and strict disposition | Links | Sampled | Support shape | Outside after all | Correctly ambiguous | Cannot tell | Estimated inside share | Estimated outside share (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ` go:ambiguous:source:eligible ` | 38,500 | 60 | 34 | 0 | 23 | 3 | — | — |
| ` go:empty:source:inside ` | 495 | 6 | 6 | 0 | 0 | 0 | 100.00% (60.97%–100.00%) | 0.00% (0.00%–39.03%) |
| ` go:empty:source:unclassified ` | 231,940 | 359 | 114 | 218 | 23 | 4 | 38.16% (33.29%–43.29%) | 60.72% (55.58%–65.64%) |
| ` go:invalid-code:source:inside ` | 149 | 6 | 0 | 0 | 0 | 6 | 0.00% (0.00%–39.03%) | 0.00% (0.00%–39.03%) |
| ` rust:ambiguous:source:eligible ` | 781 | 6 | 6 | 0 | 0 | 0 | — | — |
| ` rust:empty:source:inside ` | 5,025 | 6 | 6 | 0 | 0 | 0 | 100.00% (60.97%–100.00%) | 0.00% (0.00%–39.03%) |
| ` rust:empty:source:unclassified ` | 155,172 | 151 | 105 | 44 | 0 | 2 | 69.54% (61.79%–76.32%) | 29.14% (22.48%–36.83%) |
| ` rust:failed-file-taint:source:inside ` | 738 | 6 | 6 | 0 | 0 | 0 | 100.00% (60.97%–100.00%) | 0.00% (0.00%–39.03%) |
| ` rust:failed-file-taint:source:unclassified ` | 9,333 | 9 | 2 | 6 | 0 | 1 | 22.22% (6.32%–54.74%) | 66.67% (35.42%–87.94%) |
| ` rust:opaque-declaration:source:inside ` | 25,809 | 25 | 25 | 0 | 0 | 0 | 100.00% (86.68%–100.00%) | 0.00% (0.00%–13.32%) |
| ` rust:opaque-declaration:source:unclassified ` | 47,987 | 47 | 20 | 26 | 0 | 1 | 42.55% (29.51%–56.72%) | 55.32% (41.25%–68.59%) |
| ` rust:other:source:inside ` | 9,075 | 9 | 9 | 0 | 0 | 0 | 100.00% (70.08%–100.00%) | 0.00% (0.00%–29.92%) |
| ` rust:other:source:unclassified ` | 12,126 | 12 | 7 | 5 | 0 | 0 | 58.33% (31.95%–80.67%) | 41.67% (19.33%–68.05%) |
| ` rust:path-or-namespace:source:inside ` | 1,938 | 6 | 6 | 0 | 0 | 0 | 100.00% (60.97%–100.00%) | 0.00% (0.00%–39.03%) |
| ` rust:path-or-namespace:source:unclassified ` | 9,231 | 9 | 2 | 6 | 0 | 1 | 22.22% (6.32%–54.74%) | 66.67% (35.42%–87.94%) |
| ` rust:receiver:source:inside ` | 147 | 6 | 6 | 0 | 0 | 0 | 100.00% (60.97%–100.00%) | 0.00% (0.00%–39.03%) |
| ` rust:receiver:source:unclassified ` | 153,557 | 150 | 68 | 77 | 1 | 4 | 46.00% (38.22%–53.98%) | 51.33% (43.40%–59.20%) |
| ` typescript:ambiguous:bundle:eligible ` | 1 | 1 | 0 | 0 | 0 | 1 | — | — |
| ` typescript:ambiguous:source:eligible ` | 4,274 | 6 | 6 | 0 | 0 | 0 | — | — |
| ` typescript:external-package:broken-fixture:inside ` | 9 | 1 | 1 | 0 | 0 | 0 | 100.00% (20.65%–100.00%) | 0.00% (0.00%–79.35%) |
| ` typescript:external-package:source:inside ` | 55,503 | 35 | 35 | 0 | 0 | 0 | 100.00% (90.11%–100.00%) | 0.00% (0.00%–9.89%) |
| ` typescript:external-package:source:unclassified ` | 32,260 | 20 | 0 | 20 | 0 | 0 | 0.00% (0.00%–16.11%) | 100.00% (83.89%–100.00%) |
| ` typescript:external:bundle:unclassified ` | 4,479 | 6 | 0 | 6 | 0 | 0 | 0.00% (0.00%–39.03%) | 100.00% (60.97%–100.00%) |
| ` typescript:external:source:inside ` | 4,818 | 6 | 5 | 1 | 0 | 0 | 83.33% (43.65%–96.99%) | 16.67% (3.01%–56.35%) |
| ` typescript:external:source:unclassified ` | 98,307 | 61 | 2 | 58 | 0 | 1 | 3.28% (0.90%–11.19%) | 95.08% (86.51%–98.31%) |
| ` typescript:incomplete-config:source:inside ` | 3,607 | 6 | 6 | 0 | 0 | 0 | 100.00% (60.97%–100.00%) | 0.00% (0.00%–39.03%) |
| ` typescript:incomplete-config:source:unclassified ` | 5,644 | 6 | 1 | 4 | 0 | 1 | 16.67% (3.01%–56.35%) | 66.67% (30.00%–90.32%) |
| ` typescript:local:bundle:inside ` | 60,055 | 37 | 37 | 0 | 0 | 0 | 100.00% (90.59%–100.00%) | 0.00% (0.00%–9.41%) |
| ` typescript:local:source:inside ` | 96,430 | 60 | 60 | 0 | 0 | 0 | 100.00% (93.98%–100.00%) | 0.00% (0.00%–6.02%) |
| ` typescript:missing-module:source:inside ` | 13,553 | 8 | 8 | 0 | 0 | 0 | 100.00% (67.56%–100.00%) | 0.00% (0.00%–32.44%) |
| ` typescript:missing-module:source:unclassified ` | 793 | 6 | 6 | 0 | 0 | 0 | 100.00% (60.97%–100.00%) | 0.00% (0.00%–39.03%) |
| ` typescript:no-symbol:bundle:unclassified ` | 37,244 | 23 | 19 | 0 | 0 | 4 | 82.61% (62.86%–93.02%) | 0.00% (0.00%–14.31%) |
| ` typescript:no-symbol:source:inside ` | 4,542 | 6 | 0 | 6 | 0 | 0 | 0.00% (0.00%–39.03%) | 100.00% (60.97%–100.00%) |
| ` typescript:no-symbol:source:unclassified ` | 251,791 | 157 | 31 | 120 | 0 | 6 | 19.75% (14.27%–26.66%) | 76.43% (69.21%–82.39%) |
| ` typescript:other:broken-fixture:inside ` | 2 | 1 | 1 | 0 | 0 | 0 | 100.00% (20.65%–100.00%) | 0.00% (0.00%–79.35%) |
| ` typescript:other:source:inside ` | 1,159 | 6 | 6 | 0 | 0 | 0 | 100.00% (60.97%–100.00%) | 0.00% (0.00%–39.03%) |
| ` typescript:other:source:unclassified ` | 314 | 6 | 0 | 0 | 6 | 0 | 100.00% (60.97%–100.00%) | 0.00% (0.00%–39.03%) |

### Support labels within each sampled bucket

| Bucket | Label and sampled count |
| --- | --- |
| ` go:ambiguous:source:eligible ` | ` go-factory ` 8, ` go-fields ` 2, ` go-generated ` 17, ` go-local-method ` 2, ` go-typed-reference ` 5 |
| ` go:empty:source:inside ` | ` go-typed-reference ` 6 |
| ` go:empty:source:unclassified ` | ` go-container ` 41, ` go-external-fields ` 21, ` go-external-import ` 24, ` go-external-result ` 62, ` go-factory ` 15, ` go-fields ` 20, ` go-interface ` 15, ` go-local-method ` 2, ` go-pointer-conversion ` 6, ` go-stdlib ` 111, ` go-type-parameter ` 3, ` go-typed-reference ` 12 |
| ` rust:ambiguous:source:eligible ` | ` rust-macro ` 4, ` rust-parameter ` 1, ` rust-trait ` 1 |
| ` rust:empty:source:inside ` | ` rust-macro ` 3, ` rust-trait ` 3 |
| ` rust:empty:source:unclassified ` | ` rust-chain ` 5, ` rust-let ` 1, ` rust-macro ` 2, ` rust-parameter ` 17, ` rust-std-path ` 41, ` rust-std-receiver ` 3, ` rust-trait ` 3, ` rust-value ` 77 |
| ` rust:failed-file-taint:source:inside ` | ` rust-taint ` 6 |
| ` rust:failed-file-taint:source:unclassified ` | ` rust-taint ` 8 |
| ` rust:opaque-declaration:source:inside ` | ` rust-glob ` 15, ` rust-import ` 2, ` rust-parameter ` 1, ` rust-self-trait ` 1, ` rust-trait ` 6 |
| ` rust:opaque-declaration:source:unclassified ` | ` rust-glob ` 13, ` rust-import ` 1, ` rust-parameter ` 1, ` rust-std-path ` 26, ` rust-trait ` 4, ` rust-value ` 1 |
| ` rust:other:source:inside ` | ` rust-import ` 2, ` rust-imported-function ` 2, ` rust-parameter ` 1, ` rust-trait ` 4 |
| ` rust:other:source:unclassified ` | ` rust-import ` 1, ` rust-let ` 2, ` rust-self-trait ` 1, ` rust-std-path ` 5, ` rust-trait ` 3 |
| ` rust:path-or-namespace:source:inside ` | ` rust-import ` 2, ` rust-trait ` 4 |
| ` rust:path-or-namespace:source:unclassified ` | ` rust-std-path ` 6, ` rust-trait ` 1, ` rust-value ` 1 |
| ` rust:receiver:source:inside ` | ` rust-let ` 6 |
| ` rust:receiver:source:unclassified ` | ` rust-chain ` 19, ` rust-let ` 45, ` rust-macro ` 2, ` rust-std-receiver ` 77, ` rust-value ` 2 |
| ` typescript:ambiguous:source:eligible ` | ` ts-object-member ` 1, ` ts-relative ` 5 |
| ` typescript:external-package:broken-fixture:inside ` | ` ts-workspace ` 1 |
| ` typescript:external-package:source:inside ` | ` ts-local-access ` 1, ` ts-local-chain ` 7, ` ts-workspace ` 27 |
| ` typescript:external-package:source:unclassified ` | ` ts-package ` 11, ` ts-package-chain ` 8, ` ts-runtime ` 1 |
| ` typescript:external:bundle:unclassified ` | ` ts-runtime ` 6 |
| ` typescript:external:source:inside ` | ` ts-local-access ` 2, ` ts-relative ` 3, ` ts-runtime ` 1 |
| ` typescript:external:source:unclassified ` | ` ts-config ` 2, ` ts-runtime ` 58 |
| ` typescript:incomplete-config:source:inside ` | ` ts-config-preset ` 6 |
| ` typescript:incomplete-config:source:unclassified ` | ` ts-config ` 1, ` ts-package-chain ` 1, ` ts-runtime ` 3 |
| ` typescript:local:bundle:inside ` | ` ts-bundle ` 21, ` ts-nested-function ` 16 |
| ` typescript:local:source:inside ` | ` ts-local-access ` 27, ` ts-nested-function ` 9, ` ts-props ` 2, ` ts-type-parameters ` 22 |
| ` typescript:missing-module:source:inside ` | ` ts-local-access ` 4, ` ts-relative ` 4 |
| ` typescript:missing-module:source:unclassified ` | ` ts-local-access ` 1, ` ts-local-chain ` 5 |
| ` typescript:no-symbol:bundle:unclassified ` | ` ts-bundle ` 14, ` ts-inline ` 2, ` ts-local-chain ` 3 |
| ` typescript:no-symbol:source:inside ` | ` ts-package-chain ` 6 |
| ` typescript:no-symbol:source:unclassified ` | ` ts-bundle ` 1, ` ts-inline ` 2, ` ts-local-chain ` 28, ` ts-package ` 38, ` ts-package-chain ` 60, ` ts-runtime ` 22 |
| ` typescript:other:broken-fixture:inside ` | ` ts-relative ` 1 |
| ` typescript:other:source:inside ` | ` ts-local-access ` 3, ` ts-local-chain ` 1, ` ts-relative ` 2 |

## Cannot-tell labels

- 5 sites. Minified source or fixture syntax obscures the declaration and receiver. Example pocketbase/pocketbase ` ui/dist/assets/index-B7vkkFa_.js:68 `.
- 8 sites. The call lacks a usable receiver type or package binding. Example pingdotgg/t3code ` apps/web/src/components/settings/SettingsPanels.tsx:94 `.
- 9 sites. The nearby source and recorded path give no reliable receiver, binding or macro origin. Example BurntSushi/ripgrep ` crates/ignore/tests/gitignore_matched_path_or_any_parents_tests.rs:38 `.
- 7 sites. The receiver comes from an untraced return or interface, or the selector has no usable import or type. Example protocolbuffers/protobuf-go ` internal/testprotos/nullable/nullable_test.go:37 `.
- 6 sites. The stored diagnostic marks invalid input, so the intended target cannot reliably be determined. Example golang/tools ` go/ssa/testdata/valueforexpr.go:94 `.

## Cross-checks from the tool-comparison candidates

All counts here come from this sweep. The comparison supplied shapes to look for. Sample counts below are observations. The support tables estimate each shape's eligible links using the full bucket sizes. The direct scans count only their stated syntax and matching rules. [Comparison report](../sw-2/summary.md)

| Stored graph shape | Labelled sites | Example |
| --- | ---: | --- |
| TypeScript sibling workspace package | 28 | vitest-dev/vitest ` test/e2e/fixtures/list-parse-error/ok.test.ts:3 `<br>vitest-dev/vitest ` test/unit/test/mocking/automocking-class-inheritance.test.ts:7 ` |
| TypeScript nested function | 25 | cli/cli ` .github/extensions/terminal-mockup/assets/html2canvas.min.js:20 `<br>pocketbase/pocketbase ` ui/public/libs/tinymce/models/dom/model.min.js:1 ` |
| TypeScript missing package config preset | 6 | changesets/changesets ` packages/config/src/defaults.ts:1 `<br>withastro/astro ` packages/astro/e2e/fixtures/cloudflare/src/content.config.ts:83 ` |
| TypeScript member of an object type | 1 | pocketbase/pocketbase ` plugins/jsvm/internal/types/generated/types.d.ts:12606 ` |
| Rust typed local or builder-chain receiver | 78 | clap-rs/clap ` tests/builder/require.rs:505 `<br>actix/actix-web ` actix-web-codegen/tests/trybuild/route-ok.rs:27 ` |
| Rust name brought into scope by a checkout glob | 28 | ratatui/ratatui ` ratatui-core/src/layout/rect/ops.rs:109 `<br>actix/actix-web ` actix-web/src/middleware/compress.rs:141 ` |
| Rust Self or self dispatch through a trait impl | 2 | cberner/redb ` src/types.rs:942 `<br>BurntSushi/ripgrep ` crates/printer/src/standard.rs:802 ` |
| Rust call through an explicit use binding | 2 | crossbeam-rs/crossbeam ` crossbeam-channel/tests/array.rs:127 `<br>crossbeam-rs/crossbeam ` crossbeam-channel/tests/ready.rs:591 ` |
| Go member through an indexed or ranged value | 41 | golang/tools ` internal/diff/diff_test.go:109 `<br>cli/cli ` pkg/cmd/pr/view/view_test.go:966 ` |
| Go interface dispatch retained as runtime ambiguity | 42 | gofiber/fiber ` middleware/session/middleware_test.go:171 `<br>gofiber/fiber ` middleware/cache/cache_test.go:2775 ` |

Tracked npm and pnpm manifests identified **41,569** stored external-package links from 14 repositories naming a sibling workspace package. The strict denominator retains them. A package-name match establishes that the package is checked in. The source review also checks member and subpath context.

| Repository | Sibling packages | Links | Example |
| --- | ---: | ---: | --- |
| changesets/changesets | 1 | 1 | changesets/changesets ` packages/cli/bin.js:9 ` |
| colinhacks/zod | 2 | 208 | colinhacks/zod ` packages/integration/fixtures/internal-types/cjs-test.cts:3 `<br>colinhacks/zod ` packages/integration/fixtures/internal-types/mini-cjs-test.cts:3 ` |
| dexie/Dexie.js | 6 | 476 | dexie/Dexie.js ` addons/Dexie.Observable/test/unit/tests-observable-misc.js:4 `<br>dexie/Dexie.js ` addons/Dexie.Syncable/api.d.ts:31 ` |
| evanw/esbuild | 1 | 2 | evanw/esbuild ` require/yarnpnp/in.mjs:20 ` |
| excalidraw/excalidraw | 2 | 63 | excalidraw/excalidraw ` dev-docs/src/theme/ReactLiveScope/index.js:6 `<br>excalidraw/excalidraw ` dev-docs/src/theme/ReactLiveScope/index.js:10 ` |
| mermaid-js/mermaid | 2 | 332 | mermaid-js/mermaid ` packages/examples/src/example.spec.ts:1 `<br>mermaid-js/mermaid ` packages/mermaid/src/diagrams/architecture/architectureParser.ts:1 ` |
| nestjs/nest | 2 | 29 | nestjs/nest ` sample/09-babel-example/src/app.module.js:1 `<br>nestjs/nest ` sample/09-babel-example/src/main.js:1 ` |
| puppeteer/puppeteer | 6 | 1,174 | puppeteer/puppeteer ` Herebyfile.mjs:13 `<br>puppeteer/puppeteer ` docker/test/smoke-test.js:6 ` |
| reduxjs/redux-toolkit | 2 | 533 | reduxjs/redux-toolkit ` examples/action-listener/counter/src/components/App/App.tsx:3 `<br>reduxjs/redux-toolkit ` examples/query/react/graphql-codegen/src/app/services/baseApi.ts:2 ` |
| tauri-apps/tauri | 1 | 9 | tauri-apps/tauri ` packages/api-e2e/test/helpers/index.ts:6 ` |
| trpc/trpc | 7 | 1,745 | trpc/trpc ` examples/.experimental/next-app-dir/src/app/_components/client-ui.ts:5 `<br>trpc/trpc ` examples/.experimental/next-app-dir/src/app/api/trpc/[trpc]/route.ts:1 ` |
| vitejs/vite | 92 | 932 | vitejs/vite ` packages/create-vite/template-preact-ts/vite.config.ts:2 `<br>vitejs/vite ` packages/vite/src/node/__tests__/fixtures/config/entry/vite.config.ts:1 ` |
| vitest-dev/vitest | 14 | 28,187 | vitest-dev/vitest ` examples/basic/test/basic.test.ts:1 `<br>vitest-dev/vitest ` examples/lit/vite.config.ts:3 ` |
| withastro/astro | 36 | 7,878 | withastro/astro ` benchmark/bench/build-hybrid.bench.js:2 `<br>withastro/astro ` benchmark/static-projects/build-hybrid/astro.config.js:2 ` |

The sweep pins T3 Code at `ea20e80`, which declares a Bun workspace in package.json. The comparison used a different pnpm pin. The T3 Code sweep graph had no external-package edges with confirmed sibling package names.

### Candidate sites that have no stored link

These source checks report visible omissions outside the graph denominator. TypeScript checks unique in-file callable declarations used as shorthand and explicitly typed object members. Go checks bare receiver names with package variable declarations and standalone identifier keys in explicit map literals with package declarations. A same-name declaration is a lead for review where source scope could shadow it. The totals describe these detectable patterns.

| Source shape | Candidate sites | Repositories | Example |
| --- | ---: | ---: | --- |
| TypeScript member on an explicitly typed object | 2,327 | 19 | changesets/changesets ` packages/apply-release-plan/src/get-changelog-entry.ts:90 `<br>changesets/changesets ` packages/apply-release-plan/src/get-changelog-entry.ts:101 ` |
| TypeScript shorthand passing a function | 1,551 | 22 | cli/cli ` .github/scripts/issue-triage-report.cjs:555 `<br>colinhacks/zod ` packages/zod/src/v4/classic/tests/validate.test.ts:306 ` |
| Go package variable used as a receiver | 3,560 | 20 | charmbracelet/bubbletea ` examples/altscreen-toggle/main.go:73 `<br>charmbracelet/bubbletea ` examples/altscreen-toggle/main.go:74 ` |
| Go package name used as a map-literal key | 579 | 12 | charmbracelet/bubbletea ` examples/table-resize/main.go:60 `<br>charmbracelet/bubbletea ` examples/table-resize/main.go:61 ` |
