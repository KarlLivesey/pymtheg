# SW-3 reference sites

The fixed reference sample has 23 generic sites. Main had settled one and
the candidate settled all 23. Five sites labelled lexical access also
settled through the shared binding or member lookup paths.

| Repository | Source | Sample item | Main → candidate |
| --- | --- | --- | --- |
| honojs/hono | `src/types.ts:2582` | ts-local-access | unresolved → resolved |
| dexie/Dexie.js | `libs/dexie-cloud-common/src/tson/__tests__/TypesonSimplified.test.ts:54` | ts-local-access | unresolved → resolved |
| reduxjs/redux-toolkit | `packages/toolkit/src/query/react/namedHooks.ts:49` | ts-local-access | unresolved → resolved |
| withastro/astro | `packages/astro/test/units/env/env-validators.test.ts:240` | ts-local-access | unresolved → resolved |
| honojs/hono | `src/types.ts:1885` | ts-local-access | unresolved → resolved |
| honojs/hono | `src/types.ts:659` | ts-type-parameters | unresolved → resolved |
| withastro/astro | `packages/astro/templates/content/types.d.ts:22` | ts-type-parameters | unresolved → resolved |
| colinhacks/zod | `packages/zod/src/v3/types.ts:301` | ts-type-parameters | unresolved → resolved |
| nestjs/nest | `packages/common/interfaces/http/http-server.interface.ts:355` | ts-type-parameters | unresolved → resolved |
| excalidraw/excalidraw | `packages/common/src/utils.ts:599` | ts-type-parameters | unresolved → resolved |
| colinhacks/zod | `packages/zod/src/v3/ZodError.ts:223` | ts-type-parameters | unresolved → resolved |
| reduxjs/redux-toolkit | `packages/toolkit/src/query/endpointDefinitions.ts:1284` | ts-type-parameters | unresolved → resolved |
| trpc/trpc | `packages/tanstack-react-query/src/internals/types.ts:182` | ts-type-parameters | unresolved → resolved |
| trpc/trpc | `packages/openapi/test/routers/errorFormatterRouter-heyapi/client/utils.gen.ts:226` | ts-type-parameters | unresolved → resolved |
| honojs/hono | `src/helper/factory/index.ts:50` | ts-type-parameters | unresolved → resolved |
| vitest-dev/vitest | `packages/browser/src/client/tester/action.ts:116` | ts-type-parameters | unresolved → resolved |
| honojs/hono | `src/types.ts:946` | ts-type-parameters | unresolved → resolved |
| colinhacks/zod | `packages/zod/src/v4/core/parse.ts:276` | ts-type-parameters | unresolved → resolved |
| trpc/trpc | `packages/openapi/test/routers/cyclicTypesRouter-heyapi/client/utils.gen.ts:277` | ts-type-parameters | unresolved → resolved |
| vitest-dev/vitest | `packages/expect/src/types.ts:212` | ts-type-parameters | unresolved → resolved |
| trpc/trpc | `packages/openapi/test/routers/procedureErrorsRouter-heyapi/client/types.gen.ts:215` | ts-type-parameters | unresolved → resolved |
| honojs/hono | `src/types.ts:748` | ts-type-parameters | unresolved → resolved |
| dexie/Dexie.js | `libs/dexie-react-hooks/src/usePromise.ts:10` | ts-type-parameters | unresolved → resolved |
| honojs/hono | `src/types.ts:427` | ts-type-parameters | unresolved → resolved |
| trpc/trpc | `packages/client/src/links/internals/subscriptions.ts:4` | ts-type-parameters | unresolved → resolved |
| trpc/trpc | `packages/client/src/links/wsLink/wsClient/utils.ts:74` | ts-type-parameters | unresolved → resolved |
| honojs/hono | `src/types.ts:2021` | ts-type-parameters | unresolved → resolved |

Seven of the 32 chain reference sites were already settled on main. The
candidate has the same seven. The Mermaid `getEdges` example passes through
a generated parser. The T3 Code `removeWorktree` example uses a receiver
yielded through Effect, whose declarations are unavailable in the checkout
sweep. The oclif `pnp.getLocator` example is a call through a declaration-only
shape. The object-member reference sample itself is in PocketBase, a Go pin
outside this TypeScript run.

[Fixed reference sample](../sw-3/samples.json.gz)
