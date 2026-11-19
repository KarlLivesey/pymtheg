# Source audit

The fixed-seed draw took 60 newly stored library links across 16 pins. The disposition is **60 right, 0 wrong, 0 cannot tell**. For a unit-only link the check establishes the imported receiver type and package. For a named target the check also establishes the symbol. The two calls on the same line in Excalidraw use the same local alias at distinct offsets. [Pinned declarations and audit selection](README.md)

## Aliases and globals

| Pin and call site | Stored target | Source basis | Result |
| --- | --- | --- | --- |
| nestjs/nest `packages/platform-fastify/test/multipart/multipart/multipart.utils.spec.ts:38` (`expect`) | `npm vitest · expect` | `tsconfig.spec.json` requests `vitest/globals`. The published ambient declaration supplies `expect`. | Right |
| mermaid-js/mermaid `packages/mermaid/src/diagrams/agentflow/agentflow-diagnostics.spec.ts:78` (`expect`) | `npm vitest · expect` | `packages/mermaid/tsconfig.json` requests `vitest/globals`. The published ambient declaration supplies `expect`. | Right |
| trpc/trpc `packages/tests/server/streaming.test.ts:730` (`test`) | `npm vitest · test` | `packages/tests/tsconfig.json` requests `vitest/globals`. The published ambient declaration supplies `test`. | Right |
| reduxjs/redux-toolkit `packages/rtk-query-codegen-openapi/test/generateEndpoints.test.ts:950` (`expect`) | `npm vitest · expect` | `packages/rtk-query-codegen-openapi/tsconfig.json` requests `vitest/globals`. The published ambient declaration supplies `expect`. | Right |
| dexie/Dexie.js `libs/dexie-cloud-common/src/tson/__tests__/TypesonSimplified.test.ts:213` (`expect`) | `npm jest · expect` | `libs/dexie-cloud-common/tsconfig.json` requests `jest`. The published ambient declaration supplies `expect`. | Right |
| oclif/core `test/config/util.test.ts:5` (`describe`) | `npm mocha · describe` | `test/tsconfig.json` requests `mocha`. The published ambient declaration supplies `describe`. | Right |
| honojs/hono `adapters/aws-lambda/test/index.test.ts:454` (`expect`) | `npm vitest · expect` | `adapters/aws-lambda/tsconfig.json` requests `vitest/globals`. The published ambient declaration supplies `expect`. | Right |
| withastro/astro `packages/astro/test/units/fs/empty-dir.test.ts:47` (`realRmdirSync`) | `node fs · rmdirSync` | The const alias saves `fs.rmdirSync` before the test replaces the module function with `mock.method`. The module is imported from `node:fs` on line 2. | Right |
| vitest-dev/vitest `packages/browser/src/node/rpc.ts:167` (`setInterval`) | `node timers · setInterval` | `packages/browser/tsconfig.json` requests `node`. The published ambient declaration supplies `setInterval`. | Right |
| nestjs/nest `packages/core/test/injector/container.spec.ts:269` (`describe`) | `npm vitest · describe` | `tsconfig.spec.json` requests `vitest/globals`. The published ambient declaration supplies `describe`. | Right |
| mermaid-js/mermaid `packages/mermaid/src/rendering-util/layout-algorithms/dagre/mermaid-graphlib.spec.js:286` (`expect`) | `npm vitest · expect` | `packages/mermaid/tsconfig.json` requests `vitest/globals`. The published ambient declaration supplies `expect`. | Right |
| trpc/trpc `packages/tests/server/inferenceHelpers.test.ts:120` (`test`) | `npm vitest · test` | `packages/tests/tsconfig.json` requests `vitest/globals`. The published ambient declaration supplies `test`. | Right |
| reduxjs/redux-toolkit `packages/toolkit/src/query/tests/createApi.test.ts:420` (`test`) | `npm vitest · test` | `packages/toolkit/tsconfig.base.json` requests `vitest/globals`. The published ambient declaration supplies `test`. | Right |
| dexie/Dexie.js `libs/dexie-cloud-common/src/tson/__tests__/TSONRef.test.ts:56` (`expect`) | `npm jest · expect` | `libs/dexie-cloud-common/tsconfig.json` requests `jest`. The published ambient declaration supplies `expect`. | Right |
| oclif/core `test/help/util.test.ts:118` (`it`) | `npm mocha · it` | `test/tsconfig.json` requests `mocha`. The published ambient declaration supplies `it`. | Right |
| honojs/hono `adapters/aws-lambda/test/index.test.ts:741` (`it`) | `npm vitest · it` | `adapters/aws-lambda/tsconfig.json` requests `vitest/globals`. The published ambient declaration supplies `it`. | Right |
| withastro/astro `packages/astro/test/units/cli/check.test.ts:55` (`setImmediate`) | `node timers · setImmediate` | `packages/astro/tsconfig.test.json` requests `node`. The published ambient declaration supplies `setImmediate`. | Right |
| vitest-dev/vitest `packages/browser/src/node/rpc.ts:193` (`clearInterval`) | `node timers · clearInterval` | `packages/browser/tsconfig.json` requests `node`. The published ambient declaration supplies `clearInterval`. | Right |
| nestjs/nest `integration/injector/e2e/optional-failing-dependency.spec.ts:41` (`describe`) | `npm vitest · describe` | `integration/injector/tsconfig.json` requests `vitest/globals`. The published ambient declaration supplies `describe`. | Right |
| mermaid-js/mermaid `packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js:724` (`expect`) | `npm vitest · expect` | `packages/mermaid/tsconfig.eslint.json` inherits the `vitest/globals` request from `packages/mermaid/tsconfig.json`. The published ambient declaration supplies `expect`. | Right |

