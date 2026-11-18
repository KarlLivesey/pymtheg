# Fixed-build source audit

Seed `c-7:4c3bed4d` selected the ten lowest-ranked new generic references
and the ten lowest-ranked new member links against main in the Redux Toolkit,
Zustand, and yargs comparison. All 20 targets matched the pinned source.
The type queries describe member declarations. Their runtime calls follow
the existing declaration-only rule.

| Group | Repository | Source | Use | Target and declaration | Source check |
| --- | --- | --- | --- | --- | --- |
| generic | reduxjs/redux-toolkit | `packages/toolkit/src/createAsyncThunk.ts:615` | `ThunkArg` | `createAsyncThunk.[callback:c757dd0c2daa3313].createAsyncThunk` at `same file:536` | The argument of the nested action creator uses the type parameter of its enclosing `createAsyncThunk`. |
| generic | pmndrs/zustand | `src/react.ts:42` | `S` | `UseBoundStore` at `same file:39` | The intersection uses `S` from the declaration of `UseBoundStore`. |
| generic | reduxjs/redux-toolkit | `packages/toolkit/src/draftTypes.ts:47` | `T` | `WritableDraft` at `same file:43` | `WritableNonArrayDraft` takes `T` from the enclosing `WritableDraft` conditional type. |
| generic | reduxjs/redux-toolkit | `packages/toolkit/src/query/react/buildHooks.ts:156` | `QueryArg` | `TypedUseQueryHookResult` at `same file:150` | `TypedUseQuerySubscriptionResult` receives the type alias’s own `QueryArg`. |
| generic | reduxjs/redux-toolkit | `packages/rtk-query-codegen-openapi/src/types.ts:63` | `k` | `Optional` at `same file:63` | The indexed access uses the mapped type parameter `k` on the same line. |
| generic | reduxjs/redux-toolkit | `packages/toolkit/src/tsHelpers.ts:161` | `T` | `NonUndefined` at `same file:161` | The conditional type references the parameter of `NonUndefined`. |
| generic | reduxjs/redux-toolkit | `packages/toolkit/src/query/core/apiState.ts:360` | `D` | `MutationSubState` at `same file:352` | `BaseMutationSubState<D>` uses the `D` of `MutationSubState`. |
| generic | reduxjs/redux-toolkit | `packages/toolkit/src/listenerMiddleware/types.ts:420` | `Predicate` | `TakePattern` at `same file:417` | The result type refers to `Predicate` declared on that overload. |
| generic | reduxjs/redux-toolkit | `packages/toolkit/src/tsHelpers.ts:193` | `Tail` | `Tail` at `same file:192` | The true branch refers to the `infer Tail` binding on the previous line. |
| generic | reduxjs/redux-toolkit | `packages/toolkit/src/entities/sorted_state_adapter.ts:75` | `Id` | `createSortedStateAdapter` at `same file:52` | The nested routine’s `Set` uses the outer adapter factory’s `Id` parameter. |
| member | reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/optimisticUpdates.test.tsx:266` | `api.util.updateQueryData` | `ApiUtil.[type].updateQueryData` at `packages/toolkit/src/query/core/module.ts:336` | The `typeof` query selects `updateQueryData` through `ApiModules.util`, which has type `ApiUtil`. |
| member | reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/getRunningQuery.test.ts:151` | `ctx.hasEntry` | `setup.[return].[object].hasEntry` at `same file:43` | `ctx` comes from `setup` at line 144, whose returned object declares `hasEntry`. |
| member | reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/buildMiddleware.test.tsx:394` | `api.middleware` | `ApiModules.[coreModuleName].[type].middleware` at `packages/toolkit/src/query/core/module.ts:172` | The cast’s `typeof api.middleware` refers to the core module’s declared middleware property. |
| member | reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/raceConditions.test.ts:154` | `getEatenBananaPromises.resolveOldest` | `createPromiseFactory.[return].[object].resolveOldest` at `same file:16` | `getEatenBananaPromises` comes from `createPromiseFactory` at line 19, whose returned object has the shorthand property. |
| member | reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/buildInitiate.test.tsx:889` | `gate.releaseOldest` | `[callback:f8bbd945a260ea1e].createGate.[return].[object].releaseOldest` at `same file:862` | `gate` comes from `createGate` at line 868, whose returned object declares `releaseOldest`. |
| member | reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/getRunningQuery.test.ts:259` | `ctx.hasEntry` | `setup.[return].[object].hasEntry` at `same file:43` | `ctx` comes from `setup` at line 253 and uses its returned `hasEntry` method. |
| member | reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/errorHandling.test.tsx:621` | `api.endpoints.update.initiate` | `BuildInitiateApiEndpointMutation.[type].initiate` at `packages/toolkit/src/query/core/buildInitiate.ts:113` | The type query selects `initiate` on `update`, which is declared with `build.mutation` at line 481. |
| member | reduxjs/redux-toolkit | `packages/toolkit/src/immutableStateInvariantMiddleware.ts:297` | `measureUtils.warnIfExceeded` | `getTimeMeasureUtils.[return].[object].warnIfExceeded` at `packages/toolkit/src/utils.ts:15` | `measureUtils` comes from `getTimeMeasureUtils` at line 256, whose returned object declares `warnIfExceeded`. |
| member | reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/getRunningQuery.test.ts:207` | `ctx.hasEntry` | `setup.[return].[object].hasEntry` at `same file:43` | `ctx` comes from `setup` at line 197 and uses its returned `hasEntry` method. |
| member | reduxjs/redux-toolkit | `packages/toolkit/src/query/tests/errorHandling.test.tsx:597` | `api.endpoints.failedUpdate.initiate` | `BuildInitiateApiEndpointMutation.[type].initiate` at `packages/toolkit/src/query/core/buildInitiate.ts:113` | The type query selects `initiate` on `failedUpdate`, which is declared with `build.mutation` at line 484. |
