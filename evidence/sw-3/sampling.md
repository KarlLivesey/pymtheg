# Source sample review

The fixed seed selected **1,331** distinct sites within their strata. Each has a review label, source basis and the current observed link multiplicity in [the sample archive](samples.json.gz).

Strata use the recorded reason family, source scope and audit disposition. Equal-probability site samples use the smallest hashes within each stratum. All links at each selected site contribute. The estimates multiply the link-weighted sample share by the exact link population in the stratum.
Intervals use per-stratum ratio-estimator variance with a finite-population correction on site counts. The normal interval sums those variances and bounds covariance when strata share a source-site hash. A noncensus stratum with fewer than two sites contributes its full possible range. For a noncensus sample with all or no matches, a conservative zero-hit bound allows for an unseen category and its unsampled link multiplicity. Source judgment and missed origins can add error.

| Bucket | Sites sampled | Stored links at those sites | Inside misses | Outside L2 | Outside L1 only | Outside neither | Valid alternatives | Cannot tell |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ` go:ambiguous:source:eligible ` | 60 | 60 | 26 | 0 | 0 | 1 | 32 | 1 |
| ` go:empty:source:inside ` | 6 | 6 | 6 | 0 | 0 | 0 | 0 | 0 |
| ` go:empty:source:unclassified ` | 359 | 359 | 103 | 110 | 0 | 113 | 29 | 4 |
| ` go:invalid-code:source:inside ` | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 6 |
| ` rust:ambiguous:source:eligible ` | 6 | 6 | 1 | 0 | 0 | 0 | 4 | 1 |
| ` rust:empty:source:inside ` | 6 | 6 | 6 | 0 | 0 | 0 | 0 | 0 |
| ` rust:empty:source:unclassified ` | 151 | 151 | 106 | 2 | 0 | 43 | 0 | 0 |
| ` rust:failed-file-taint:source:inside ` | 6 | 6 | 6 | 0 | 0 | 0 | 0 | 0 |
| ` rust:failed-file-taint:source:unclassified ` | 9 | 9 | 2 | 0 | 0 | 6 | 0 | 1 |
| ` rust:opaque-declaration:source:inside ` | 25 | 25 | 22 | 0 | 0 | 3 | 0 | 0 |
| ` rust:opaque-declaration:source:unclassified ` | 47 | 47 | 16 | 4 | 0 | 26 | 0 | 1 |
| ` rust:other:source:inside ` | 9 | 9 | 9 | 0 | 0 | 0 | 0 | 0 |
| ` rust:other:source:unclassified ` | 12 | 12 | 7 | 0 | 0 | 5 | 0 | 0 |
| ` rust:path-or-namespace:source:inside ` | 6 | 6 | 5 | 0 | 0 | 1 | 0 | 0 |
| ` rust:path-or-namespace:source:unclassified ` | 9 | 9 | 2 | 0 | 0 | 7 | 0 | 0 |
| ` rust:receiver:source:inside ` | 6 | 6 | 5 | 0 | 0 | 1 | 0 | 0 |
| ` rust:receiver:source:unclassified ` | 150 | 150 | 61 | 4 | 0 | 82 | 1 | 2 |
| ` typescript:ambiguous:bundle:eligible ` | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| ` typescript:ambiguous:source:eligible ` | 6 | 6 | 5 | 0 | 0 | 0 | 1 | 0 |
| ` typescript:external-package:broken-fixture:inside ` | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| ` typescript:external-package:source:inside ` | 35 | 35 | 35 | 0 | 0 | 0 | 0 | 0 |
| ` typescript:external-package:source:unclassified ` | 20 | 20 | 0 | 4 | 0 | 16 | 0 | 0 |
| ` typescript:external:bundle:unclassified ` | 6 | 6 | 0 | 0 | 0 | 6 | 0 | 0 |
| ` typescript:external:source:inside ` | 6 | 6 | 5 | 0 | 0 | 1 | 0 | 0 |
| ` typescript:external:source:unclassified ` | 61 | 61 | 2 | 0 | 0 | 58 | 0 | 1 |
| ` typescript:incomplete-config:source:inside ` | 6 | 6 | 6 | 0 | 0 | 0 | 0 | 0 |
| ` typescript:incomplete-config:source:unclassified ` | 6 | 6 | 1 | 0 | 0 | 5 | 0 | 0 |
| ` typescript:local:bundle:inside ` | 37 | 37 | 37 | 0 | 0 | 0 | 0 | 0 |
| ` typescript:local:source:inside ` | 60 | 60 | 58 | 0 | 0 | 0 | 2 | 0 |
| ` typescript:missing-module:source:inside ` | 8 | 8 | 8 | 0 | 0 | 0 | 0 | 0 |
| ` typescript:missing-module:source:unclassified ` | 6 | 6 | 6 | 0 | 0 | 0 | 0 | 0 |
| ` typescript:no-symbol:bundle:unclassified ` | 23 | 23 | 6 | 0 | 0 | 5 | 3 | 9 |
| ` typescript:no-symbol:source:inside ` | 6 | 6 | 0 | 0 | 0 | 6 | 0 | 0 |
| ` typescript:no-symbol:source:unclassified ` | 157 | 157 | 26 | 0 | 0 | 126 | 5 | 0 |
| ` typescript:other:broken-fixture:inside ` | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| ` typescript:other:source:inside ` | 6 | 6 | 5 | 0 | 0 | 1 | 0 | 0 |
| ` typescript:other:source:unclassified ` | 6 | 6 | 0 | 0 | 0 | 0 | 6 | 0 |

