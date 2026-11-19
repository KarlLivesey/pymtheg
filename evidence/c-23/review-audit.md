# Review audit of changed TypeScript names

The draw uses seed `pymtheg-c23-qualified-2026`. I checked the source site,
the compiler declaration and the installed file and manifest for each link.
All 60 links across 15 pins were right. Zero were wrong or indeterminate.
The real Volar probe separately checks both direct calls and the union call.
[Compiler and file witnesses](review-audit.json.gz) · [Volar query results](review-volar.json)

| Pin | Source site | New library target | Declaration line |
| --- | --- | --- | ---: |
| reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/buildHooks.test.tsx:2112` | `@testing-library/user-event@14.6.1` · `dist/types/setup/api.d.ts:userEventApi.click` | 7 |
| reduxjs/redux-toolkit | `packages/rtk-query-codegen-openapi/test/fixtures/generated.ts:70` | `@reduxjs/toolkit@1.9.7` · `dist/query/endpointDefinitions.d.ts:EndpointBuilder.query` | 497 |
| reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/createApi.test.ts:1235` | `msw@2.1.5` · `lib/core/http.d.ts:http.get` | 20 |
| reduxjs/redux-toolkit | `packages/rtk-query-codegen-openapi/test/mocks/server.ts:42` | `msw@2.1.5` · `lib/core/http.d.ts:http.get` | 20 |
| vitest-dev/vitest | `test/ui/test/ui.spec.ts:374` | `playwright@1.64.1` · `types/test.d.ts:LocatorAssertions.prototype.toContainText` | 9569 |
| vitest-dev/vitest | `test/ui/test/trace-stream.spec.ts:184` | `playwright@1.64.1` · `types/test.d.ts:GenericAssertions.prototype.toEqual` | 8754 |
| vitest-dev/vitest | `test/ui/test/ui.spec.ts:585` | `playwright@1.64.1` · `types/test.d.ts:LocatorAssertions.prototype.toBeVisible` | 9448 |
| vitest-dev/vitest | `test/ui/test/ui.spec.ts:419` | `playwright@1.64.1` · `types/test.d.ts:LocatorAssertions.prototype.toContainText` | 9569 |
| nestjs/nest | `integration/versioning/e2e/media-type-versioning.spec.ts:268` | `superagent@8.1.9` · `lib/node/index.d.ts:SARequest.prototype.set` | 93 |
| nestjs/nest | `integration/versioning/e2e/header-versioning.spec.ts:229` | `superagent@8.1.9` · `lib/node/index.d.ts:SARequest.prototype.set` | 93 |
| nestjs/nest | `integration/versioning/e2e/custom-versioning-node.spec.ts:218` | `superagent@8.1.9` · `lib/node/index.d.ts:SARequest.prototype.set` | 93 |
| nestjs/nest | `integration/file-upload/e2e/parity.spec.ts:331` | `superagent@8.1.9` · `lib/node/index.d.ts:SARequest.prototype.attach` | 36 |
| react-hook-form/react-hook-form | `e2e/basicSchemaValidation.spec.ts:164` | `playwright@1.61.1` · `types/test.d.ts:LocatorAssertions.prototype.toContainText` | 9056 |
| react-hook-form/react-hook-form | `e2e/formStateWithNestedFields.spec.ts:142` | `playwright@1.61.1` · `types/test.d.ts:GenericAssertions.prototype.toEqual` | 8317 |
| react-hook-form/react-hook-form | `e2e/useFieldArray.spec.ts:45` | `playwright@1.61.1` · `types/test.d.ts:LocatorAssertions.prototype.toHaveValue` | 9630 |
| react-hook-form/react-hook-form | `e2e/useFieldArray.spec.ts:88` | `playwright@1.61.1` · `types/test.d.ts:GenericAssertions.prototype.toEqual` | 8317 |
| withastro/astro | `packages/astro/e2e/view-transitions.test.ts:492` | `playwright@1.65.0` · `types/test.d.ts:GenericAssertions.prototype.toEqual` | 9078 |
| withastro/astro | `packages/astro/test/units/config/config-vite-load.test.ts:28` | `fs-fixture@2.16.2` · `dist/index.d.mts:FsFixture.prototype.getPath` | 78 |
| withastro/astro | `packages/astro/e2e/multiple-frameworks.test.ts:141` | `playwright@1.65.0` · `types/test.d.ts:LocatorAssertions.prototype.toHaveText` | 10545 |
| withastro/astro | `packages/astro/e2e/nested-recursive.test.ts:64` | `playwright@1.65.0` · `types/test.d.ts:LocatorAssertions.prototype.toHaveText` | 10545 |
| honojs/hono | `src/client/client.test.ts:464` | `msw@2.15.0` · `lib/core/http.d.mts:http.post` | 24 |
| honojs/hono | `src/client/client.test.ts:490` | `msw@2.15.0` · `lib/core/http.d.mts:http.post` | 24 |
| honojs/hono | `src/client/utils.test.ts:278` | `msw@2.15.0` · `lib/core/http.d.mts:http.get` | 23 |
| honojs/hono | `src/client/client.test.ts:2009` | `msw@2.15.0` · `lib/node/index.d.mts:SetupServerCommon.prototype.close` | 25 |
| trpc/trpc | `packages/react-query/test/useInfiniteQuery.test.tsx:349` | `@testing-library/user-event@14.6.8` · `dist/types/setup/index.d.ts:userEvent.click` | 7 |
| trpc/trpc | `packages/react-query/test/useInfiniteQuery.test.tsx:312` | `@testing-library/user-event@14.6.8` · `dist/types/setup/index.d.ts:userEvent.click` | 7 |
| trpc/trpc | `tooling/ui/src/components/questionnaire.tsx:13` | `@shadcn/react@0.3.1` · `dist/questionnaire/index.d.ts:Questionnaire.Root` | 110 |
| trpc/trpc | `tooling/ui/src/components/questionnaire.tsx:185` | `@shadcn/react@0.3.1` · `dist/questionnaire/index.d.ts:Questionnaire.Error` | 121 |
| vitejs/vite | `playground/worker/__tests__/iife/worker-iife.spec.ts:177` | `vitest@5.1.0` · `dist/chunks/config.d.B3YV4t0O.d.ts:ExtendedAPI.prototype.skipIf` | 2844 |
| vitejs/vite | `packages/create-vite/src/index.ts:458` | `@clack/prompts@1.9.0` · `dist/index.d.mts:log.step` | 603 |
| vitejs/vite | `playground/vitestGlobalSetup.ts:25` | `vitest@5.1.0` · `dist/chunks/plugin.d.LRFSN46m.d.ts:StateManager.prototype.getPaths` | 2373 |
| vitejs/vite | `playground/hmr/__tests__/ws.spec.ts:10` | `vitest@5.1.0` · `dist/chunks/config.d.B3YV4t0O.d.ts:ExtendedAPI.prototype.runIf` | 2845 |
| mermaid-js/mermaid | `e2e/rendering/er/nightly-check/erDiagram.spec.js:41` | `playwright@1.62.1` · `types/test.d.ts:GenericAssertions.prototype.toMatch` | 8502 |
| mermaid-js/mermaid | `e2e/other/pr-check/interaction.spec.js:11` | `playwright@1.62.1` · `types/test.d.ts:LocatorAssertions.prototype.toHaveText` | 9907 |
| mermaid-js/mermaid | `e2e/other/pr-check/configuration.spec.js:149` | `playwright@1.62.1` · `types/test.d.ts:LocatorAssertions.prototype.toContainText` | 9261 |
| mermaid-js/mermaid | `packages/mermaid/src/rendering-util/rendering-elements/shapes/invertedTrapezoid.ts:36` | `roughjs@4.6.6` · `bin/rough.d.ts:_default.svg` | 7 |
| excalidraw/excalidraw | `packages/excalidraw/components/LayerUI.tsx:619` | `tunnel-rat@0.1.2` · `dist/index.d.ts:ReturnType<typeof tunnel>.Out` | 7 |
| excalidraw/excalidraw | `packages/excalidraw/components/MobileMenu.tsx:85` | `tunnel-rat@0.1.2` · `dist/index.d.ts:ReturnType<typeof tunnel>.Out` | 7 |
| excalidraw/excalidraw | `packages/excalidraw/components/TTDDialog/TTDDialogTrigger.tsx:22` | `tunnel-rat@0.1.2` · `dist/index.d.ts:ReturnType<typeof tunnel>.In` | 6 |
| excalidraw/excalidraw | `packages/excalidraw/components/CommandPalette/CommandPalette.tsx:401` | `jotai@2.11.0` · `esm/vanilla/store.d.mts:Store.set` | 75 |
| changesets/changesets | `packages/cli/src/commands/publish-plan/index.ts:57` | `@clack/prompts@1.8.1` · `dist/index.d.mts:log.info` | 600 |
| changesets/changesets | `packages/cli/src/cli.ts:204` | `@clack/prompts@1.8.1` · `dist/index.d.mts:log.error` | 606 |
| changesets/changesets | `packages/cli/src/commands/status/index.ts:44` | `@clack/prompts@1.8.1` · `dist/index.d.mts:log.error` | 606 |
| changesets/changesets | `packages/cli/src/commands/version/index.ts:148` | `@clack/prompts@1.8.1` · `dist/index.d.mts:log.success` | 601 |
| oclif/core | `src/help/index.ts:130` | `ansis@3.17.0` · `index.d.ts:SP.prototype.strip` | 1 |
| oclif/core | `src/ux/action/spinner.ts:68` | `ansis@3.17.0` · `index.d.ts:SP.prototype.strip` | 1 |
| oclif/core | `src/help/command.ts:405` | `ansis@3.17.0` · `index.d.ts:SP.prototype.strip` | 1 |
| oclif/core | `test/ux/theme.test.ts:20` | `ansis@3.17.0` · `index.d.ts:SP.prototype.hex` | 1 |
| puppeteer/puppeteer | `test/src/locator.test.ts:1115` | `@sinonjs/fake-timers@15.4.0` · `types/fake-timers-src.d.ts:Clock.tick` | 197 |
| puppeteer/puppeteer | `tools/eslint/src/prettier-comments.ts:14` | `@prettier/sync@0.6.1` · `index.d.cts:SynchronizedPrettier.resolveConfigFile` | 14 |
| puppeteer/puppeteer | `packages/puppeteer-core/src/util/Deferred.test.ts:53` | `@sinonjs/fake-timers@15.4.0` · `types/fake-timers-src.d.ts:Clock.tick` | 197 |
| puppeteer/puppeteer | `tools/eslint/src/no-quirks-mode-set-content.ts:88` | `@typescript-eslint/utils@8.26.1` · `dist/ts-eslint/SourceCode.d.ts:SourceCodeBase.prototype.getText` | 200 |
| pmndrs/zustand | `src/middleware/devtools.ts:546` | `@redux-devtools/extension@4.0.0` · `lib/index.d.ts:ConnectResponse.prototype.send` | 215 |
| pmndrs/zustand | `src/middleware/devtools.ts:282` | `@redux-devtools/extension@4.0.0` · `lib/index.d.ts:ConnectResponse.prototype.send` | 215 |
| pmndrs/zustand | `src/middleware/devtools.ts:345` | `@redux-devtools/extension@4.0.0` · `lib/index.d.ts:ConnectResponse.prototype.init` | 214 |
| pmndrs/zustand | `src/middleware/devtools.ts:501` | `@redux-devtools/extension@4.0.0` · `lib/index.d.ts:ConnectResponse.prototype.init` | 214 |
| dexie/Dexie.js | `samples/dexie-cloud-todo-app/src/App.test.tsx:18` | `@testing-library/user-event@14.6.1` · `dist/types/setup/api.d.ts:userEventApi.click` | 7 |
| dexie/Dexie.js | `samples/dexie-cloud-todo-app/src/components/ui/dropdown-menu.tsx:39` | `react@18.3.27` · `index.d.ts:React.Children.only` | 800 |
| dexie/Dexie.js | `samples/dexie-cloud-todo-app/src/components/ui/dropdown-menu.tsx:100` | `react@18.3.27` · `index.d.ts:React.Children.map` | 794 |
| dexie/Dexie.js | `samples/dexie-cloud-todo-app/src/App.test.tsx:12` | `@testing-library/user-event@14.6.1` · `dist/types/setup/index.d.ts:userEvent.setup` | 5 |
