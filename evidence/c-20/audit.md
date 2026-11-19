# Hand audit of installed declaration targets

Seed `pymtheg-c20-2026`. Ten newly named installed library targets per pin, drawn in rank order within each of the six pins. Each check traces the pinned source through its import, compiler context or receiver type to the captured declaration. Overloads of one declaration symbol count as one target.

**60 correct, 0 wrong, 0 unverifiable.**

Excalidraw’s Jest global uses are governed by `packages/tsconfig.base.json`. The separate root configuration requests Vitest globals. Hono’s `describe` is an explicit `bun:test` import whose declaration comes from `bun-types`.

| Pin | Checkout site | Stored unit, version and symbol | Installed declaration | Result |
| --- | --- | --- | --- | --- |
| react-hook-form/react-hook-form | `src/useWatch.ts:133` | `react@19.2.17 · React.useRef` | `node_modules/.pnpm/@types+react@19.2.17/node_modules/@types/react/index.d.ts:1737` | Right |
| vitejs/vite | `playground/hmr-full-bundle-mode/__tests__/hmr-full-bundle-mode.spec.ts:423` | `vitest@5.1.0 · ExpectStatic.prototype.poll` | `node_modules/.pnpm/vitest@5.1.0_@types+node@26.6.6_vite@packages+vite/node_modules/vitest/dist/chunks/task-utils.d.D-gFPNFi.d.ts:33` | Right |
| puppeteer/puppeteer | `test/src/navigation.test.ts:624` | `mocha@10.0.10 · Mocha.Context.prototype.timeout` | `node_modules/@types/mocha/index.d.ts:1344` | Right |
| reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/createApi.test.ts:1121` | `vitest@5.0.0 · JestAssertion.prototype.toHaveBeenCalled` | `node_modules/vitest/dist/chunks/config.d.CU_b-wJj.d.ts:1538` | Right |
| excalidraw/excalidraw | `packages/excalidraw/tests/stickyNotes.test.tsx:612` | `jest@27.4.0 · it` | `node_modules/@types/jest/index.d.ts:41` | Right |
| honojs/hono | `src/types.test.ts:1453` | `expect-type@1.4.0 · PositiveExpectTypeOf.prototype.toEqualTypeOf` | `node_modules/.pnpm/expect-type@1.4.0/node_modules/expect-type/dist/index.d.ts:51` | Right |
| react-hook-form/react-hook-form | `src/__tests__/utils/deepEqual.test.ts:113` | `jest@30.0.0 · expect` | `node_modules/.pnpm/@types+jest@30.0.0/node_modules/@types/jest/index.d.ts:14` | Right |
| vitejs/vite | `playground/ssr-conditions/__tests__/ssr-conditions.spec.ts:24` | `playwright-core@1.65.1 · Page.prototype.goto` | `node_modules/.pnpm/playwright-core@1.65.1/node_modules/playwright-core/types/types.d.ts:3541` | Right |
| puppeteer/puppeteer | `packages/browsers/src/CLI.ts:281` | `yargs@17.0.35 · yargs.Argv.prototype.example` | `packages/browsers/node_modules/@types/yargs/index.d.ts:354` | Right |
| reduxjs/redux-toolkit | `packages/rtk-query-codegen-openapi/test/vitest.setup.ts:5` | `vitest@5.0.0 · VitestUtils.prototype.stubGlobal` | `packages/rtk-query-codegen-openapi/node_modules/vitest/dist/index.d.ts:799` | Right |
| excalidraw/excalidraw | `packages/excalidraw/components/hoc/withInternalFallback.test.tsx:74` | `@testing-library/dom@10.4.0 · queryAllByTestId` | `node_modules/@testing-library/dom/types/queries.d.ts:307` | Right |
| honojs/hono | `src/types.test.ts:1819` | `expect-type@1.4.0 · PositiveExpectTypeOf.prototype.toEqualTypeOf` | `node_modules/.pnpm/expect-type@1.4.0/node_modules/expect-type/dist/index.d.ts:51` | Right |
| react-hook-form/react-hook-form | `src/__tests__/logic/getValidationModes.test.ts:14` | `jest@30.0.0 · jest.Matchers.prototype.toEqual` | `node_modules/.pnpm/@types+jest@30.0.0/node_modules/@types/jest/index.d.ts:930` | Right |
| vitejs/vite | `playground/css/__tests__/tests.ts:131` | `vitest@5.1.0 · globalExpect` | `node_modules/.pnpm/vitest@5.1.0_@types+node@26.6.6_vite@packages+vite/node_modules/vitest/dist/index.d.ts:84` | Right |
| puppeteer/puppeteer | `test/src/navigation.test.ts:753` | `expect@30.5.2 · Matchers.prototype.toBe` | `node_modules/expect/build/index.d.ts:107` | Right |
| reduxjs/redux-toolkit | `packages/toolkit/src/tests/getDefaultEnhancers.test-d.ts:141` | `expect-type@1.4.0 · NegativeExpectTypeOf.prototype.toHaveProperty` | `node_modules/expect-type/dist/index.d.ts:499` | Right |
| excalidraw/excalidraw | `packages/excalidraw/tests/fileDrop.test.tsx:243` | `@testing-library/dom@10.4.0 · waitFor` | `node_modules/@testing-library/dom/types/wait-for.d.ts:9` | Right |
| honojs/hono | `src/types.test.ts:1864` | `expect-type@1.4.0 · PositiveExpectTypeOf.prototype.toEqualTypeOf` | `node_modules/.pnpm/expect-type@1.4.0/node_modules/expect-type/dist/index.d.ts:51` | Right |
| react-hook-form/react-hook-form | `src/__tests__/utils/get.test.ts:14` | `jest@30.0.0 · expect` | `node_modules/.pnpm/@types+jest@30.0.0/node_modules/@types/jest/index.d.ts:14` | Right |
| vitejs/vite | `playground/wasm/__tests__/wasm.spec.ts:6` | `playwright-core@1.65.1 · Page.prototype.textContent` | `node_modules/.pnpm/playwright-core@1.65.1/node_modules/playwright-core/types/types.d.ts:5106` | Right |
| puppeteer/puppeteer | `test/src/cookies.test.ts:91` | `expect@30.5.2 · Matchers.prototype.toContain` | `node_modules/expect/build/index.d.ts:168` | Right |
| reduxjs/redux-toolkit | `packages/toolkit/src/query/core/buildMiddleware/types.ts:84` | `redux@5.0.1 · UnknownAction` | `node_modules/redux/dist/redux.d.ts:26` | Right |
| excalidraw/excalidraw | `packages/excalidraw/tests/history.test.tsx:5235` | `jest@27.4.0 · jest.Expect.prototype.arrayContaining` | `node_modules/@types/jest/index.d.ts:689` | Right |
| honojs/hono | `adapters/bun/src/websocket.test.ts:224` | `bun-types@1.4.2 · describe` | `node_modules/.pnpm/bun-types@1.4.2/node_modules/bun-types/test.d.ts:299` | Right |
| react-hook-form/react-hook-form | `src/__tests__/useFieldArray/remove.test.tsx:451` | `jest@30.0.0 · jest.Matchers.prototype.toEqual` | `node_modules/.pnpm/@types+jest@30.0.0/node_modules/@types/jest/index.d.ts:930` | Right |
| vitejs/vite | `packages/vite/src/node/plugins/wasm.ts:156` | `magic-string@1.4.5 · MagicString.prototype.appendLeft` | `node_modules/.pnpm/magic-string@1.4.5/node_modules/magic-string/dist/index.d.mts:111` | Right |
| puppeteer/puppeteer | `test/src/input.test.ts:178` | `expect@30.5.2 · Matchers.prototype.toBe` | `node_modules/expect/build/index.d.ts:107` | Right |
| reduxjs/redux-toolkit | `packages/toolkit/src/tests/createEntityAdapter.test-d.ts:82` | `vitest@5.0.0 · expectTypeOf` | `node_modules/vitest/globals.d.ts:7` | Right |
| excalidraw/excalidraw | `packages/element/tests/bucketFill.test.ts:1330` | `jest@27.4.0 · it` | `node_modules/@types/jest/index.d.ts:41` | Right |
| honojs/hono | `src/helper/factory/index.test.ts:170` | `expect-type@1.4.0 · PositiveExpectTypeOf.prototype.toEqualTypeOf` | `node_modules/.pnpm/expect-type@1.4.0/node_modules/expect-type/dist/index.d.ts:51` | Right |
| react-hook-form/react-hook-form | `src/__tests__/useForm/reset.test.tsx:1315` | `jest@30.0.0 · jest.Matchers.prototype.toEqual` | `node_modules/.pnpm/@types+jest@30.0.0/node_modules/@types/jest/index.d.ts:930` | Right |
| vitejs/vite | `playground/assets/__tests__/url-base/assets-url-base.spec.ts:100` | `vitest@5.1.0 · globalExpect` | `node_modules/.pnpm/vitest@5.1.0_@types+node@26.6.6_vite@packages+vite/node_modules/vitest/dist/index.d.ts:84` | Right |
| puppeteer/puppeteer | `test/installation/src/browsers.test.ts:12` | `mocha@10.0.10 · describe` | `node_modules/@types/mocha/index.d.ts:2686` | Right |
| reduxjs/redux-toolkit | `packages/toolkit/src/entities/tests/unsorted_state_adapter.test.ts:512` | `vitest@5.0.0 · JestAssertion.prototype.toEqual` | `node_modules/vitest/dist/chunks/config.d.CU_b-wJj.d.ts:1337` | Right |
| excalidraw/excalidraw | `packages/excalidraw/tests/history.test.tsx:4140` | `jest@27.4.0 · expect` | `node_modules/@types/jest/index.d.ts:47` | Right |
| honojs/hono | `runtime-tests/fastly/index.test.ts:93` | `vitest@5.0.1 · JestAssertion.prototype.toBe` | `node_modules/.pnpm/vitest@5.0.1_@types+node@24.13.6_@vitest+browser-preview@5.0.1_@vitest+coverage-v8@5.0._68c5305fb163089a9626a63dab7b643c/node_modules/vitest/dist/chunks/config.d.CU_b-wJj.d.ts:1353` | Right |
| react-hook-form/react-hook-form | `src/__tests__/logic/validateField.test.tsx:2577` | `jest@30.0.0 · jest.fn` | `node_modules/.pnpm/@types+jest@30.0.0/node_modules/@types/jest/index.d.ts:247` | Right |
| vitejs/vite | `packages/vite/src/node/server/__tests__/pluginContainer.spec.ts:2` | `magic-string@1.4.5 · default` | `node_modules/.pnpm/magic-string@1.4.5/node_modules/magic-string/dist/index.d.mts:399` | Right |
| puppeteer/puppeteer | `test/src/navigation.test.ts:1158` | `mocha@10.0.10 · it` | `node_modules/@types/mocha/index.d.ts:2721` | Right |
| reduxjs/redux-toolkit | `packages/toolkit/src/entities/tests/unsorted_state_adapter.test.ts:652` | `vitest@5.0.0 · JestAssertion.prototype.toEqual` | `node_modules/vitest/dist/chunks/config.d.CU_b-wJj.d.ts:1337` | Right |
| excalidraw/excalidraw | `packages/excalidraw/tests/history.test.tsx:4554` | `jest@27.4.0 · jest.Expect.prototype.objectContaining` | `node_modules/@types/jest/index.d.ts:718` | Right |
| honojs/hono | `src/utils/jwt/jwt.test.ts:913` | `buffer@24.13.6 · BufferConstructor.prototype.from` | `node_modules/.pnpm/@types+node@24.13.6/node_modules/@types/node/buffer.buffer.d.ts:162` | Right |
| react-hook-form/react-hook-form | `src/__tests__/logic/isWatched.test.ts:186` | `jest@30.0.0 · jest.Matchers.prototype.toBeFalsy` | `node_modules/.pnpm/@types+jest@30.0.0/node_modules/@types/jest/index.d.ts:857` | Right |
| vitejs/vite | `playground/hmr/__tests__/hmr.spec.ts:679` | `vitest@5.1.0 · JestAssertion.prototype.toContain` | `node_modules/.pnpm/vitest@5.1.0_@types+node@26.6.6_vite@packages+vite/node_modules/vitest/dist/chunks/config.d.B3YV4t0O.d.ts:1435` | Right |
| puppeteer/puppeteer | `tools/docgen/src/custom_markdown_documenter.ts:877` | `@microsoft/api-documenter@7.30.20 · DocTable.prototype.addRow` | `tools/docgen/node_modules/@microsoft/api-documenter/lib-dts/nodes/DocTable.d.ts:20` | Right |
| reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/useMutation-fixedCacheKey.test.tsx:107` | `vitest@5.0.0 · JestAssertion.prototype.toBe` | `node_modules/vitest/dist/chunks/config.d.CU_b-wJj.d.ts:1353` | Right |
| excalidraw/excalidraw | `packages/excalidraw/tests/regressionTests.test.tsx:577` | `jest@27.4.0 · it` | `node_modules/@types/jest/index.d.ts:41` | Right |
| honojs/hono | `runtime-tests/bun/index.test.tsx:35` | `vitest@5.0.1 · JestAssertion.prototype.toBe` | `node_modules/.pnpm/vitest@5.0.1_@types+node@24.13.6_@vitest+browser-preview@5.0.1_@vitest+coverage-v8@5.0._68c5305fb163089a9626a63dab7b643c/node_modules/vitest/dist/chunks/config.d.CU_b-wJj.d.ts:1353` | Right |
| react-hook-form/react-hook-form | `e2e/useFieldArray.spec.ts:48` | `playwright-core@1.61.1 · Locator.prototype.locator` | `node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/types/types.d.ts:14573` | Right |
| vitejs/vite | `packages/vite/src/node/build.ts:791` | `path@26.6.6 · path.join` | `node_modules/.pnpm/@types+node@26.6.6/node_modules/@types/node/path.d.ts:64` | Right |
| puppeteer/puppeteer | `packages/puppeteer-core/src/cdp/FrameManager.ts:631` | `devtools-protocol@0.0.1717327 · Protocol.Page.NavigationType` | `packages/puppeteer-core/node_modules/devtools-protocol/types/protocol.d.ts:17624` | Right |
| reduxjs/redux-toolkit | `packages/toolkit/src/tests/createAsyncThunk.test-d.ts:274` | `expect-type@1.4.0 · PositiveExpectTypeOf.prototype.toEqualTypeOf` | `node_modules/expect-type/dist/index.d.ts:51` | Right |
| excalidraw/excalidraw | `packages/excalidraw/tests/MermaidToExcalidraw.test.tsx:17` | `vitest@3.0.6 · VitestUtils.prototype.mock` | `node_modules/vitest/dist/index.d.ts:311` | Right |
| honojs/hono | `src/hono.test.ts:2490` | `expect-type@1.4.0 · PositiveExpectTypeOf.prototype.toEqualTypeOf` | `node_modules/.pnpm/expect-type@1.4.0/node_modules/expect-type/dist/index.d.ts:51` | Right |
| react-hook-form/react-hook-form | `e2e/basic.spec.ts:334` | `playwright-core@1.61.1 · Page.prototype.locator` | `node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/types/types.d.ts:3597` | Right |
| vitejs/vite | `packages/vite/src/node/utils.ts:1003` | `magic-string@1.4.5 · MagicString.prototype.hasChanged` | `node_modules/.pnpm/magic-string@1.4.5/node_modules/magic-string/dist/index.d.mts:258` | Right |
| puppeteer/puppeteer | `test/src/network.test.ts:1091` | `expect@30.5.2 · Matchers.prototype.toEqual` | `node_modules/expect/build/index.d.ts:179` | Right |
| reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/buildSlice.test.ts:409` | `vitest@5.0.0 · JestAssertion.prototype.toEqual` | `node_modules/vitest/dist/chunks/config.d.CU_b-wJj.d.ts:1337` | Right |
| excalidraw/excalidraw | `packages/excalidraw/tests/appStateHooks.test.tsx:97` | `jest@27.4.0 · jest.Expect.prototype.objectContaining` | `node_modules/@types/jest/index.d.ts:718` | Right |
| honojs/hono | `src/types.test.ts:3667` | `expect-type@1.4.0 · PositiveExpectTypeOf.prototype.toEqualTypeOf` | `node_modules/.pnpm/expect-type@1.4.0/node_modules/expect-type/dist/index.d.ts:51` | Right |
