# C-23 newly definite links

Fixed seed `pymtheg-c23-gains-2026`. The draw covers 60 sites across 12
pins. Each verdict compares the source use with the pinned checker and
the selected declaration file. For namespace bindings the selected
package entry and its export chain were checked as well.

**60 right, 0 wrong, 0 cannot tell.**

| Pin | Source | Target | Declaration |
| --- | --- | --- | --- |
| excalidraw/excalidraw | `packages/excalidraw/components/ConvertElementTypePopup.tsx:231` | `dom::HTMLDivElement` | `lib.dom.d.ts:13648` |
| excalidraw/excalidraw | `packages/excalidraw/components/canvases/InteractiveCanvas.tsx:79` | `dom::HTMLCanvasElement` | `lib.dom.d.ts:13381` |
| excalidraw/excalidraw | `packages/excalidraw/actions/actionToggleSearchMenu.ts:35` | `dom::HTMLInputElement` | `lib.dom.d.ts:14702` |
| excalidraw/excalidraw | `packages/excalidraw/components/dropdownMenu/DropdownMenu.test.tsx:36` | `dom::HTMLElement` | `lib.dom.d.ts:13682` |
| excalidraw/excalidraw | `packages/excalidraw/components/Sidebar/siderbar.test.helpers.tsx:16` | `dom::HTMLElement` | `lib.dom.d.ts:13682` |
| excalidraw/excalidraw | `packages/excalidraw/components/PublishLibrary.tsx:130` | `dom::HTMLDivElement` | `lib.dom.d.ts:13648` |
| withastro/astro | `packages/language-tools/language-server/test/typescript/organize-imports.test.ts:225` | `@volar/test-utils::ReturnType<typeof startLanguageServer>.sendCodeActionResolveRequest` | `index.d.ts:35` |
| withastro/astro | `packages/renderers/react/src/client.ts:5` | `dom::HTMLElement` | `lib.dom.d.ts:13682` |
| withastro/astro | `packages/language-tools/astro-check/src/index.ts:55` | `@volar/kit::ReturnType<typeof createTypeScriptChecker>.fileDeleted` | `lib/createChecker.d.ts:16` |
| withastro/astro | `packages/language-tools/language-server/test/typescript/diagnostics.test.ts:111` | `@volar/test-utils::ReturnType<typeof startLanguageServer>.sendDocumentDiagnosticRequest` | `index.d.ts:20` |
| withastro/astro | `packages/language-tools/language-server/test/typescript/diagnostics.test.ts:72` | `@volar/test-utils::ReturnType<typeof startLanguageServer>.openTextDocument` | `index.d.ts:11` |
| withastro/astro | `packages/language-tools/language-server/src/check.ts:120` | `@volar/kit::ReturnType<typeof createTypeScriptChecker>.printErrors` | `lib/createChecker.d.ts:10` |
| trpc/trpc | `www/build/sponsors-sync.ts:27` | `effect::Clock` | `dist/Clock.d.ts:11` |
| trpc/trpc | `www/build/twoslash-cache.ts:9` | `effect::FileSystem` | `dist/FileSystem.d.ts:1` |
| trpc/trpc | `packages/tests/server/createCaller.test.ts:4` | `zod::z` | `v4/classic/external.d.cts:1` |
| trpc/trpc | `www/build/sponsors-opencollective.ts:15` | `effect::Schedule` | `dist/Schedule.d.ts:12` |
| trpc/trpc | `www/src/og/avatar.test.ts:1` | `effect::Result` | `dist/Result.d.ts:13` |
| trpc/trpc | `www/src/og/render.test.ts:3` | `effect::Effect` | `dist/Effect.d.ts:15` |
| react-hook-form/react-hook-form | `examples/V7/fieldArrayMinLength.tsx:1` | `react::React` | `index.d.ts:70` |
| react-hook-form/react-hook-form | `src/logic/validateField.ts:162` | `dom::HTMLInputElement` | `lib.dom.d.ts:14702` |
| react-hook-form/react-hook-form | `src/__tests__/useForm/register.test.tsx:2575` | `dom::HTMLSelectElement` | `lib.dom.d.ts:16421` |
| react-hook-form/react-hook-form | `src/__tests__/useWatch.test.tsx:1` | `react::React` | `index.d.ts:70` |
| react-hook-form/react-hook-form | `examples/V6/formProvider.tsx:1` | `react::React` | `index.d.ts:70` |
| react-hook-form/react-hook-form | `examples/V7/triggerFieldValidation.tsx:1` | `react::React` | `index.d.ts:70` |
| vitest-dev/vitest | `packages/browser/src/client/tester/expect/utils.ts:41` | `dom::SVGElement` | `lib.dom.d.ts:27075` |
| vitest-dev/vitest | `packages/mocker/src/node/hoistMocks.ts:16` | `vite::Rollup` | `types/internal/rollupTypeCompat.d.ts:1` |
| vitest-dev/vitest | `packages/browser/src/client/tester/expect/utils.ts:217` | `dom::HTMLSelectElement` | `lib.dom.d.ts:16421` |
| vitest-dev/vitest | `packages/browser/context.d.ts:808` | `dom::SVGElement` | `lib.dom.d.ts:27075` |
| vitest-dev/vitest | `packages/browser/src/client/tester/expect/toBePartiallyChecked.ts:59` | `dom::SVGElement` | `lib.dom.d.ts:27075` |
| vitest-dev/vitest | `packages/browser/src/client/tester/expect/toHaveFormValues.ts:99` | `dom::HTMLFieldSetElement` | `lib.dom.d.ts:13906` |
| reduxjs/redux-toolkit | `examples/action-listener/counter/src/index.tsx:11` | `dom::HTMLElement` | `lib.dom.d.ts:13682` |
| reduxjs/redux-toolkit | `examples/query/react/mutations/src/features/posts/PostsManager.tsx:21` | `react::React` | `index.d.ts:70` |
| reduxjs/redux-toolkit | `examples/query/react/optimistic-update/src/features/posts/PostDetail.tsx:1` | `react::React` | `index.d.ts:70` |
| reduxjs/redux-toolkit | `examples/query/react/mutations/src/features/posts/PostDetail.tsx:36` | `dom::HTMLInputElement` | `lib.dom.d.ts:14702` |
| reduxjs/redux-toolkit | `examples/type-portability/nodenext-cjs/src/features/posts/PostDetail.tsx:31` | `dom::HTMLInputElement` | `lib.dom.d.ts:14702` |
| reduxjs/redux-toolkit | `examples/type-portability/nodenext-esm/src/features/posts/PostDetail.tsx:28` | `dom::HTMLFormElement` | `lib.dom.d.ts:14048` |
| dexie/Dexie.js | `samples/dexie-cloud-todo-app/src/components/ui/dropdown-menu.tsx:68` | `dom::HTMLDivElement` | `lib.dom.d.ts:13648` |
| dexie/Dexie.js | `samples/dexie-cloud-todo-app/src/components/ui/dropdown-menu.tsx:45` | `dom::HTMLButtonElement` | `lib.dom.d.ts:13262` |
| dexie/Dexie.js | `samples/dexie-cloud-todo-app/src/components/ui/dropdown-menu.tsx:117` | `dom::HTMLButtonElement` | `lib.dom.d.ts:13262` |
| dexie/Dexie.js | `libs/dexie-react-hooks/test/index.ts:161` | `dom::HTMLElement` | `lib.dom.d.ts:13682` |
| dexie/Dexie.js | `samples/dexie-cloud-todo-app/src/components/ui/card.tsx:6` | `dom::HTMLDivElement` | `lib.dom.d.ts:13648` |
| nestjs/nest | `packages/core/test/exceptions/exceptions-handler.spec.ts:11` | `@fastify/error::createError` | `types/index.d.ts:1` |
| puppeteer/puppeteer | `packages/puppeteer-core/src/bidi/BidiOverCdp.ts:7` | `chromium-bidi::BidiMapper` | `out/Default/gen/src/bidiMapper/BidiMapper.d.ts:22` |
| puppeteer/puppeteer | `tools/eslint/src/use-using.ts:7` | `@typescript-eslint/utils::ESLintUtils` | `dist/eslint-utils/index.d.ts:1` |
| puppeteer/puppeteer | `tools/eslint/src/prettier-comments.ts:10` | `@typescript-eslint/utils::ESLintUtils` | `dist/eslint-utils/index.d.ts:1` |
| puppeteer/puppeteer | `tools/mocha-runner/src/types.ts:7` | `zod::z` | `v3/external.d.cts:1` |
| puppeteer/puppeteer | `packages/ng-schematics/src/schematics/utils/files.ts:9` | `@angular-devkit/core::strings` | `src/utils/strings.d.ts:22` |
| mermaid-js/mermaid | `packages/mermaid/src/diagrams/architecture/architectureTypes.ts:4` | `cytoscape::cytoscape` | `index.d.ts:75` |
| mermaid-js/mermaid | `packages/mermaid/src/rendering-util/rendering-elements/nodes.ts:7` | `dagre-d3-es::graphlib` | `src/graphlib/index.d.ts:1` |
| mermaid-js/mermaid | `packages/parser/src/language/common/tokenBuilder.ts:1` | `langium::GrammarAST` | `lib/languages/generated/ast.d.ts:5` |
| mermaid-js/mermaid | `packages/parser/src/language/railroad-ebnf/valueConverter.ts:1` | `langium::GrammarAST` | `lib/languages/generated/ast.d.ts:5` |
| mermaid-js/mermaid | `packages/parser/src/language/treeView/valueConverter.ts:1` | `langium::GrammarAST` | `lib/languages/generated/ast.d.ts:5` |
| vitejs/vite | `packages/vite/src/node/assetSource.ts:1` | `parse5::Token` | `dist/common/token.d.ts:1` |
| vitejs/vite | `packages/vite/src/node/plugins/html.ts:9` | `parse5::Token` | `dist/common/token.d.ts:1` |
| vitejs/vite | `packages/vite/src/node/server/middlewares/indexHtml.ts:6` | `parse5::Token` | `dist/common/token.d.ts:1` |
| vitejs/vite | `docs/.vitepress/buildEnd.config.ts:25` | `vitepress::ReturnType<typeof createContentLoader>.load` | `dist/node/index.d.ts:1759` |
| pmndrs/zustand | `src/react.ts:1` | `react::React` | `index.d.ts:70` |
| pmndrs/zustand | `tests/ssr.test.tsx:1` | `react::React` | `index.d.ts:70` |
| pmndrs/zustand | `src/traditional.ts:1` | `react::React` | `index.d.ts:70` |
| pmndrs/zustand | `src/react/shallow.ts:1` | `react::React` | `index.d.ts:70` |
