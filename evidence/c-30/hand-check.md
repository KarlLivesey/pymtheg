# C-30 hand-check

Twenty newly Level 2 installed links, the lowest SHA-256 ranks of seed `pymtheg-c30-2026`, pin, file, kind, start and name (`tools/drawnew.mjs`). Each site was read in the pinned source. Each file uses the global the owning config declares: it imports only `expectTypeOf` from `vitest`, or nothing, and declares no local `expect`, `it`, `describe`, `vi` or `beforeAll`. The owning config is `tsconfig.spec.json` with `types: ["vitest/globals"]`, and the project's Vitest config sets `globals: true`. A member of `expect(…)` is Vitest's `JestAssertion` member that the checker selects. All twenty are true.

| # | Pin | Site | Link | Target | Before | Source line |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | honojs/hono | `src/middleware/mount/index.test.ts:400` | `(expression).toBe` | `npm:vitest:JestAssertion.prototype.toBe` | `ambiguous-project` | `expect(res.status).toBe(200)` |
| 2 | honojs/hono | `src/middleware/bearer-auth/index.test.ts:875` | `expect` | `npm:vitest:expect` | `ambiguous-project` | `expect(res).not.toBeNull()` |
| 3 | nestjs/nest | `packages/platform-node/test/adapters/node-adapter.spec.ts:1039` | `(expression).toBe` | `npm:vitest:JestAssertion.prototype.toBe` | `no-symbol` | `expect(res.status).toBe(503);` |
| 4 | honojs/hono | `src/middleware/combine/index.test.ts:294` | `vi.fn` | `npm:vitest:VitestUtils.prototype.fn` | `ambiguous-project` | `const middleware1 = vi.fn(nextMiddleware)` |
| 5 | honojs/hono | `src/hono.test.ts:2385` | `it` | `npm:vitest:it` | `ambiguous-project` | `it('POST with 'multipart/form-data'', async () => {` |
| 6 | nestjs/nest | `packages/platform-node/test/adapters/node-adapter.spec.ts:998` | `expect` | `npm:vitest:expect` | `no-symbol` | `expect(res.body).toEqual(buffer);` |
| 7 | honojs/hono | `src/jsx/dom/index.test.tsx:1676` | `expect` | `npm:vitest:expect` | `ambiguous-project` | `expect(addEventListenerSpy).toHaveBeenCalledWith(` |
| 8 | honojs/hono | `src/router/common.case.test.ts:1119` | `expect` | `npm:vitest:expect` | `ambiguous-project` | `expect(match('POST', '/x/a/q')).toEqual(method === 'ALL' ? [prefix] : [])` |
| 9 | honojs/hono | `src/hono.test.ts:2859` | `(expression).toBe` | `npm:vitest:JestAssertion.prototype.toBe` | `ambiguous-project` | `expect(await res.text()).toBe('/public/hello')` |
| 10 | honojs/hono | `src/middleware/method-not-allowed/index.test.ts:272` | `(expression).toBe` | `npm:vitest:JestAssertion.prototype.toBe` | `ambiguous-project` | `expect(res.headers.get('Allow')).toBe('GET, HEAD, POST')` |
| 11 | nestjs/nest | `packages/platform-node/test/adapters/utils/get-media-type-version.util.spec.ts:49` | `expect` | `npm:vitest:expect` | `no-symbol` | `expect(getMediaTypeVersion(acceptHeader, 'version=')).toBe('4');` |
| 12 | honojs/hono | `src/helper/ssg/ssg.test.tsx:152` | `it` | `npm:vitest:it` | `ambiguous-project` | `it('Should handle overall process errors correctly in toSSG', async () => {` |
| 13 | honojs/hono | `src/middleware/trailing-slash/index.test.ts:153` | `expect` | `npm:vitest:expect` | `ambiguous-project` | `expect(loc.pathname).toBe('/my-path/something')` |
| 14 | honojs/hono | `src/middleware/bearer-auth/index.test.ts:1087` | `describe` | `npm:vitest:describe` | `ambiguous-project` | `describe('Bearer Auth options validation', () => {` |
| 15 | honojs/hono | `src/helper/dev/index.test.ts:116` | `expect` | `npm:vitest:expect` | `ambiguous-project` | `expect(logs).toEqual([` |
| 16 | honojs/hono | `src/jsx/dom/index.test.tsx:3509` | `(expression).toBe` | `npm:vitest:JestAssertion.prototype.toBe` | `ambiguous-project` | `expect(root.innerHTML).toBe('<svg><title>SVG Title</title></svg>')` |
| 17 | nestjs/nest | `packages/platform-node/test/adapters/node-request.spec.ts:1124` | `(expression).toHaveLength` | `npm:vitest:JestAssertion.prototype.toHaveLength` | `no-symbol` | `expect(response.body).toHaveLength(0);` |
| 18 | nestjs/nest | `packages/platform-node/test/router/node-router.spec.ts:219` | `(expression).toHaveBeenCalledTimes` | `npm:vitest:JestAssertion.prototype.toHaveBeenCalledTimes` | `no-symbol` | `expect(get).toHaveBeenCalledTimes(1);` |
| 19 | honojs/hono | `src/jsx/streaming.test.tsx:1159` | `(expression).toBe` | `npm:vitest:JestAssertion.prototype.toBe` | `ambiguous-project` | `expect(buildDataStack.length).toBe(baseLength)` |
| 20 | honojs/hono | `src/utils/color.test.ts:12` | `beforeAll` | `npm:vitest:beforeAll` | `ambiguous-project` | `beforeAll(() => {` |
