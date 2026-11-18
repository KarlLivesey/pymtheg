# Recheck of previously definite links

The [original 110 rows](changed-sites.md) remain the historical record. The
comparison joined every row to the fresh stores by checkout, source file and
line, edge kind, and former target. It checked the matching link's exact span
and whether its target file, kind, identity and ordinal were retained.

| Original rows | Result | Source basis |
| --- | --- | --- |
| All 50 under Relative imports | Original file target restored | TypeScript's extension lookup locates the captured file. Mermaid's Dev Explorer entry is bundled by `.esbuild/server.ts`. Nest's extensionless test imports run through Vitest. T3 Code's browser Vitest config imports `apps/web/vite.config.ts`. |
| All 13 `vitest/node` imports under Vitest declaration candidates | `packages/vitest/node.d.ts` restored | `test/ui/tsconfig.json` maps `vitest/node` to that file first. The Browser Playwright augmentation contributes member declarations. |
| All 45 under Workspace interface calls | Original declaration target restored | The same 0.1.0 call rule applies to workspace imports, relative imports and aliases. |
| Both `Assertion` references under Vitest declaration candidates | Ambiguous | `packages/expect/src/types.ts:643` declares the base interface. The browser and Vitest declarations augment it. The recorded candidate sets contain the declarations in the respective compiler program. |

The 45 calls previously named eleven declaration-only members. The Nest
targets are `OverrideBy.useFactory`, `OverrideBy.useValue` and
`OverrideModule.useModule`. The tRPC targets are `Encoder.decode`,
`Encoder.encode`, `Observable.pipe`, `Subscribable.subscribe`,
`Unsubscribable.unsubscribe`, `TRPCRootObject.router`,
`ProcedureBuilder.errors` and `ProcedureBuilder.query`.

Vitest also has two module-file edges that used to name the ambient shim.

| Source site | Former target | Current target | Source basis |
| --- | --- | --- | --- |
| `test/coverage-test/fixtures/src/cjs-dependency-namespace.ts:1` | `@vitest/cjs-lib` ambient namespace in `cjs-lib.shim.d.ts` | `test/browser/cjs-lib/index.js` | The coverage test's `file:../browser/cjs-lib` dependency supplies a `.` export to this CommonJS file. |
| `test/coverage-test/fixtures/src/cjs-dependency.ts:1` | `@vitest/cjs-lib` ambient namespace in `cjs-lib.shim.d.ts` | `test/browser/cjs-lib/index.js` | The default import uses the same physical entry. |

[Exact comparison and changed-link output](compare.mjs)