## Standard, DOM and shared Node APIs

| Pin and call site | Stored target | Source basis | Result |
| --- | --- | --- | --- |
| vitest-dev/vitest `packages/browser/src/node/commands/screenshotMatcher/utils.ts:294` (`clearTimeout`) | `node timers · clearTimeout` | `packages/browser/tsconfig.json` requests `node`. The published ambient declaration supplies `clearTimeout`. | Right |
| pingdotgg/t3code `scripts/dev-runner.test.ts:85` (`URL`) | `node url · URL` | `scripts/tsconfig.json` requests `node`. The published ambient declaration supplies `URL`. | Right |
| puppeteer/puppeteer `packages/puppeteer-core/src/node/PipeTransport.test.ts:111` (`myReadable.push`) | `node stream (unit)` | `myReadable: Readable` (line 15), with `Readable` imported from `node:stream` (line 6). | Right |
| nestjs/nest `tools/benchmarks/src/main.ts:119` (`setTimeout`) | `node timers · setTimeout` | The benchmark selects ES2023 libraries without DOM, uses explicit Node imports at lines 1–2, and calls the Node `setTimeout` global. | Right |
| withastro/astro `packages/astro/src/content/mutable-data-store.ts:73` (`path.toString`) | `node fs (unit)` | `path: PathLike` (line 69), with `PathLike` imported from `node:fs` (line 1). | Right |
| vitejs/vite `packages/vite/src/node/plugins/asset.ts:810` (`content.toString`) | `node buffer (unit)` | `content: Buffer` in `svgToDataURL` (line 809) and its sibling function (line 789), with `Buffer` imported from `node:buffer` (line 1). | Right |
| excalidraw/excalidraw `packages/math/src/point.ts:114` (`abs`) | `typescript-lib es · Math.abs` | The local alias `const abs = Math.abs` (line 113) selects the `Math.abs` declaration in `lib.es5.d.ts`. | Right |
| reduxjs/redux-toolkit `packages/rtk-query-graphql-request-base-query/src/index.ts:33` (`Headers`) | `node globals · Headers` | `packages/rtk-query-graphql-request-base-query/tsconfig.json` requests `node`. The published ambient declaration supplies `Headers`. | Right |
| vitest-dev/vitest `packages/browser/src/node/index.ts:336` (`URL`) | `node url · URL` | `packages/browser/tsconfig.json` requests `node`. The published ambient declaration supplies `URL`. | Right |
| pingdotgg/t3code `scripts/apply-web-brand-assets.ts:29` (`URL`) | `node url · URL` | `scripts/tsconfig.json` requests `node`. The published ambient declaration supplies `URL`. | Right |
| puppeteer/puppeteer `packages/puppeteer-core/src/node/PipeTransport.test.ts:103` (`myReadable.push`) | `node stream (unit)` | `myReadable: Readable` (line 15), with `Readable` imported from `node:stream` (line 6). | Right |
| nestjs/nest `tools/benchmarks/src/main.ts:157` (`setTimeout`) | `node timers · setTimeout` | The benchmark selects ES2023 libraries without DOM, uses explicit Node imports at lines 1–2, and calls the Node `setTimeout` global. | Right |
| withastro/astro `packages/astro/test/astro-sync.test.ts:48` (`path.toString`) | `node fs (unit)` | `path: fs.PathLike` (line 47), with the `fs` namespace imported from `node:fs` (line 2). | Right |
| vitejs/vite `packages/vite/src/node/plugins/asset.ts:802` (`content.toString`) | `node buffer (unit)` | `content: Buffer` in `svgToDataURL` (line 809) and its sibling function (line 789), with `Buffer` imported from `node:buffer` (line 1). | Right |
| excalidraw/excalidraw `packages/math/src/point.ts:114` (`abs`) | `typescript-lib es · Math.abs` | The local alias `const abs = Math.abs` (line 113) selects the `Math.abs` declaration in `lib.es5.d.ts`. | Right |
| reduxjs/redux-toolkit `packages/rtk-query-graphql-request-base-query/src/index.test.ts:12` (`AbortController`) | `node globals · AbortController` | `packages/rtk-query-graphql-request-base-query/tsconfig.json` requests `node`. The published ambient declaration supplies `AbortController`. | Right |
| vitest-dev/vitest `packages/browser/src/node/commands/screenshotMatcher/index.ts:427` (`AbortController`) | `node globals · AbortController` | `packages/browser/tsconfig.json` requests `node`. The published ambient declaration supplies `AbortController`. | Right |
| pingdotgg/t3code `scripts/resolve-nightly-release.ts:33` (`URL`) | `node url · URL` | `scripts/tsconfig.json` requests `node`. The published ambient declaration supplies `URL`. | Right |
| puppeteer/puppeteer `packages/puppeteer-core/src/node/PipeTransport.test.ts:76` (`myReadable.push`) | `node stream (unit)` | `myReadable: Readable` (line 15), with `Readable` imported from `node:stream` (line 6). | Right |
| nestjs/nest `packages/common/file-stream/streamable-file.ts:60` (`this.stream.push`) | `node stream (unit)` | `private readonly stream: Readable` (line 17) uses `Readable` imported from Node's `stream` (line 1). | Right |