### Remaining strata after exact outside identification

| Bucket | Population sites | Population links | Reviewed sites | Reviewed links | Outside share (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: |
| ` go:ambiguous:source:eligible ` | 38,470 | 38,470 | 60 | 60 | 1.67% (0.00%–4.93%) |
| ` go:empty:source:inside ` | 495 | 495 | 6 | 6 | 0.00% (0.00%–45.93%) |
| ` go:empty:source:unclassified ` | 170,349 | 170,756 | 249 | 249 | 45.38% (39.19%–51.57%) |
| ` go:invalid-code:source:inside ` | 149 | 149 | 6 | 6 | 0.00% (0.00%–45.93%) |
| ` rust:ambiguous:source:eligible ` | 781 | 781 | 6 | 6 | 0.00% (0.00%–45.93%) |
| ` rust:empty:source:inside ` | 5,025 | 5,025 | 6 | 6 | 0.00% (0.00%–45.93%) |
| ` rust:empty:source:unclassified ` | 154,135 | 154,135 | 149 | 149 | 28.86% (21.56%–36.16%) |
| ` rust:failed-file-taint:source:inside ` | 738 | 738 | 6 | 6 | 0.00% (0.00%–45.93%) |
| ` rust:failed-file-taint:source:unclassified ` | 8,996 | 8,996 | 9 | 9 | 66.67% (34.02%–99.32%) |
| ` rust:opaque-declaration:source:inside ` | 25,687 | 25,809 | 25 | 25 | 12.00% (0.00%–24.99%) |
| ` rust:opaque-declaration:source:unclassified ` | 45,818 | 45,927 | 43 | 43 | 60.47% (45.69%–75.24%) |
| ` rust:other:source:inside ` | 8,701 | 9,073 | 9 | 9 | 0.00% (0.00%–36.35%) |
| ` rust:other:source:unclassified ` | 11,839 | 11,922 | 12 | 12 | 41.67% (12.55%–70.79%) |
| ` rust:path-or-namespace:source:inside ` | 1,938 | 1,938 | 6 | 6 | 16.67% (0.00%–49.28%) |
| ` rust:path-or-namespace:source:unclassified ` | 7,920 | 7,920 | 9 | 9 | 77.78% (48.98%–100.00%) |
| ` rust:receiver:source:inside ` | 147 | 147 | 6 | 6 | 16.67% (0.00%–48.66%) |
| ` rust:receiver:source:unclassified ` | 152,363 | 152,363 | 146 | 146 | 56.16% (48.09%–64.24%) |
| ` typescript:ambiguous:bundle:eligible ` | 1 | 1 | 1 | 1 | 0.00% (0.00%–0.00%) |
| ` typescript:ambiguous:source:eligible ` | 4,274 | 4,274 | 6 | 6 | 0.00% (0.00%–45.93%) |
| ` typescript:external-package:broken-fixture:inside ` | 9 | 9 | 1 | 1 | 0.00% (0.00%–100.00%) |
| ` typescript:external-package:source:inside ` | 54,410 | 54,410 | 35 | 35 | 0.00% (0.00%–10.00%) |
| ` typescript:external-package:source:unclassified ` | 30,397 | 30,397 | 16 | 16 | 100.00% (79.41%–100.00%) |
| ` typescript:external:bundle:unclassified ` | 4,968 | 4,968 | 6 | 6 | 100.00% (54.07%–100.00%) |
| ` typescript:external:source:inside ` | 4,818 | 4,818 | 6 | 6 | 16.67% (0.00%–49.31%) |
| ` typescript:external:source:unclassified ` | 97,818 | 97,818 | 61 | 61 | 95.08% (89.61%–100.00%) |
| ` typescript:incomplete-config:source:inside ` | 3,607 | 3,607 | 6 | 6 | 0.00% (0.00%–45.93%) |
| ` typescript:incomplete-config:source:unclassified ` | 5,639 | 5,639 | 6 | 6 | 83.33% (50.68%–100.00%) |
| ` typescript:local:bundle:inside ` | 61,580 | 61,580 | 37 | 37 | 0.00% (0.00%–9.49%) |
| ` typescript:local:source:inside ` | 94,905 | 94,905 | 60 | 60 | 0.00% (0.00%–5.96%) |
| ` typescript:missing-module:source:inside ` | 13,553 | 13,553 | 8 | 8 | 0.00% (0.00%–36.94%) |
| ` typescript:missing-module:source:unclassified ` | 793 | 793 | 6 | 6 | 0.00% (0.00%–45.93%) |
| ` typescript:no-symbol:bundle:unclassified ` | 39,150 | 39,150 | 23 | 23 | 21.74% (4.51%–38.97%) |
| ` typescript:no-symbol:source:inside ` | 4,542 | 4,542 | 6 | 6 | 100.00% (54.07%–100.00%) |
| ` typescript:no-symbol:source:unclassified ` | 249,884 | 249,884 | 157 | 157 | 80.25% (74.01%–86.50%) |
| ` typescript:other:broken-fixture:inside ` | 2 | 2 | 1 | 1 | 0.00% (0.00%–100.00%) |
| ` typescript:other:source:inside ` | 1,159 | 1,159 | 6 | 6 | 16.67% (0.00%–49.25%) |
| ` typescript:other:source:unclassified ` | 314 | 314 | 6 | 6 | 0.00% (0.00%–45.93%) |

### Reviewed closed candidate sets

- clap-rs/clap ` clap_builder/src/output/help_template.rs:1040 `. The checkout defines exactly two debug macros here, under complementary debug feature gates. Both stored candidates are real in their respective configurations.
- clap-rs/clap ` clap_builder/src/parser/parser.rs:1521 `. The checkout defines exactly two debug macros here, under complementary debug feature gates. Both stored candidates are real in their respective configurations.
- clap-rs/clap ` clap_builder/src/output/usage.rs:255 `. The checkout defines exactly two debug macros here, under complementary debug feature gates. Both stored candidates are real in their respective configurations.
- clap-rs/clap ` clap_builder/src/builder/command.rs:3906 `. The checkout defines exactly two debug macros here, under complementary debug feature gates. Both stored candidates are real in their respective configurations.
- pingdotgg/t3code ` apps/web/src/session-logic.ts:4 `. The unqualified import selects both the exported type and its schema value from one checked-in declaration file. The stored set contains exactly those two targets.

### Library misses that need dependency information

- **Go** samber/lo ` map_test.go:832 `. The call is on the result of testify/assert.New. Its Assertions return type comes from the dependency declaration.
- **Go** cli/cli ` pkg/cmd/project/field-list/field_list_test.go:457 `. CLI declares gopkg.in/h2non/gock.v1, which owns this HTTP test builder.
- **Rust** clap-rs/clap ` clap_derive/src/item.rs:97 `. syn declares the ident field of its derive input. That dependency field type selects proc_macro2 Ident’s span method.
- **Rust** tauri-apps/tauri ` crates/tauri-cli/src/dev/builtin_dev_server.rs:64 `. The method chain starts at the Tokio runtime builder. The next receiver type depends on the dependency return declarations.
- **TypeScript / JS** trpc/trpc ` www/src/flags.test.ts:28 `. The recorded property receiver is a test-framework assertion or mock chain.
- **TypeScript / JS** pingdotgg/t3code ` apps/server/src/auth/Layers/ServerSecretStore.test.ts:234 `. The recorded property receiver is a test-framework assertion or mock chain.

### Support labels within each sampled bucket

| Bucket | Label and sampled count |
| --- | --- |
| ` go:ambiguous:source:eligible ` | ` go-external-fields ` 1, ` go-factory ` 1, ` go-fields ` 2, ` go-generated ` 17, ` go-local-method ` 1, ` go-typed-reference ` 5 |
| ` go:empty:source:inside ` | ` go-typed-reference ` 6 |
| ` go:empty:source:unclassified ` | ` go-container ` 41, ` go-external-fields ` 23, ` go-external-import ` 24, ` go-external-result ` 65, ` go-factory ` 4, ` go-fields ` 20, ` go-interface ` 15, ` go-local-method ` 2, ` go-pointer-conversion ` 6, ` go-stdlib ` 111, ` go-type-parameter ` 3, ` go-typed-reference ` 12 |
| ` rust:ambiguous:source:eligible ` | ` rust-parameter ` 1 |
| ` rust:empty:source:inside ` | ` rust-imported-function ` 1, ` rust-macro ` 3, ` rust-trait ` 2 |
| ` rust:empty:source:unclassified ` | ` rust-chain ` 5, ` rust-macro ` 2, ` rust-parameter ` 17, ` rust-std-path ` 42, ` rust-std-receiver ` 3, ` rust-trait ` 1, ` rust-typed-receiver ` 1, ` rust-value ` 80 |
| ` rust:failed-file-taint:source:inside ` | ` rust-taint ` 6 |
| ` rust:failed-file-taint:source:unclassified ` | ` rust-taint ` 8 |
| ` rust:opaque-declaration:source:inside ` | ` rust-import ` 10, ` rust-imported-function ` 2, ` rust-macro ` 1, ` rust-parameter ` 1, ` rust-self-trait ` 1, ` rust-std-path ` 3, ` rust-trait ` 7 |
| ` rust:opaque-declaration:source:unclassified ` | ` rust-glob ` 3, ` rust-import ` 2, ` rust-imported-function ` 1, ` rust-macro ` 1, ` rust-parameter ` 1, ` rust-std-path ` 30, ` rust-trait ` 7, ` rust-value ` 1 |
| ` rust:other:source:inside ` | ` rust-import ` 2, ` rust-imported-function ` 2, ` rust-macro ` 2, ` rust-parameter ` 1, ` rust-trait ` 2 |
| ` rust:other:source:unclassified ` | ` rust-chain ` 2, ` rust-import ` 1, ` rust-self-trait ` 1, ` rust-std-path ` 5, ` rust-trait ` 3 |
| ` rust:path-or-namespace:source:inside ` | ` rust-import ` 2, ` rust-std-path ` 1, ` rust-trait ` 3 |
| ` rust:path-or-namespace:source:unclassified ` | ` rust-std-path ` 7, ` rust-trait ` 1, ` rust-value ` 1 |
| ` rust:receiver:source:inside ` | ` rust-std-receiver ` 1, ` rust-typed-receiver ` 5 |
| ` rust:receiver:source:unclassified ` | ` rust-chain ` 28, ` rust-let ` 27, ` rust-macro ` 2, ` rust-std-path ` 1, ` rust-std-receiver ` 85, ` rust-typed-receiver ` 3, ` rust-value ` 1 |
| ` typescript:ambiguous:source:eligible ` | ` ts-object-member ` 1, ` ts-relative ` 4 |
| ` typescript:external-package:broken-fixture:inside ` | ` ts-workspace ` 1 |
| ` typescript:external-package:source:inside ` | ` ts-local-access ` 1, ` ts-local-chain ` 7, ` ts-workspace ` 27 |
| ` typescript:external-package:source:unclassified ` | ` ts-package ` 11, ` ts-package-chain ` 8, ` ts-runtime ` 1 |
| ` typescript:external:bundle:unclassified ` | ` ts-runtime ` 6 |
| ` typescript:external:source:inside ` | ` ts-local-access ` 2, ` ts-relative ` 3, ` ts-runtime ` 1 |
| ` typescript:external:source:unclassified ` | ` ts-config ` 2, ` ts-runtime ` 58 |
| ` typescript:incomplete-config:source:inside ` | ` ts-config-preset ` 6 |
| ` typescript:incomplete-config:source:unclassified ` | ` ts-config ` 1, ` ts-package-chain ` 2, ` ts-runtime ` 3 |
| ` typescript:local:bundle:inside ` | ` ts-bundle ` 21, ` ts-nested-function ` 16 |
| ` typescript:local:source:inside ` | ` ts-local-access ` 26, ` ts-nested-function ` 9, ` ts-type-parameters ` 23 |
| ` typescript:missing-module:source:inside ` | ` ts-local-access ` 4, ` ts-relative ` 4 |
| ` typescript:missing-module:source:unclassified ` | ` ts-local-access ` 1, ` ts-local-chain ` 5 |
| ` typescript:no-symbol:bundle:unclassified ` | ` ts-bundle-flow ` 4, ` ts-inline ` 2, ` ts-runtime ` 5 |
| ` typescript:no-symbol:source:inside ` | ` ts-package-chain ` 6 |
| ` typescript:no-symbol:source:unclassified ` | ` ts-inline ` 2, ` ts-local-chain ` 20, ` ts-package ` 38, ` ts-package-chain ` 65, ` ts-runtime ` 23, ` ts-script-tag ` 4 |
| ` typescript:other:broken-fixture:inside ` | ` ts-relative ` 1 |
| ` typescript:other:source:inside ` | ` ts-local-access ` 3, ` ts-package-chain ` 1, ` ts-relative ` 2 |

## Cannot-tell labels

- 5 sites. Minified source or fixture syntax obscures the declaration and receiver. Example pocketbase/pocketbase ` ui/dist/assets/index-B7vkkFa_.js:68 `.
- 3 sites. The bundle has no recorded local binding and the final method owner is not established by the minified closure. Example pocketbase/pocketbase ` ui/public/libs/tinymce/themes/silver/theme.min.js:1 `.
- 1 sites. The call lacks a usable receiver type or package binding. Example pingdotgg/t3code ` apps/web/src/components/settings/SettingsPanels.tsx:94 `.
- 2 sites. The minified caller supplies this receiver through another closure. The final member declaration remains unverified. Example pocketbase/pocketbase ` ui/public/libs/tinymce/tinymce.min.js:13 `.
- 1 sites. The nearby source and recorded path give no reliable receiver, binding or macro origin. Example alacritty/alacritty ` alacritty/src/renderer/text/mod.rs:199 `.
- 1 sites. The outer interface and its generated return declarations do not establish a single method from the captured source. Example tauri-apps/tauri ` crates/tauri-cli/src/mobile/ios/xcode_script.rs:263 `.
- 5 sites. The receiver comes from an untraced return or interface, or the selector has no usable import or type. Example labstack/echo ` middleware/static.go:298 `.
- 6 sites. The stored diagnostic marks invalid input, so the intended target cannot reliably be determined. Example golang/tools ` go/ssa/testdata/valueforexpr.go:94 `.
- 3 sites. The terminal declaration cannot be confirmed from the fresh site’s source context. Example crossbeam-rs/crossbeam ` crossbeam-channel/src/flavors/array.rs:96 `.

## Cross-checks from the tool-comparison candidates

All counts here come from this sweep. The comparison supplied shapes to look for. Sample counts below are observations. The support tables estimate each shape's eligible links using the full bucket sizes. The direct scans count only their stated syntax and matching rules. [Comparison report](../sw-2/summary.md)

| Stored graph shape | Labelled sites | Example |
| --- | ---: | --- |
| TypeScript sibling workspace package | 28 | vitest-dev/vitest ` test/e2e/fixtures/list-parse-error/ok.test.ts:3 `<br>vitest-dev/vitest ` test/unit/test/mocking/automocking-class-inheritance.test.ts:7 ` |
| TypeScript nested function | 25 | cli/cli ` .github/extensions/terminal-mockup/assets/html2canvas.min.js:20 `<br>pocketbase/pocketbase ` ui/public/libs/tinymce/models/dom/model.min.js:1 ` |
| TypeScript missing package config preset | 6 | changesets/changesets ` packages/config/src/defaults.ts:1 `<br>withastro/astro ` packages/astro/e2e/fixtures/cloudflare/src/content.config.ts:83 ` |
| TypeScript member of an object type | 1 | pocketbase/pocketbase ` plugins/jsvm/internal/types/generated/types.d.ts:12606 ` |
| Rust typed local or builder-chain receiver | 62 | clap-rs/clap ` tests/builder/require.rs:505 `<br>actix/actix-web ` actix-web-codegen/tests/trybuild/route-ok.rs:27 ` |
| Rust name brought into scope by a checkout glob | 3 | ratatui/ratatui ` ratatui-core/src/backend/test.rs:1119 `<br>actix/actix-web ` actix-web/src/rmap.rs:419 ` |
| Rust Self or self dispatch through a trait impl | 2 | cberner/redb ` src/types.rs:942 `<br>BurntSushi/ripgrep ` crates/printer/src/standard.rs:802 ` |
| Rust call through an explicit use binding | 6 | clap-rs/clap ` clap_complete/tests/testsuite/elvish.rs:137 `<br>actix/actix-web ` actix-web/src/resource.rs:816 ` |
| Go member through an indexed or ranged value | 41 | golang/tools ` internal/diff/diff_test.go:109 `<br>cli/cli ` pkg/cmd/pr/view/view_test.go:966 ` |
| Go interface dispatch retained as runtime ambiguity | 54 | gofiber/fiber ` middleware/session/middleware_test.go:171 `<br>gofiber/fiber ` middleware/cache/cache_test.go:2775 ` |

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
