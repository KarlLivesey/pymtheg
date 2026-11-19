# Source audit

The seed `c-7:4c3bed4d` ranks each newly definite site from the matched pins.
The draw takes the ten lowest ranks in each of the generic-reference and
member groups. Each site existed on main and the candidate recorded no
failed-file assumption for it. All 20 targets matched the pinned source.

| Group | Repository | Source | Use | Target and declaration | Source check |
| --- | --- | --- | --- | --- | --- |
| generic | puppeteer/puppeteer | `packages/puppeteer-core/src/common/types.ts:114` | `ComplexSelector` | `NodeFor` at `same file:113` | `NodeFor` declares `ComplexSelector` and passes it to `ParseSelector`. |
| generic | pingdotgg/t3code | `apps/server/src/observability/RpcInstrumentation.ts:67` | `E` | `recordRpcStreamMetrics` at `same file:64` | The arrow’s `<E>` binds the argument of `Exit.Exit`. |
| generic | trpc/trpc | `packages/openapi/test/routers/edgeCaseRouter-heyapi/sdk.gen.ts:92` | `ThrowOnError` | `Sdk.voidInput` at `same file:92` | The generic on `voidInput` supplies the `Options` type argument in the same signature. |
| generic | withastro/astro | `packages/astro/src/content/data-store-source.ts:19` | `T` | `DataStoreSource.values` at `same file:19` | `values` declares its own `T` with the `DataEntry` default. |
| generic | honojs/hono | `src/types.ts:783` | `I3` | `HandlerInterface` at `same file:780` | The `I6` default names `I3` declared earlier in that overload. |
| generic | honojs/hono | `src/types.ts:1916` | `MergedPath` | `OnHandlerInterface` at `same file:1874` | `H<E8, MergedPath, I7>` uses the `MergedPath` of its own overload. |
| generic | honojs/hono | `src/helper/factory/index.ts:163` | `E4` | `CreateHandlersInterface` at `same file:155` | The third handler names `E4` from the surrounding generic signature. |
| generic | honojs/hono | `src/types.ts:1650` | `MergedPath` | `OnHandlerInterface` at `same file:1632` | The `M4` constraint names the path parameter declared in its overload. |
| generic | puppeteer/puppeteer | `packages/puppeteer-core/src/api/ElementHandle.ts:497` | `Selector` | `ElementHandle.$eval` at `same file:494` | `NodeFor<Selector>` appears inside the same `$eval` signature as `Selector`. |
| generic | honojs/hono | `src/types.ts:844` | `I2` | `HandlerInterface` at `same file:840` | The default of `I6` uses the `I2` declared in that overload. |
| member | trpc/trpc | `packages/tests/server/websockets.test.ts:3926` | `oldFrames.release` | `holdFrames.[return].[object].release` at `same file:1998` | `oldFrames` receives `holdFrames` at line 3907 and calls its returned `release`. |
| member | trpc/trpc | `packages/tests/server/websockets.test.ts:2940` | `newEvents?.release` | `holdFrames.[return].[object].release` at `same file:1998` | `newEvents` receives `holdFrames` at line 2901 and calls `release` if present. |
| member | reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/ownRequestResult.test.ts:357` | `gate.resolveOldest` | `createDeferredQueue.[return].[object].resolveOldest` at `same file:10` | `gate` receives `createDeferredQueue()` at line 34, whose return has `resolveOldest`. |
| member | trpc/trpc | `packages/tests/server/websockets.test.ts:4010` | `oldFrames.release` | `holdFrames.[return].[object].release` at `same file:1998` | `oldFrames` receives `holdFrames` at line 3990 and calls its returned `release`. |
| member | excalidraw/excalidraw | `packages/element/src/store.ts:131` | `CaptureUpdateAction.NEVER` | `CaptureUpdateAction.[object].NEVER` at `same file:56` | `typeof` selects `NEVER` from the named `CaptureUpdateAction` object at line 38. |
| member | withastro/astro | `packages/astro/src/runtime/client/dev-toolbar/apps/audit/index.ts:53` | `settings.logger.verboseLog` | `getSettings.[return].[object].logger.verboseLog` at `packages/astro/src/runtime/client/dev-toolbar/settings.ts:62` | The imported `settings` is initialized by `getSettings`, whose `logger` exposes `verboseLog`. |
| member | trpc/trpc | `packages/tests/server/websocketsLifecycle.test.ts:700` | `cleanup.resolve` | `createDeferred.[return].[object].resolve` at `packages/server/src/unstable-core-do-not-import/stream/utils/createDeferred.ts:10` | `cleanup` receives `createDeferred` at line 649 and calls its `resolve` property. |
| member | pingdotgg/t3code | `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts:617` | `harness.emit` | `[callback:e423f8d2ebdcf1f1].createHarness.[return].[object].emit` at `same file:315` | The awaited `createHarness` result at line 614 contains the declared `emit` property. |
| member | mermaid-js/mermaid | `packages/mermaid/src/diagrams/railroad/styles.spec.ts:24` | `themes.dark.getThemeVariables` | `default.[object].dark.getThemeVariables` at `packages/mermaid/src/themes/index.js:18` | The imported themes default object declares `dark.getThemeVariables`. |
| member | dexie/Dexie.js | `addons/dexie-cloud/src/sync/syncWithServer.ts:76` | `TSON.stringify` | `TypesonSimplified.[return].[object].stringify` at `libs/dexie-cloud-common/src/tson/TypesonSimplified.ts:40` | The imported `TSON` is constructed by `TypesonSimplified` in `addons/dexie-cloud/src/TSON.ts:100`. |

[Comparison and sampling script](compare.mjs)
