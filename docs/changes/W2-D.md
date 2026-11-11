# W2-D: TypeScript and JavaScript language module for the code graph

Mega-plan item 4.2. One new folder, `src/graph/languages/typescript/`, default-
exports a production `LanguageModule` with id `typescript`. No core file, CLI,
MCP, Studio or `src/implementation/**` file changed; the existing deep analysis
(`src/implementation/typescript.ts`) is untouched and remains available on top.
Nothing is wired into a command.

## Claims and context

| Claimed source | Notes |
|---|---|
| `.ts`, `.tsx`, `.mts`, `.cts` | TypeScript, including declaration files |
| `.js`, `.jsx`, `.mjs`, `.cjs` | JavaScript, analysed with `allowJs` |
| `.d.ts`, `.d.mts`, `.d.cts` | Covered by the `.ts`/`.mts`/`.cts` claims (see below) |

Context files: `tsconfig*.json` (so `tsconfig.json`, `tsconfig.build.json` and
`tsconfig-cjs.json`), `jsconfig*.json`, `package.json`. They are context only,
never graph sources.

**Declaration files** are ordinary graph sources: their declarations become
symbols of the usual kinds, and the module symbol records
`data.declarationFile: true`. Imports resolve by the compiler's own rule, so a
hand-written `x.d.ts` beside `x.js` is the target for importers of `./x` (the
compiler prefers it), and calls land on the declaration, not the JS body. Emitted
declaration directories are indexed if they are present in the snapshot; the
walker does not know they are generated.

## How it works

The module is **analyze-only** (no per-file `parse`). Each run:

1. Builds a project model from the captured context: every `tsconfig*.json` and
   `jsconfig*.json` is parsed with the compiler's own config parser over a
   virtual file system that contains only captured sources and context files.
   File globbing uses the compiler's `matchFiles` (an internal export of the
   pinned compiler; a missing export is a visible analysis error).
2. Assigns each source to one owning config: among configs whose file list
   includes it, the one in the deepest directory; ties prefer `tsconfig.json`,
   then `jsconfig.json`, then path order. A file no config includes goes to an
   **inferred project** (like an editor: ESNext, Bundler resolution, `allowJs`,
   JSX preserved, no `paths`); its file data has `project: null`.
3. Builds one `ts.createProgram` per owning config with a snapshot-only host and
   extracts that config's files with its type checker. A file reached from
   another project is parsed there too, but only its owner extracts it.
4. Records each link's checker targets as `{file, key}` facts in `link.data`,
   where `key` is the target symbol's file-local key (`kind@start`).
   `resolve` maps those facts to symbol IDs: one target is definite, two or more
   are candidates, none (or an incomplete set) is unresolved.

Compiler options are the config's, with these overrides, recorded here because
they change behaviour: `allowJs: true` (so JavaScript is always analysed and
resolvable), `noEmit`, `skipLibCheck`, `types: []` and no `typeRoots` (type
packages live in `node_modules`), `maxNodeModuleJsDepth: 0`, and no
`composite`/`incremental`/out-dir options. Project references are checked for
existence but not passed to the compiler, so a cross-project import resolves to
the referenced project's **source**, not its emitted `.d.ts`.

Standard library declarations (`lib.*.d.ts`) are read from the installed
`typescript` package (a package asset, like a grammar WASM file), honouring the
config's `lib`/`target`. They are never graph symbols: links to them are
unresolved with `reason: "external"`.

Workspaces: a captured `package.json` with `workspaces` (array or
`{packages}`) maps each member package's `name` to its directory through a
virtual `node_modules/<name>` link visible only to the compiler host, so the
compiler's own `exports`/`main`/`types` rules pick the entry. The entry must be
a captured file (for example `"exports": "./src/index.ts"`); a package whose
entry points only at an unbuilt `dist/` stays unresolved. pnpm's
`pnpm-workspace.yaml` is not read (not captured), so pnpm-only workspaces do not
link across packages.

**Unchanged snapshot reuse.** When `changedFiles` and `changedContextFiles`
are both empty and every stored result was produced by this module version
(which embeds the compiler version), the stored facts are returned as they are:
no program is built and nothing is parsed. They are the complete analysis of the
identical snapshot, and `resolve` re-derives every target from them. Any source,
config or package-manifest change, or a version change, reanalyses everything.

## Symbols and identity

Symbol `identity` is the container-qualified declared name; it never contains a
position. `key` (`kind@start`) is file-local and not persistent.

