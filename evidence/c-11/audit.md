# Source audit

The draw ranks pinned source sites with SHA-256 and seed `c11-4b6932d0`.
It takes six bundled declaration targets and two package or Node targets per
repository. The library line numbers refer to TypeScript 5.9.3.
The second-review replay kept 33 of the original sites in the draw. The
seven replacement sites were checked against the pinned sources and the
bundled declarations. The final draw retained 38 of those sites. Two browser
declarations re-entered the draw after refining the missing-type guard.

## honojs/hono

Commit `676c8f80fcafc49e6e74c847a8f0d9c44cc7faee`.

| Site | Stored target | Source and declaration |
| --- | --- | --- |
| `src/client/fetch-result-please.ts:88` | `es String.prototype.split` | `response.headers.get` returns a string or null. The preceding guard excludes null. `lib.es5.d.ts:491` |
| `src/jsx/hooks/dom.test.tsx:694` | `es Promise` | The `new Promise` expression uses the global constructor. `lib.es2015.promise.d.ts:81` |
| `src/types.test.ts:2495` | `es ReturnType` | The type reference applies the global utility to `typeof okHelper`. `lib.es5.d.ts:1650` |
| `src/jsx/context.ts:106` | `es Array.prototype.at` | Line 105 gives `values` type `T[] \| undefined`. The length check narrows the receiver to the array. `lib.es2022.array.d.ts:24` |
| `src/middleware/body-limit/index.test.ts:87` | `es String` | The call converts the request body's length with the global `String` value. `lib.es5.d.ts:544` |
| `src/jsx/dom/intrinsic-element/components.ts:153` | `dom ParentNode.prototype.querySelectorAll` | Line 74 takes `document.head`. `HTMLHeadElement` inherits the overload through `HTMLElement` and `Element`. `lib.dom.d.ts:22724` |
| `src/types.test.ts:1875` | `vitest expectTypeOf` | Named import at `src/types.test.ts:2`. |
| `src/jsx/dom/index.test.tsx:2` | `jsdom JSDOM` | The import itself selects the named export. |

## dexie/Dexie.js

Commit `95666bf5370a222a21d7f53130d87b42e9b7bac7`.

| Site | Stored target | Source and declaration |
| --- | --- | --- |
| `src/public/types/promise-extended.d.ts:129` | `es PromiseLike` | The parameter's union names the global interface. `lib.es5.d.ts:1537` |
| `libs/dexie-cloud-common/src/yjs/decoding.ts:10` | `es Uint8Array` | The `decodeYMessage` parameter names the global typed-array interface. `lib.es5.d.ts:2165` |
| `src/dbcore/dbcore-indexeddb.ts:463` | `dom IDBObjectStore.prototype.index` | `store` comes from `IDBTransaction.objectStore` on line 462. `lib.dom.d.ts:18361` |
| `addons/dexie-cloud/src/middleware-helpers/idGenerationHelpers.ts:46` | `es Set.prototype.has` | The parameter `allPrefixes` has type `Set<string>`. `lib.es2015.collection.d.ts:108` |
| `addons/dexie-cloud/src/middleware-helpers/idGenerationHelpers.ts:17` | `es Pick` | `getEffectiveKeys` uses the global utility type. `lib.es5.d.ts:1606` |
| `src/public/types/promise-extended.d.ts:50` | `es PromiseLike` | The first tuple element accepts the global generic interface `PromiseLike<T1>`. `lib.es5.d.ts:1537` |
| `addons/dexie-export-import/test/basic-tests.ts:127` | `qunit equal` | Named import on line 3. |
| `addons/dexie-export-import/src/tson.ts:5` | `base64-arraybuffer-es6 decode` | Alias `decodeB64` selects the written export `decode` on lines 3–6. |

## oclif/core

Commit `50a4bc0ecd123733cd974866f8db0f1cb5a6a06f`.

