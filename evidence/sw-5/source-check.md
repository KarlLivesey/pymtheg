# Source check of gained Level 2 links

The candidate pool contains 29 T3 Code and Nest sites that appeared below
Level 2 in the SW-4 archive's source review or per-reason examples. Each
matched the same pinned file, line, column, link kind and target spelling
in the installed replay and reached Level 2 without a recorded assumption.
The first 20 SHA-256 ranks with seed `sw5` were checked against the pinned
source and selected declarations. This draw covers the available matched
archive sites in those two pins.

| Pin | Source | New target | Source and declaration check |
| --- | --- | --- | --- |
| T3 Code | `apps/web/src/environments/runtime/service.threadSubscriptions.test.ts:406` | `@vitest/expect#JestAssertion.prototype.toHaveLength` | The imported Vitest `expect` yields the assertion whose declaration names `toHaveLength`. |
| T3 Code | `packages/tailscale/src/tailscale.test.ts:84` | `@effect/vitest#Vitest.MethodsNonLive.prototype.effect` | `it` is imported from `@effect/vitest`, whose `MethodsNonLive` declares `effect`. |
| T3 Code | `apps/server/src/provider/Layers/CodexAdapter.test.ts:454` | `effect#Pipeable.prototype.pipe` | `Stream.runHead` returns an `Effect`, whose declaration extends `Pipeable`. |
| Nest | `packages/microservices/client/client-mqtt.ts:400` | `buffer#Buffer` | The annotation names the Node global `Buffer` declared by `@types/node/buffer.d.ts`. |
| T3 Code | `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts:181` | `@effect/vitest#Vitest.MethodsNonLive.prototype.effect` | The `it` binding and its `effect` member come from `@effect/vitest`. |
| T3 Code | `apps/server/integration/OrchestrationEngineHarness.integration.ts:442` | `es#ReadonlyArray.prototype.some` | The preceding `Effect.map` annotates the value as `ReadonlyArray<OrchestrationEvent>`. |
| Nest | `packages/microservices/test/client/client-grpc.spec.ts:387` | `rxjs#Subscription.prototype.unsubscribe` | `stream$.subscribe` produces the RxJS `Subscription` that declares `unsubscribe`. |
| Nest | `integration/versioning/e2e/custom-versioning.spec.ts:445` | `supertest#TestAgent.prototype.get` | The imported `supertest` function produces a `TestAgent` whose declaration exposes `get`. |
| Nest | `integration/versioning/e2e/custom-versioning-fastify.spec.ts:838` | `superagent#lib/node/index.d.ts:SARequest.prototype.set` | The Supertest HTTP call returns a test request derived from Superagent's request, whose Node declaration owns `set`. |
| T3 Code | `apps/web/src/components/GitActionsControl.tsx:643` | `@base-ui/react#RadioRoot` | `Radio` from `@base-ui/react/radio` is aliased to `RadioPrimitive`. Its parts barrel exports `RadioRoot` as `Root`. |
| T3 Code | `apps/server/src/provider/Layers/CursorProvider.test.ts:616` | `es#String.prototype.match` | `waitForFileContent` reads and returns the file's text. The regular expression is passed to that string's `match`. |
| T3 Code | `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts:1322` | `effect#Bottom.prototype.make` | The contracts `ThreadId` is a branded Effect schema with `Bottom.make`. |
| Nest | `packages/platform-fastify/test/adapters/multipart-option.spec.ts:122` | `vitest#JestAssertion.prototype.toBe` | The Vitest assertion produced by `expect` has the named matcher in its bundled `JestAssertion`. |
| T3 Code | `apps/marketing/src/lib/releases.ts:20` | `dom#Storage.prototype.getItem` | The DOM library declares `sessionStorage` as `Storage`, which declares `getItem`. |
| Nest | `packages/platform-node/test/adapters/node-adapter.spec.ts:2067` | `buffer#Buffer.prototype.toString` | The request's `rawBody` is an optional `Buffer`, whose Node declaration owns the encoding-taking `toString`. |
| Nest | `packages/microservices/test/client/client-mqtt-payload.spec.ts:59` | `vitest#JestAssertion.prototype.toHaveBeenCalledTimes` | The bundled Vitest matcher declaration names `toHaveBeenCalledTimes` on `JestAssertion`. |
| T3 Code | `apps/server/src/orchestration/Layers/CheckpointReactor.test.ts:568` | `es#ReadonlyArray.prototype.find` | The read model's `threads` is an Effect `Schema.Array` in the contracts source, which supplies a readonly array. |
| Nest | `packages/microservices/test/client/client-mqtt.spec.ts:106` | `vitest#JestAssertion.prototype.toHaveBeenCalled` | Vitest's `expect` result exposes the bundled `toHaveBeenCalled` assertion. |
| T3 Code | `apps/desktop/src/app/DesktopAppIdentity.ts:99` | `apps/desktop/src/electron/ElectronApp.ts#setAboutPanelOptions` | The effect acquires the local Electron app service whose interface declares `setAboutPanelOptions`. |
| T3 Code | `apps/web/src/environments/runtime/service.addSavedEnvironment.test.ts:467` | `vitest#VitestUtils.prototype.fn` | The imported `vi` is `VitestUtils`, whose declaration contains `fn`. |