| Construct | kind | identity example |
|---|---|---|
| File | `module` | its path, `src/lib/api.ts` (name too) |
| Function declaration (incl. `declare function`) | `function` | `format`, `Outer.Inner.deep` |
| `const`/`let`/`var` holding an arrow function or function expression | `function` | `handler` |
| Class declaration; `const K = class {}` | `class` | `Job`, `Klass` |
| Method, constructor, getter, setter, property | `method`, `constructor`, `getter`, `setter`, `property` | `Job.run`, `Job.constructor`, `Shape.size`, `Shape.#secret` |
| Static member | same kinds | `Shape.static count` |
| Interface; its method/property/accessor signatures | `interface`, `method`, `property`, `getter`/`setter` | `Runner`, `Runner.run` |
| Type alias | `type` | `Id` |
| Enum and members | `enum`, `enum-member` | `Color`, `Color.Red` |
| Namespace (`namespace A.B` gives `A` and `A.B`), ambient module, `declare global` | `namespace` | `Outer.Inner`, `"ambient"`, `global` |
| Module-level `const`/`using` (incl. destructured names) | `constant` | `lazy`, `renamed` |
| Module-level `let`/`var` | `variable` | `counter` |
| Callable members of a module-level object literal | `method` (`getter`/`setter`) | `api.run` |
| `export default <expression>` / `export = <expression>` (not a plain name) | `constant`/`function`/`class` | `default`, `export=` |
| Anonymous `export default function`/`class` | `function`/`class` | `default` |
| CommonJS `exports.x = …`, `module.exports.x = …`, `module.exports = <non-name>` (JS files) | `function`/`class`/`constant` | `x`, `module.exports` |

Overloads: **one symbol per overload set** (consecutive bodiless signatures
plus the implementation, or all signatures in an ambient/interface set). Its range
spans the first signature through the last declaration. A call is therefore a
definite link to the function or method, whichever overload the checker picks.
Two complete same-name JavaScript function declarations are not overloads: they
are two symbols with the same identity (ordinals 0 and 1), and calls get both as
candidates.

Not extracted as symbols: declarations inside function bodies (local functions,
local variables, parameters), object-literal data properties, members of type
literals, call/construct/index signatures, class static blocks, and import
bindings (imports are links, not symbols, including JS `const x = require(…)`).

Every non-module symbol has a `contains` link from its container (the module,
class, interface, enum, namespace or holding variable), with the child's range.

## Links

Ranges: `imports` of a module point at the specifier string (with quotes);
binding links at the import/export specifier; calls at the callee's name (the
`run` of `a.b.run()`); type references and heritage at the type name.
`targetName` keeps the written name (callee chain such as `this.queue.add`,
`(expression).run` when the receiver is not a name chain, the specifier for
module imports, the exported name for bindings: `default`, `*`, or the name).

| Construct | kind | Resolution |
|---|---|---|
| `import … from "x"`, `export … from "x"`, `import x = require("x")`, side-effect import | `imports` (source: the module) | Definite to the target **module** symbol |
| Named / default / namespace import bindings, `import type` (`data.typeOnly`) | `imports` | Definite to the **original declaration**, through barrels, `export *`, renames and default exports (checker alias chain); namespace imports to the module |
| `export { a as b } from`, local `export { a }`, `export * as ns from`, `export default name` | `exports` | Same as bindings |
| `export * from "x"` | `imports` (`data.reexport`) | Module only (no per-name link) |
| Dynamic `import("lit")` | `imports` (`data.dynamic`, source: enclosing symbol) | Definite to the module; computed specifier: unresolved `(dynamic import)` |
| `require("lit")` in JS files; `const x = require()` / `const {a: b} = require()` bindings | `imports` (`data.require`) | Module definite; bindings through the checker's CommonJS aliasing to the original declaration (also into `.ts` modules) |
| Calls, `new`, tagged templates, `super(…)` | `calls` | The checker's symbol for the callee: definite if every declaration is one graph symbol; **candidates** when several (union receivers, merged declarations, repeated JS functions); unresolved otherwise |
| JSX `<Component>` / `<ns.Component>` | `calls` (`data.jsx`) | As calls; intrinsic lowercase elements are not links |
| Type references, `typeof x` | `references` | Type positions prefer type declarations (a merged interface + namespace resolves to the interface) |
| `extends` (classes, interfaces), `implements` | `extends`, `implements` | Checker symbol of the heritage expression |
| Structure | `contains` | Definite |

Paths aliases (`paths`/`baseUrl`), `package.json` `imports`/`exports`/`type`,
`moduleResolution` modes and workspace packages all work through the compiler's
own resolver over the snapshot.