| Site | Stored target | Source and declaration |
| --- | --- | --- |
| `src/errors/errors/pretty-print.ts:36` | `es Boolean` | The call converts `obj` with the global constructor. `lib.es5.d.ts:557` |
| `src/constraints.ts:533` | `es TypeError` | The `new` expression constructs the global error type. `lib.es5.d.ts:1142` |
| `src/interfaces/parser.ts:278` | `es Omit` | The parameter type uses the global utility with literal key `'default'`. `lib.es5.d.ts:1630` |
| `test/integration/util.ts:146` | `es String.prototype.lastIndexOf` | `SetupOptions.repo` is a string at line 22. `lib.es5.d.ts:444` |
| `src/performance.ts:232` | `es Number.prototype.toFixed` | `PerfHighlights` declares the selected `oclif.commandRunMs` field as `number` at line 19. `lib.es5.d.ts:570` |
| `src/performance.ts:278` | `es Record` | The getter's return type uses the global utility with `string` keys and `never` values. `lib.es5.d.ts:1613` |
| `src/config/config.ts:396` | `path resolve` | Named import from `node:path` on line 3. |
| `src/config/config.ts:3` | `path resolve` | The named import itself selects the builtin module export. |

## pmndrs/zustand

Commit `9fed2eb2f3af672da9f7bf694b996df3831fc207`.

| Site | Stored target | Source and declaration |
| --- | --- | --- |
| `src/middleware/devtools.ts:181` | `es Omit` | The parameter's type removes four keys from `DevtoolsOptions` with the global utility. `lib.es5.d.ts:1630` |
| `tests/persistAsync.test.tsx:882` | `es Map.prototype.get` | The state returned by `useBoundStore` contains the `map` created on line 863 by `new Map()`. `lib.es2015.collection.d.ts:33` |
| `src/middleware/devtools.ts:609` | `es Object.keys` | The call uses the global `Object` constructor's `keys` method after the plain-object guard. `lib.es5.d.ts:264` |
| `src/middleware/devtools.ts:620` | `es Map.prototype.set` | `walked` defaults to `new Map<unknown, StateFunction[]>()` on line 601. `lib.es2015.collection.d.ts:41` |
| `tests/vanilla/subscribe.test.tsx:100` | `es Math.abs` | The local comparator calls the global `Math` object. `lib.es5.d.ts:682` |
| `src/middleware/devtools.ts:154` | `dom Window` | The indexed access type starts from the configured DOM `Window` interface. `lib.dom.d.ts:36358` |
| `tests/devtools.test.tsx:2712` | `vitest it` | Named import on line 1. |
| `examples/demo/src/components/Scene.jsx:131` | `react useRef` | Named import on line 2. |

## yargs/yargs

Commit `9588a764365c0fd9a6b5dd2f76f2e1be805c5426`.

| Site | Stored target | Source and declaration |
| --- | --- | --- |
| `test/yargs.mjs:2195` | `es Date` | `new Date('2016-07-18')` constructs the global date type. `lib.es5.d.ts:961` |
| `lib/validation.ts:311` | `es Object.keys` | The call enumerates keys using the global `Object` value. `lib.es5.d.ts:264` |
| `lib/completion.ts:360` | `es Promise.prototype.then` | `isPromise(argv)` on line 359 is a predicate from `lib/utils/is-promise.ts:1`. `lib.es5.d.ts:1557` |
| `lib/utils/maybe-async-result.ts:12` | `es Error` | The error-handler parameter explicitly names the global interface. `lib.es5.d.ts:1075` |
| `test/usage.mjs:456` | `es Error` | The short-hand construction calls the global `Error` value. `lib.es5.d.ts:1087` |
| `test/yargs.mjs:1357` | `es JSON.parse` | The config callback parses the file's contents with the global `JSON` value. `lib.es5.d.ts:1163` |
| `test/usage.mjs:4560` | `chai expect` | Named import on line 8. |
| `test/yargs.mjs:3264` | `assert strictEqual` | The `assert` default import from the Node builtin at line 5 exposes the CommonJS module object. |
