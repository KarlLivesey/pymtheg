# C-3 review source audit

The seed `c-3-review:b04f14fa` selected eight local calls, five workspace
links, five scoped references and two existing plain-local references that
gained definite targets. The draw
excluded links with recorded assumptions. All 20 matched the pinned source.
The declaration location includes any decorators or the binding's statement.
[Draw and comparison](compare.mjs)

| Repository | Source site | Target and declaration | Source check |
| --- | --- | --- | --- |
| nestjs/nest | `packages/microservices/client/client-kafka.ts:555` | `cleanup` at line 553 | `errorCallback` closes over the arrow in `publish`. |
| nestjs/nest | `packages/common/services/console-logger.service.ts:806` | `hasToJSON` at line 803 | The arrow called by `deferToJSON` is declared in the enclosing method. |
| vitest-dev/vitest | `packages/browser/src/client/client.ts:66` | `check` at line 59 | The call and function declaration share the promise callback. |
| excalidraw/excalidraw | `packages/excalidraw/tests/clipboard.test.tsx:865` | `dispatchClipboardEvent` at line 842 | The cut test closes over the arrow in its `describe` callback. |
| nestjs/nest | `packages/platform-node/test/router/node-router.spec.ts:787` | `record` at line 776 | The test callback calls the helper in the `path prefixes` suite. |
| honojs/hono | `src/jsx/dom/index.test.tsx:1996` | `TodoApp` at line 1981 | The JSX tag names the arrow in the same test callback. |
| pingdotgg/t3code | `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts:563` | `createHarness` at line 220 | The test is under the `ProviderRuntimeIngestion` suite that declares this helper. |
| trpc/trpc | `packages/tests/server/headers.test.tsx:159` | `createTestCtx` at line 24 | The callback closes over the test suite's local arrow. |
| withastro/astro | `packages/integrations/mdx/src/index.ts:15` | `AstroRenderer` in `packages/runtime/src/types.ts:70` | The MDX build references Astro. Astro re-exports this type through its integrations types and `@astrojs/vite-plugin-astro`, which re-exports `@astrojs/runtime/types`. |
| withastro/astro | `packages/astro/test/units/render/transitions.test.ts:263` | `renderTransition` in `packages/runtime/src/internal/server/transition.ts:88` | The import uses the runtime package's `_internal/*` export. The test project references Astro's build, which references the runtime build with `src` and `dist` configured. |
| trpc/trpc | `www/src/components/page-actions.tsx:1` | `buttonVariants` in `tooling/ui/src/components/button.tsx:5` | `www` declares `@shared/ui` as `workspace:*`. Its `./components/*` export maps to `./src/components/*.tsx`, and the entry exports the binding. |
| vitest-dev/vitest | `packages/vitest/src/runtime/moduleRunner/errorCatcher.ts:2` | `serializeValue` in `packages/utils/src/serialize.ts:31` | `@vitest/utils` is a workspace dependency. The config enables the `__vitest_source__` condition selected by the `./serialize` export. |
| withastro/astro | `packages/astro/test/units/middleware/sequence.test.ts:26` | `MiddlewareHandler` in `packages/astro/src/types/public/common.ts:124` | The project references Astro's build. `astro` re-exports its public types, which re-export `common`. |
| nestjs/nest | `integration/module-utils/test/integration-module.spec.ts:56` | `FeatureModule` at line 51 | This is the enclosing test's class binding used as a receiver. |
| reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/buildHooks.test-d.tsx:324` | `typedSelectFromResult` at line 315 | The property value inside `PostsList` references the enclosing arrow. |
| reduxjs/redux-toolkit | `packages/toolkit/src/tests/createAsyncThunk.test-d.ts:578` | `returnsNumWithArgs` at line 574 | The option value takes the arrow from the same test callback. |
| nestjs/nest | `packages/platform-node/multer/interceptors/file-fields.interceptor.ts:73` | `MixinInterceptor` at line 37 | The `mixin` argument is the class declared in the interceptor factory. |
| honojs/hono | `src/jsx/dom/index.test.tsx:1395` | `App` at line 1384 | The JSX tag references the arrow declared in the `assign undefined` test. |
| react-hook-form/react-hook-form | `src/__typetest__/path/common.test-d.ts:270` | `actual` at line 267, recorded on the module symbol | The `typeof` refers to the constant in the same explicit block. The adjacent tests' own `actual` declarations are outside that block. |
| withastro/astro | `packages/astro/src/core/server-islands/endpoint.ts:205` | `ServerIsland` at line 204, recorded on the `page` symbol | The function expression's `this` type uses the constant inside the `isAstroComponentFactory` branch. The binding span selects that declaration. |