**Unresolved, with the name kept and `data.reason`:**

| reason | Meaning |
|---|---|
| `external` | The checker found declarations, but outside the project: standard library, or an import from a package not in the snapshot (its alias has no declaration) |
| `external-package` | Bare specifier that does not resolve: `node_modules` is never walked |
| `missing-module` | Relative specifier with no captured file |
| `no-symbol` | The checker has no symbol: untyped JS, `any`/`unknown` receivers (often because the receiver's type came from an uncaptured package), computed callees |
| `local` | The target is a parameter, local variable, local function or other non-symbol declaration |
| `computed-specifier` | `import(expr)` with a non-literal specifier |

If the checker's declarations include both graph symbols and external/local
ones (for example `x.toString()` on `Foo | number`), the link is never narrowed:
two or more project targets are candidates; a single one stays unresolved with
`data.targets` and `reason` recorded.

Not extracted as links: plain value reads and writes (`x = y`, passing a
function as a callback without calling it), decorators without a call, JSDoc
type references in JavaScript, and `import type` expressions inside type
positions other than `import("x").T` (that one gives a module `imports` link).

## Status and errors

- A syntax error makes the file **partial** with the compiler's syntactic
  diagnostics (ranged); its recovered symbols stay linkable with partial status.
- Unreadable or non-UTF-8 sources stay failed (detected by re-hashing the
  captured text against the original-byte hash) and are never returned by
  analysis.
- **Analysis errors** (the whole module's analysis fails, every file failed,
  reported in `analysisErrors`): a malformed `tsconfig*.json`/`jsconfig*.json`
  or `package.json`; a relative `extends` or a project reference whose target is
  not in the snapshot; an uncapturable config (core-reported).
- A config that **extends an external package** (`"extends": "@tsconfig/node20"`)
  cannot be captured because `node_modules` is never walked. This is an analysis
  limitation, not an error: the config's own settings still apply, and every
  file it owns is **partial** with a diagnostic naming the missing base.
- Other config diagnostics (unknown options and the like) are kept in each owned
  file's `data.configNotes`; "no inputs found" is normal for solution configs.

## Interface gaps

1. **Core test assumes no production language exists.** `test/graph-review.test.mjs`
   "A10: production discovery hides marked fixture languages…" asserts the
   production module list prints exactly `[]`. Adding any production language
   folder (this one, and the parallel Go and Rust modules) makes it print
   `[ 'typescript' ]`, so that test fails although fixture hiding still works.
   It is not an owned file, so it is unchanged here; the assertion should check
   that `toy` is absent rather than that the list is empty.
2. **Analysis errors are module-wide.** One bad config in one package of a
   monorepo fails every TypeScript/JavaScript file in the project, because the
   interface reports project analysis failures per module, not per project or
   file. Example: `packages/a/tsconfig.json` with `"extends": "./missing.json"`
   fails `packages/b/**` too. Done instead: the strict, honest option (whole
   module failed and reported); per-config isolation would need an interface way
   to report an analysis error scoped to some files.
3. **Candidate sets cannot have one member.** When the checker returns one
   project declaration plus external ones, the honest answer is "this one, or
   something outside the project", which the interface cannot express (ambiguous
   needs two candidates; definite would be a guess). Done instead: unresolved,
   with the project target kept in `data.targets` and `reason`.
4. **Unresolved reasons are module data.** The interface has one unresolved
   state; the distinction between standard library, uncaptured package, local
   and unknown lives only in `link.data.reason`.

## Observations

Full numbers and the hand check are in `evidence/w2-d/README.md`.

- **BullMQ indexes in full**: 261 claimed files, 261 clean, 0 partial, 0 failed,
  no analysis or resolution errors; 3,234 symbols and 40,801 links (17,762
  resolved, 4 candidate sets, 23,035 unresolved). A hand check of 24 random
  resolved, 12 unresolved and all 4 candidate links found no wrong link.
  Unresolved links are dominated by uncaptured packages (`vitest`, `ioredis`,
  `node:*`) and the standard library. The existing deep analysis
  (`src/implementation/`) is unchanged and remains available on top.
- Pymtheg `src/`: 208 files clean; 8,976 of 25,878 links resolved. The ratio is
  lower because most calls go into `typescript` and `zod`, which live in
  `node_modules`.
- Time (observation): BullMQ analysis about 10 s of a 66 s first index; the rest
  is core storage. An unchanged re-index reuses the stored facts (5 ms of
  analysis); its remaining 33 s is core.