## Return types and re-exports

| Pin and call site | Stored target | Source basis | Result |
| --- | --- | --- | --- |
| nestjs/nest `integration/scopes/e2e/request-scope.spec.ts:118` (`agent.destroy`) | `node http (unit)` | `agent: Agent` (line 97), imported from `node:http` (line 3). | Right |
| mermaid-js/mermaid `e2e/rendering/mindmap/mindmap-depth-color.spec.ts:44` (`svg.locator`) | `npm @playwright/test (unit)` | `expectDepthColors(svg: Locator)` (line 35), with `Locator` from `@playwright/test` (line 1). | Right |
| dexie/Dexie.js `addons/dexie-cloud/src/sync/blobProgress.ts:41` (`downloading$.next`) | `npm rxjs (unit)` | `downloading$: BehaviorSubject<boolean>` (line 37), with `BehaviorSubject` from `rxjs` (line 9). | Right |
| puppeteer/puppeteer `tools/docgen/src/custom_markdown_documenter.ts:1058` (`output.appendNode`) | `npm @microsoft/tsdoc (unit)` | The `output: DocSection` parameter uses `DocSection` imported from `@microsoft/tsdoc` (lines 74–81). | Right |
| vitest-dev/vitest `packages/vitest/src/integrations/env/loader.ts:130` (`rpc.resolve`) | `npm birpc (unit)` | `rpc: WorkerRPC` (line 114) leads to `BirpcReturn` from `birpc` in `packages/vitest/src/types/worker.ts:1,10`. | Right |
| withastro/astro `packages/integrations/cloudflare/test/binding-image-service.test.ts:53` (`redirectServer.address`) | `node http (unit)` | `redirectServer: Server` (line 39), with `Server` imported from `node:http` (line 3). | Right |
| reduxjs/redux-toolkit `packages/rtk-codemods/transforms/createReducerBuilder/index.ts:15` (`j.expressionStatement`) | `npm jscodeshift (unit)` | `j: JSCodeshift` (line 11) uses the type imported from `jscodeshift` (lines 4–7). | Right |
| pingdotgg/t3code `apps/web/src/components/ui/sidebar.tsx:456` (`event.preventDefault`) | `npm react (unit)` | `event: React.PointerEvent<HTMLButtonElement>` (line 450), with `React` imported from `react` (line 5). | Right |
| trpc/trpc `packages/openapi/src/generate.ts:454` (`ctx.checker.typeToString`) | `npm typescript (unit)` | The context declares `checker: Checker` (line 181). `Checker` is imported from `typescript/sync` (line 28). | Right |
| honojs/hono `adapters/aws-lambda/test/stream-mock.ts:35` (`stream.write`) | `node stream (unit)` | `stream: Writable` (line 34), with `Writable` from `node:stream` (line 1). | Right |
| changesets/changesets `docs/guide/cli.data.ts:165` (`renderer.renderAsync`) | `npm vitepress (unit)` | `renderer: MarkdownRenderer` (line 163), with the named type imported from `vitepress` (lines 4–6). | Right |
| excalidraw/excalidraw `packages/excalidraw/tests/interactivity.test.tsx:1172` (`GlobalTestState.renderResult.rerender`) | `npm @testing-library/react (unit)` | `GlobalTestState.renderResult` is annotated `RenderResult` from `@testing-library/react` in `packages/excalidraw/tests/test-utils.ts:27,119`. | Right |
| vitejs/vite `packages/vite/src/node/utils.ts:1283` (`server.address`) | `node net (unit)` | `server: Server` (line 1277), with `Server` imported from `node:net` (line 9). | Right |
| pmndrs/zustand `tests/devtools.test.tsx:2343` (`conn.send.mockClear`) | `npm vitest (unit)` | `send: Mock<any>` (line 23), with `Mock` imported from `vitest` (line 2). | Right |
| react-hook-form/react-hook-form `e2e/utils.ts:40` (`locator.textContent`) | `npm @playwright/test (unit)` | `locator: Locator` (line 33), with `Locator` imported from `@playwright/test` (line 1). | Right |
| oclif/core `src/util/fs.ts:41` (`fileStat.isFile`) | `node fs (unit)` | `fileStat: Stats` (line 34), with `Stats` imported from `node:fs` (line 1). | Right |
| nestjs/nest `sample/39-file-storage/src/storage/storage.config.ts:18` (`config.getOrThrow`) | `npm @nestjs/config (unit)` | `config: ConfigService` (line 5), with `ConfigService` imported from `@nestjs/config` (line 1). | Right |
| mermaid-js/mermaid `packages/mermaid/src/diagrams/c4/svgDraw.ts:27` (`elem.append`) | `npm d3 (unit)` | `elem: SVG` (line 26) uses `SVG = d3.Selection<…>` in `packages/mermaid/src/diagram-api/types.ts:174`, with `d3` imported there from `d3`. | Right |
| dexie/Dexie.js `addons/y-dexie/src/DexieYProvider.ts:201` (`doc.on`) | `npm yjs (unit)` | The constructor parameter `doc: Y.Doc` (line 191) uses the namespace imported from `yjs` (line 2). | Right |
| puppeteer/puppeteer `tools/docgen/src/custom_markdown_documenter.ts:1297` (`output.appendNode`) | `npm @microsoft/tsdoc (unit)` | The `output: DocSection` parameter uses `DocSection` imported from `@microsoft/tsdoc` (lines 74–81). | Right |
