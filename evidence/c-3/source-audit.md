# Fixed-seed source audit

All 20 links below match the declaration or export in the pinned checkout.
Target lines are in the source file shown in the Site column unless a
different file is given.

| Repository | Site | Target and declaration line | Source check |
| --- | --- | --- | --- |
| nestjs/nest | `packages/microservices/test/server/server-nats.spec.ts:539` | `createRequest:288` | The argument calls the enclosing suite's arrow. |
| pingdotgg/t3code | `apps/server/src/startupAccess.ts:110` | `renderTerminalQrCode.isDark:103` | The QR loop calls the arrow declared above it. |
| excalidraw/excalidraw | `packages/excalidraw/tests/embeddable.test.tsx:72` | `activate:56` | The same test block declares the async arrow. |
| nestjs/nest | `integration/file-upload/e2e/parity.spec.ts:217` | `expectParity:59` | The nested test calls the enclosing suite's function. |
| honojs/hono | `src/jsx/dom/index.test.tsx:1223` | `App:1218`, ordinal 44 | The JSX tag selects the arrow declared in that test. |
| mermaid-js/mermaid | `packages/mermaid/src/diagrams/flowchart/flowDb.spec.ts:587` | `build:554` | The same suite declares the pool metadata helper. |
| mermaid-js/mermaid | `packages/mermaid/src/diagrams/architecture/architectureRenderer.ts:244` | `getAlignments.flattenAlignments:172` | The vertical alignment expression calls the scoped helper. |
| pingdotgg/t3code | `apps/server/src/provider/Layers/OpenCodeAdapter.ts:893` | `makeOpenCodeAdapter.emit:502` | The generator calls its enclosing adapter's queue helper. |
| nestjs/nest | `packages/core/test/router/route-path-factory.spec.ts:275` | `createWithExclusion:255` | The test calls the arrow declared in the same block. |
| nestjs/nest | `integration/file-upload/e2e/parity.spec.ts:319` | `text:70` | The nested test calls the enclosing suite's Buffer helper. |
| vitest-dev/vitest | `packages/vitest/src/runtime/workers/init.ts:141` | `packages/utils/src/serialize.ts:31` `serializeValue` | `@vitest/utils/error` re-exports this function as `serializeError`. |
| withastro/astro | `packages/renderers/vue/src/context.ts:21` | `packages/runtime/src/types.ts:292` `SSRResult` | The annotation uses the type-only import from `@astrojs/runtime/types`. |
| withastro/astro | `packages/integrations/netlify/test/functions/image-cdn.test.ts:198` | `packages/integrations/netlify/src/index.ts:46` `remotePatternToRegex` | The test imports the function exported by `@astrojs/netlify`. |
| withastro/astro | `packages/astro/src/template/4xx.ts:139` | `packages/internal-helpers/src/path.ts:10` `appendForwardSlash` | The named import uses the `@astrojs/internal-helpers/path` package subpath. |
| trpc/trpc | `examples/.experimental/next-app-dir/src/app/client/page.tsx:28` | `tooling/ui/src/components/card.tsx:4` `Card` | `@shared/ui` maps the component subpath to that TSX file, which exports `Card`. |
| nestjs/nest | `packages/platform-node/adapters/utils/get-media-type-version.util.ts:10` | `splitOutsideQuotes.index:10` | The loop condition refers to the loop's own `let` binding. |
| excalidraw/excalidraw | `packages/element/src/__tests__/transform.test.ts:1352` | `label:1348`, ordinal 7 | The assertion uses the text element found in that test. |
| vitest-dev/vitest | `packages/browser/src/client/tester/tester-utils.ts:27` | `escapeIdForCSSSelector.char:26` | The character operation reads the enclosing callback parameter. |
| excalidraw/excalidraw | `packages/excalidraw/components/FileDropOverlay.tsx:90` | `FileDropOverlay.onKeyChange.event:89` | The Escape check reads the key handler's parameter. |
| mermaid-js/mermaid | `packages/mermaid/src/rendering-util/layout-algorithms/layout-utils/geometry.ts:114` | `normalizePolyline.points:113` | The length check reads the function's first parameter. |
