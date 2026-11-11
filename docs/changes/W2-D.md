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

Context files: `*tsconfig*.json` (so `tsconfig.json`, `tsconfig.build.json`,
`tsconfig-cjs.json` and `base.tsconfig.json`), `*jsconfig*.json`, and
`package.json`. They are context only, never graph sources. Only files named
`tsconfig*.json`/`jsconfig*.json` act as projects; the wider patterns exist so
that common base-config names are captured for `extends`.

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
2. Assigns each source to an owning config. Candidates are the configs whose
   file list includes it, plus any broken config whose directory contains it.
   They are ranked in this order:
   1. configs whose **directory contains the file** come before configs that
      include it from elsewhere;
   2. the **nearest** (deepest) directory wins; the project root has depth 0;
   3. `tsconfig.json` comes before `jsconfig.json`, which comes before other
      names (the editor's discovery rule).

   If two or more configs are still equal after these three rules, that is a
   **genuine tie**. The file is analysed under each tied config, and the results
   are merged:
   - a link whose targets are the same under every tied config keeps them;
   - a link whose targets differ gets the union of targets: candidates if every
     config's answer was complete, otherwise unresolved with reason
     `ambiguous-project` and the targets kept;
   - the file records `data.projects` listing the tied configs and has no
     `data.project` (there is no single owner).

   Path order is used only to order the tied configs in that list, never to
   pick one. A file that no config includes goes to an **inferred project**
   (like an editor: ESNext, Bundler resolution, `allowJs`, JSX preserved, no
   `paths`); its file data has `project: null`.
3. Builds one `ts.createProgram` per owning config with a snapshot-only host and
   extracts that config's files with its type checker. A file reached from
   another project is parsed there too, but only its owner (or each tied owner)
   extracts it.
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
(which embeds the compiler version; the leading number is bumped whenever
extraction or resolution semantics change, and is now 2), the stored facts are
returned as they are:
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
| Constructor parameter property (`public`/`private`/`protected`/`readonly`/`override`) | `property` | `A.cb` |
| Interface; its method/property/accessor signatures | `interface`, `method`, `property`, `getter`/`setter` | `Runner`, `Runner.run` |
| Type alias | `type` | `Id` |
| Enum and members | `enum`, `enum-member` | `Color`, `Color.Red` |
| Namespace (`namespace A.B` gives `A` and `A.B`), ambient module, `declare global` | `namespace` | `Outer.Inner`, `"ambient"`, `global` |
| Module-level `const`/`using` (incl. destructured names) | `constant` | `lazy`, `renamed` |
| Module-level `let`/`var` | `variable` | `counter` |
| Callable members of a module-level object literal | `method` (`getter`/`setter`) | `api.run` |
| `export default <expression>` / `export = <expression>` (not a plain name) | `constant`/`function`/`class` | `default`, `export=` |
| Anonymous `export default function`/`class` | `function`/`class` | `default` |
| CommonJS `exports.x = …`, `module.exports.x = …`, `module.exports = <non-name>` (JS files, top level, `module`/`exports` not bound by the file) | `function`/`class`/`constant` | `x`, `module.exports` |

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
bindings (imports are links, not symbols, including JS `const x = require(…)`
when `require` is the CommonJS global; with a locally bound `require` the
variable is an ordinary `constant`/`variable`).

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
| `require(expr)` with a non-literal argument in JS | `imports` (`data.require`) | Unresolved `(computed require)`, reason `computed-specifier`; not a call |
| Triple-slash `/// <reference path>` | `imports` (`data.reference: "path"`) | Definite to the referenced captured file's module; `missing-module` otherwise |
| Triple-slash `/// <reference types>` / `lib` | `imports` (`data.reference`) | Unresolved: `external-package` (type packages live in `node_modules`) / `external` (standard library) |
| Calls, `new`, tagged templates, `super(…)` | `calls` | The checker's symbol for the callee, keeping only **callable** declarations (a merged function + namespace, or an `export =` function + namespace, is the function): definite if that is one graph symbol; **candidates** when several (union receivers, repeated JS functions); unresolved otherwise |
| JSX `<Component>` / `<ns.Component>` | `calls` (`data.jsx`) | As calls; intrinsic lowercase elements are not links |
| Type references, `typeof x` | `references` | Type positions keep type declarations (a merged interface + namespace resolves to the interface); `typeof x` keeps value declarations |
| `extends` (classes, interfaces), `implements` | `extends`, `implements` | Checker symbol of the heritage expression |
| Structure | `contains` | Definite |

Usage meaning decides which of a merged symbol's declarations count, before
mapping to graph symbols: calls keep callable declarations, type positions and
`import type`/`export type` bindings keep type declarations (so `import type
{ X }` where `X` is a constant and a type selects the type), value positions
drop type-only declarations. A plain value import binding keeps every meaning
and therefore gives candidates for a merged name.

`require`, `module` and `exports` count as CommonJS only when they mean the
module system's globals. For `require` the checker decides with the compiler's
own `isCommonJsRequire` rule: no binding or only ambient declarations. A local
function, a parameter, a variable or an imported name called `require` is
an ordinary call to that declaration, with no import edge and no import
bindings. The checker resolves `module`/`exports` identifiers to export symbols
rather than scope bindings, so for those a top-level declaration of the name in
the same file counts as shadowing. A `var module` declared in another global
script is not seen (a known limitation).

**Provenance of shadowed-`require` values.** The compiler's binder treats
`const m = require("./dep")` as an import alias of `./dep` even when `require`
is local, so every alias and type it hands out for `m` points into `./dep`.
That is wrong: at run time `m` is whatever the local function returns. The
module therefore decides **once per declaration**, across every captured
JavaScript file of the program (memoised in `provenance.ts`), whether a
binding's value comes from such a call. A declaration carries that provenance
when it is:
- a variable or destructured name initialised from a shadowed `require` call;
- a variable or destructured name initialised from an expression that carries
  it, where an expression carries it if its root name, any member on its path,
  or the callee of a call on its path does, and `a ? b : c` or `a || b`/`a && b`/
  `a ?? b` carries it if either side does;
- a variable that a plain assignment `x = value` gives such a value, in any
  captured JavaScript file;
- `export default value`/`export = value`, `module.exports = value`,
  `exports.x = value`, or an object property `{ x: value }` / `{ m }` holding
  such a value;
- a function whose `return` (or arrow body) yields such a value.

Every resolution path consults it. Alias chains are walked **one step at a
time** (`getImmediateAliasedSymbol`; for a binding of a module whose value is
`module.exports = …`, that assignment is an explicit step) and stop at the first
step whose declaration carries the provenance. The link then targets that
declaration if it is a graph symbol (`import { m } from "./e.js"` resolves to
the constant `m` in `e.js`); otherwise it is unresolved with reason
`shadowed-require`. Every member lookup (`m.real()`, `new m.K()`, `<m.C/>`,
`typeof m.x`, `extends m.K`, `export default m.real`) checks its receiver
expression the same way. So within these rules nothing reached through such a
binding links into the module named by its string argument: not in the same
file, and not through re-exports, default exports, `module.exports`/`exports.x`
or imports in other files.

Genuine bindings are unaffected, because provenance belongs to declarations,
not types: `import * as legit from "./dep"` beside a shadowed `require` of
`./dep` in the same file still resolves `legit.real()` to `dep.ts#real`.

Not tracked (each is an unresolved link at worst, never a link into the
module): values passed as arguments to a parameter (an untyped JavaScript
parameter gives no symbol anyway); values stored by mutation (`obj.x = m`,
array elements, `Object.assign`); compound assignments; and the
`var module`/`var exports` declared in another global script file, described
above.

Paths aliases (`paths`/`baseUrl`), `package.json` `imports`/`exports`/`type`,
`moduleResolution` modes and workspace packages all work through the compiler's
own resolver over the snapshot.

**Unresolved, with the name kept and `data.reason`:**

| reason | Meaning |
|---|---|
| `external` | The checker found declarations, but outside the project (standard library); or a name that resolved through a binding whose module did resolve but whose member has no declaration |
| `external-package` | A bare specifier that does not resolve (`node_modules` is never walked), every binding imported from it, and every call, `new`, type reference, heritage clause and member lookup reached through such a binding |
| `missing-module` | The same for a relative specifier with no captured file (for example `new FlowProducer()` imported from an unbuilt `../../dist/...`) |
| `unresolved-alias` | The same for a specifier matching a `paths` pattern of the owning config, or a `#` subpath import, that resolves to no captured file |
| `no-symbol` | The checker has no symbol: untyped JS, `any`/`unknown` receivers (often because the receiver's type came from an uncaptured package), computed callees |
| `local` | The target is a parameter, local variable, local function or other non-symbol declaration |
| `computed-specifier` | `import(expr)` or JS `require(expr)` with a non-literal specifier |
| `shadowed-require` | Reached through a value from a locally bound `require` (see above) |
| `ambiguous-project` | Equally ranked configs disagree and at least one has no complete answer; their targets are kept |
| `incomplete-config` | The file's config `extends` a base that was not captured, and the link's outcome depends on settings that base could supply (see Status); would-be targets are kept, the reason without that rule is in `data.reasonWithoutConfig` |

**A target set is never narrowed.** If any possible declaration lies outside the
project (standard library, uncaptured package, a local), the link is
**unresolved**, whatever the number of project targets. Examples: `x.toString()`
on `Foo | number`, or on `Foo | Bar | Date`. The project targets are kept in
`data.targets`, with the `reason`. Likewise, when a recorded target's file
failed (for example its package config is broken), the surviving targets are
never promoted: the link is unresolved with all targets kept. Candidate sets
therefore always list every possible target.

Not extracted as links: plain value reads and writes (`x = y`, passing a
function as a callback without calling it), decorators without a call, JSDoc
type references in JavaScript (including JSDoc `import("x")` types), the
`amd-module`/`amd-dependency` and `no-default-lib` triple-slash directives, and
module augmentation (`declare module "./orig"` is a namespace symbol, but
imports of `./orig` are not linked to it; backlog).

## Status and errors

- A syntax error makes the file **partial** with the compiler's syntactic
  diagnostics (ranged); its recovered symbols stay linkable with partial status.
- Unreadable or non-UTF-8 sources stay failed (detected by re-hashing the
  captured text against the original-byte hash) and are never returned by
  analysis.
- **A broken config fails only the files it governs.** A config is broken when
  it is malformed JSON or not an object, or when it has an invalid `extends`
  value. It is also broken when a relative `extends` target that the context
  patterns would capture is missing, or when any base in the `extends` chain is
  malformed or its root is not an object (an array, `null`, a number or a
  string). Each file the config could own is **failed**, with a diagnostic
  naming the cause. When its own JSON is readable, those are exactly the files
  its `files`/`include` select (in a Vite layout, a broken `tsconfig.node.json`
  fails `vite.config.ts` only). Only when its own selection cannot be read
  (malformed JSON or a non-object root) does it fall back to its directory
  subtree; even then it skips files that a healthy config in the same directory
  selects with its own `files`/`include`. Ownership ranking still applies, so a
  nearer valid config keeps its files. Other projects analyse normally. Links from healthy
  files into the failed files keep their names and stay unresolved; their
  recorded targets are in `data.targets`.
- **A broken `package.json`** (malformed or not an object) fails the files of
  that package only. The **nearest** manifest governs a file, with the project
  root at depth 0, so a healthy `z/package.json` keeps `z/**` clean under a
  broken root manifest. A broken workspace root still leaves member packages
  analysed. Its `workspaces` list is unknown, so imports between members stay
  unresolved instead of being guessed.
- **A missing or invalid project reference** fails nothing. References are not
  passed to the compiler, so it becomes a note in the owner's files'
  `data.configNotes`.
- **Module-wide analysis errors** remain in exactly two cases. First, a context
  file that could not be captured (for example non-UTF-8); the core reports it
  before analysis runs. Second, a compiler build that no longer exposes
  `matchFiles`; then no config's file list can be computed, so there is no
  bounded scope to fail.
- A config that **extends an external package** cannot be captured, because
  `node_modules` is never walked. This covers a bare specifier
  (`"@tsconfig/node20"`) and any relative path with a `node_modules` segment
  (`"./node_modules/@tsconfig/node20/tsconfig.json"`). It is an analysis
  limitation, not an error: the config's own settings still apply, and every
  file it owns is **partial**, with a diagnostic naming the missing base.
- A relative `extends` to a base **outside the context patterns** (for example
  `./base.json` or `./config/ts.json`) cannot be captured (interface gap 5). The
  module cannot tell whether the file exists, so this is also a limitation: the
  config's own settings apply, and its files are **partial**, with a diagnostic
  saying that the base is not captured as context and its settings are missing.
- **No confident link under missing settings.** When any config in a file's
  `extends` chain could not be captured (external package, `node_modules` path,
  or a base outside the context patterns), the base could have set `baseUrl`,
  `paths`, `moduleResolution`, `customConditions`, `rootDirs`,
  `moduleSuffixes`, `lib`, `types`, `jsx` or `strict*`. Then the following are
  unresolved with reason `incomplete-config`, with the would-be targets kept in
  `data.targets`:
  - **every** `imports`/`exports` link, relative or not, because `rootDirs`
    and `moduleSuffixes` can redirect relative specifiers too;
  - every link whose lookup passed through an import binding;
  - every link with a target in another file;
  - every member lookup whose receiver is anything other than `this`/`super`
    or a class, enum, namespace or function declared in this file;
  - every other link that had an unresolved reason other than `local` or
    `shadowed-require` (its original reason is kept in
    `data.reasonWithoutConfig`).

  What stays definite: `contains`, triple-slash `path` references (resolved
  from the file system, not by settings), and same-file targets reached by name
  or through a stable receiver (`own()`, `this.method()`, `Local.method()`,
  `extends LocalBase`, `x: LocalType`). Those are lexical, so no compiler
  setting can change them. The rule is deliberately coarse: under a base that
  could not be captured, most cross-file links are unresolved, which is the
  honest outcome.
- Other config diagnostics (unknown options and the like) are kept in each owned
  file's `data.configNotes`; "no inputs found" is normal for solution configs.

## Interface gaps

1. **(Resolved on `main`.)** `test/graph-review.test.mjs` A10 asserted that the
   production module list was exactly `[]`, which any production language broke.
   PR 15 changed it to check that the fixture language is hidden. With `main`
   merged, the full suite passes with this module present.
2. **Scoped project failures are per-file facts, not `analysisErrors`.**
   (Corrected. The first submission wrongly claimed the interface forced a
   module-wide failure.) `analyze` can return `failed` results for some files,
   and the core still resolves the rest. That is how a broken config is isolated
   now. The only difference from a thrown error: the failure appears in the
   report's `failed` list and in each file's diagnostics, not in
   `analysisErrors`, because the interface has no way to name a failed
   *project*. This is a reporting nuance, not a blocker.
3. **Candidate sets cannot have one member.** When the checker returns one
   project declaration plus external ones, the honest answer is "this one, or
   something outside the project", which the interface cannot express (ambiguous
   needs two candidates; definite would be a guess). Done instead: unresolved,
   with the project target kept in `data.targets` and `reason`.
4. **Unresolved reasons are module data.** The interface has one unresolved
   state; the distinction between standard library, uncaptured package, local
   and unknown lives only in `link.data.reason`.
5. **Context files cannot depend on other context files' content.**
   `contextFiles` is a static list of patterns. A module cannot ask for "the file
   named by this config's `extends`". Example: `tsconfig.json` with
   `"extends": "./base.json"` or `"./config/ts.json"`; the base is never
   captured. The only alternative inside the interface is a blanket `*.json`
   context pattern, and it is worse in two ways. Every JSON file in a project
   (lock files, fixtures, data) would be read and stored as context, and every
   JSON edit would force a full reanalysis. Also, the core fails the module's
   whole analysis if any context file cannot be captured, so one non-UTF-8 JSON
   fixture would fail every TypeScript file. Done instead: the patterns cover
   the common base names (`*tsconfig*.json`, `*jsconfig*.json`). Any other
   relative base makes its files partial, and every link that could depend on
   that base's settings is unresolved with reason `incomplete-config` and its
   would-be targets kept (see Status), never a silent guess.
   Closing this needs an interface way to request specific context paths
   discovered during analysis.

## Observations

Full numbers, the comparison across rounds and all four hand checks are in
`evidence/w2-d/README.md`.

- **BullMQ indexes in full**: 261 claimed files, 261 clean, 0 partial, 0 failed,
  no analysis or resolution errors. There are 3,279 symbols and 40,846 links
  (17,812 resolved, 4 candidate sets, 23,030 unresolved). Compared with round 1:
  +45 parameter-property symbols and their `contains` links, +5 calls resolved
  to them, and 629 import bindings relabelled from `external` to the reason of
  their unresolved module. Round 3 has exactly the same totals as round 2. No
  BullMQ candidate set had an outside possibility, so the item-4 rule moved
  none. Two files (`tests/types/*.ts`) are a genuine tie between
  `tsconfig.tests-check.json` and `tsconfig.type-tests.json`; they are analysed
  under both, and no link differs. Round 4 changes no resolution state; only
  unresolved reasons move. 11,444 links are relabelled to the reason of the
  binding they go through: from `external` 6,635 and from `no-symbol` 4,809, to
  `external-package` 11,210 (mostly `vitest`'s `expect`/`it` and their matcher
  chains) and `missing-module` 234 (`tests/types/*.ts` and fixtures that import
  the unbuilt `dist/`). Provenance, incomplete-config and the selection
  fallback do not apply to BullMQ. Hand checks found no wrong link in any
  round: round 1 checked 24 resolved, 12 unresolved and all 4 candidate sets;
  rounds 2, 3 and 4, each with a new seed, checked 30 resolved, 15 unresolved
  and all 4 candidate sets.
  Unresolved links are dominated by uncaptured packages (`vitest`, `ioredis`,
  `node:*`) and the standard library. The existing deep analysis
  (`src/implementation/`) is unchanged and remains available on top.
- Pymtheg `src/`: 208 files clean; 9,055 of 26,071 links resolved. The ratio is
  lower because most calls go into `typescript` and `zod`, which live in
  `node_modules`.
- Time (observation, loaded machine): before the W2-I core landed, the BullMQ
  first index took 38 to 66 s, of which the module's analysis was about 10 s,
  the rest core storage. With W2-I merged (round 4) it takes 18 s, and an
  unchanged re-index takes 6 s (about 5 ms of analysis; stored facts reused).
