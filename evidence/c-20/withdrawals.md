# Hand audit of Level 2 withdrawals

Seed `pymtheg-c20-withdrawals-2026`. The draw cycles through reason classes in fixed rank order to include rare outcomes. The verdicts describe the sampled sites only.

**34 correct bare targets that the installed graph could no longer prove, six genuinely ambiguous, and zero wrong.**

| Class | Pin | Checkout site | Bare verdict | Source and declaration check |
| --- | --- | --- | --- | --- |
| `candidate-set` | withastro/astro | `packages/astro/src/core/build/lockfile/hasher.ts:13` | Genuinely ambiguous | Both the standard declaration and the installed Node augmentation contribute to the merged type. |
| `installed-declaration` | mermaid-js/mermaid | `packages/mermaid/src/themes/theme-redux-dark.js:207` | Right but unprovable | Khroma's `dist/methods/index.d.ts` exports `adjust`. The program stops at the extensionless re-export in `dist/index.d.ts`. |
| `unresolved/any-receiver` | vitejs/vite | `playground/dynamic-import/cjs-dynamic-importer-ambiguous/index.js:5` | Right but unprovable | The fixture specifies `module.exports.default` and the installed copy has the byte-identical `foo` export. The copy supplies no declaration. |
| `unresolved/external` | trpc/trpc | `packages/react-query/test/regression/issue-5808-proxy-in-dep-array.test.tsx:11` | Right but unprovable | The selected Zod 3.25.76 entry imports the `z` namespace from `v3/external` and exports it. |
| `unresolved/external-package` | trpc/trpc | `examples/next-prisma-websockets-starter/src/pages/about.tsx:77` | Right but unprovable | The installed `file:` copy exports the same `button.tsx` bytes. The copy supplies implementation source only. |
| `unresolved/incomplete-config` | withastro/astro | `packages/astro/e2e/fixtures/actions-blog/src/db/store.ts:6` | Right but unprovable | The source explicitly imports the Node builtin. The owning config is incomplete. |
| `unresolved/library-member-written` | puppeteer/puppeteer | `packages/puppeteer-core/src/util/disposable.ts:37` | Genuinely ambiguous | The checkout polyfill declares the property and the installed program also has standard disposal declarations. The source conditionally installs the property. |
| `unresolved/local` | reduxjs/redux-toolkit | `packages/toolkit/src/tests/utils/CustomMatchers.d.ts:8` | Right but unprovable | `CustomMatchers<R>` refers to the type parameter of the checkout `Assertion<R, T>` augmentation. |
| `unresolved/no-symbol` | dexie/Dexie.js | `addons/Dexie.Syncable/tools/build-configs/rollup.config.mjs:8` | Right but unprovable | `path` comes from the Node `path` import and `resolve` is an exported member. |
| `unresolved/object-producer-unverified` | trpc/trpc | `packages/tests/server/adapters/express.test.tsx:142` | Right but unprovable | `startServer()` returns its own `close` property, which calls the server's `close` method. |
| `unresolved/target-unavailable` | vitejs/vite | `playground/test-utils.ts:11` | Right but unprovable | `playground/shims.d.ts` declares the default for `css-color-names`, whose installed entry is the JSON color table. |
| `unresolved/workspace-manifest-unreadable` | vitejs/vite | `playground/ssr-deps/src/app.js:13` | Right but unprovable | The installed `file:` copy matches the checkout's primitive `module.exports` assignment byte for byte. |
| `candidate-set` | vitest-dev/vitest | `packages/vitest/src/runtime/console.ts:2` | Genuinely ambiguous | The Node `console` import is correct. The merged type and value declarations yield two named compiler targets for the import reference. |
| `installed-declaration` | mermaid-js/mermaid | `packages/mermaid/src/themes/theme-redux.js:331` | Right but unprovable | The installed Khroma method barrel exports `adjust` through the extensionless re-export. |
| `unresolved/any-receiver` | excalidraw/excalidraw | `excalidraw-app/components/AI.tsx:42` | Right but unprovable | `GenerateDiagramToCode` declares `children` as a readonly array. The installed program loses the callback receiver type. |
| `unresolved/external` | trpc/trpc | `tooling/release/src/release.test.ts:1` | Right but unprovable | The installed `@effect/platform-node/dist/index.d.ts` explicitly exports the `NodeServices` namespace. |
| `unresolved/external-package` | trpc/trpc | `examples/next-prisma-websockets-starter/src/pages/about.tsx:13` | Right but unprovable | The physical `file:` copy exports the same `spinner.tsx` bytes. The copy supplies no declaration. |
| `unresolved/incomplete-config` | withastro/astro | `packages/astro/e2e/fixtures/actions-blog/src/db/store.ts:6` | Right but unprovable | The source explicitly imports the Node builtin. The owning config is incomplete. |
| `unresolved/library-member-written` | puppeteer/puppeteer | `packages/puppeteer-core/src/util/disposable.ts:42` | Genuinely ambiguous | The checkout polyfill and the standard declarations both contribute. The source conditionally installs the property. |
| `unresolved/local` | withastro/astro | `packages/astro/test/units/fs/empty-dir.test.ts:47` | Right but unprovable | The local constant saves `fs.rmdirSync` before the test replaces it. |
| `unresolved/no-symbol` | dexie/Dexie.js | `tools/build-configs/rollup.config.js:17` | Right but unprovable | The default builtin `path` import names the correct Node API. The installed graph loses the synthetic default's member. |
| `unresolved/object-producer-unverified` | trpc/trpc | `packages/tests/server/regression/issue-3359-http-status-413-payload-too-large.test.ts:72` | Right but unprovable | The local server factory returns the named `close` method called here. |
| `unresolved/workspace-manifest-unreadable` | vitejs/vite | `playground/ssr-noexternal/src/entry-server.js:1` | Right but unprovable | The physical `file:` copy has the byte-identical entry exporting the fixture module. |
| `candidate-set` | trpc/trpc | `www/build/feeds.ts:7` | Genuinely ambiguous | The installed program has both the Vite interface and a Vitest augmentation. The reference is to the whole type. |
| `installed-declaration` | mermaid-js/mermaid | `packages/mermaid/src/themes/theme-redux.js:337` | Right but unprovable | The installed Khroma method barrel exports `lighten` through the extensionless re-export. |
| `unresolved/external` | trpc/trpc | `packages/react-query/test/polymorphism.test.tsx:26` | Right but unprovable | The installed Zod 3.25.76 entry imports and exports `z`. |
| `unresolved/external-package` | trpc/trpc | `examples/next-prisma-starter/src/pages/index.tsx:109` | Right but unprovable | The installed `file:` copy exports the checkout's `Skeleton` implementation. The copy supplies no declaration. |
| `unresolved/incomplete-config` | withastro/astro | `examples/toolbar-app/src/integration.ts:1` | Right but unprovable | The source explicitly imports the Node builtin. The initializer still has an incomplete config. |
| `unresolved/local` | puppeteer/puppeteer | `test/src/mocha-utils.ts:498` | Right but unprovable | The return type refers to the local type parameter in `Matchers<R>`. |
| `unresolved/no-symbol` | dexie/Dexie.js | `addons/Dexie.Observable/tools/build-configs/rollup.config.mjs:23` | Right but unprovable | The imported Node `path` API provides `resolve`, although this compiler program leaves the selector without a symbol. |
| `unresolved/object-producer-unverified` | trpc/trpc | `packages/tests/server/regression/issue-7446-express5-body-parser-formdata.test.ts:80` | Right but unprovable | The `startServer()` result owns the `close` property in this test. |
| `unresolved/workspace-manifest-unreadable` | vitejs/vite | `playground/ssr-deps/external-using-external-entry/index.js:5` | Right but unprovable | The local fixture dependency's entry exports `getMessage`. Its installed copy has no declaration. |
| `candidate-set` | excalidraw/excalidraw | `packages/excalidraw/components/PublishLibrary.tsx:25` | Genuinely ambiguous | Vite and the checkout each supply a wildcard declaration for SCSS imports. |
| `installed-declaration` | mermaid-js/mermaid | `packages/mermaid/src/themes/theme-neo.js:70` | Right but unprovable | The installed Khroma method barrel exports `invert` through the extensionless re-export. |
| `unresolved/external` | excalidraw/excalidraw | `packages/excalidraw/components/TTDDialog/TTDDialogTabTrigger.tsx:1` | Right but unprovable | `radix-ui`'s installed declaration exports `reactTabs` as `Tabs`. |
| `unresolved/external-package` | trpc/trpc | `examples/next-prisma-websockets-starter/src/pages/about.tsx:36` | Right but unprovable | The installed `file:` copy exports the same `CardDescription` implementation. The copy supplies no declaration. |
| `unresolved/incomplete-config` | withastro/astro | `packages/astro/e2e/fixtures/actions-blog/src/db/store.ts:6` | Right but unprovable | The source explicitly imports the Node builtin. The owning config is incomplete. |
| `unresolved/local` | withastro/astro | `packages/astro/test/units/fs/empty-dir.test.ts:36` | Right but unprovable | The local constant saves `fs.rmSync` before the test replaces it. |
| `unresolved/no-symbol` | dexie/Dexie.js | `tools/build-configs/rollup.config.mjs:10` | Right but unprovable | `dirname` is a named member of the source's default Node `path` import. |
| `unresolved/object-producer-unverified` | excalidraw/excalidraw | `packages/excalidraw/subset/woff2/woff2-bindings.ts:887` | Right but unprovable | The generated wrapper's local `FS` object declares `error` on line 863 and calls it through the same object. |
