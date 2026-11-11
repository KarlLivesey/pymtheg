# W2-D: TypeScript and JavaScript language module for the code graph

Mega-plan item 4.2. One new folder, `src/graph/languages/typescript/`, default-
exports a production `LanguageModule` with id `typescript`. No core file, CLI,
MCP, Studio or `src/implementation/**` file changed; the existing deep analysis
(`src/implementation/typescript.ts`) is untouched and remains available on top.
Nothing is wired into a command.

## Claims and context

| Claimed source                | Notes                                                 |
| ----------------------------- | ----------------------------------------------------- |
| `.ts`, `.tsx`, `.mts`, `.cts` | TypeScript, including declaration files               |
| `.js`, `.jsx`, `.mjs`, `.cjs` | JavaScript, analysed with `allowJs`                   |
| `.d.ts`, `.d.mts`, `.d.cts`   | Covered by the `.ts`/`.mts`/`.cts` claims (see below) |

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
   - a link whose facts are the same under every tied config keeps them;
   - otherwise the merged link is the weakest, most qualified of the
     variants, whatever the configs' order: the union of targets (candidates
     if every config's answer was complete); a reason that every variant
     gives with the same targets is kept, any other reason makes it
     `ambiguous-project` (the reasons listed in `tiedReasons`); `assumes`
     is kept if any variant has it; any other field that differs is not
     picked from one variant but listed per config in `byProject`;
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
extraction or resolution semantics change, and is now 8), the stored facts are
returned as they are:
no program is built and nothing is parsed. They are the complete analysis of the
identical snapshot, and `resolve` re-derives every target from them. Any source,
config or package-manifest change, or a version change, reanalyses everything.

## Symbols and identity

Symbol `identity` is the container-qualified declared name; it never contains a
position. `key` (`kind@start`) is file-local and not persistent.

| Construct                                                                                                                                       | kind                                                    | identity example                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| File                                                                                                                                            | `module`                                                | its path, `src/lib/api.ts` (name too)                       |
| Function declaration (incl. `declare function`)                                                                                                 | `function`                                              | `format`, `Outer.Inner.deep`                                |
| `const`/`let`/`var` holding an arrow function or function expression                                                                            | `function`                                              | `handler`                                                   |
| Class declaration; `const K = class {}`                                                                                                         | `class`                                                 | `Job`, `Klass`                                              |
| Method, constructor, getter, setter, property                                                                                                   | `method`, `constructor`, `getter`, `setter`, `property` | `Job.run`, `Job.constructor`, `Shape.size`, `Shape.#secret` |
| Static member                                                                                                                                   | same kinds                                              | `Shape.static count`                                        |
| Constructor parameter property (`public`/`private`/`protected`/`readonly`/`override`)                                                           | `property`                                              | `A.cb`                                                      |
| Interface; its method/property/accessor signatures                                                                                              | `interface`, `method`, `property`, `getter`/`setter`    | `Runner`, `Runner.run`                                      |
| Type alias                                                                                                                                      | `type`                                                  | `Id`                                                        |
| Enum and members                                                                                                                                | `enum`, `enum-member`                                   | `Color`, `Color.Red`                                        |
| Namespace (`namespace A.B` gives `A` and `A.B`), ambient module, `declare global`                                                               | `namespace`                                             | `Outer.Inner`, `"ambient"`, `global`                        |
| Module-level `const`/`using` (incl. destructured names)                                                                                         | `constant`                                              | `lazy`, `renamed`                                           |
| Module-level `let`/`var`                                                                                                                        | `variable`                                              | `counter`                                                   |
| Callable members of a module-level object literal                                                                                               | `method` (`getter`/`setter`)                            | `api.run`                                                   |
| `export default <expression>` / `export = <expression>` (not a plain name)                                                                      | `constant`/`function`/`class`                           | `default`, `export=`                                        |
| Anonymous `export default function`/`class`                                                                                                     | `function`/`class`                                      | `default`                                                   |
| CommonJS `exports.x = …`, `module.exports.x = …`, `module.exports = <non-name>` (JS files, top level, `module`/`exports` not bound by the file) | `function`/`class`/`constant`                           | `x`, `module.exports`                                       |

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

| Construct                                                                                    | kind                                                 | Resolution                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import … from "x"`, `export … from "x"`, `import x = require("x")`, side-effect import      | `imports` (source: the module)                       | Definite to the target **module** symbol                                                                                                                                                                                                                                                              |
| Named / default / namespace import bindings, `import type` (`data.typeOnly`)                 | `imports`                                            | Definite to the **original declaration**, through barrels, `export *`, renames and default exports (checker alias chain); namespace imports to the module                                                                                                                                             |
| `export { a as b } from`, local `export { a }`, `export * as ns from`, `export default name` | `exports`                                            | Same as bindings                                                                                                                                                                                                                                                                                      |
| `export * from "x"`                                                                          | `imports` (`data.reexport`)                          | Module only (no per-name link)                                                                                                                                                                                                                                                                        |
| Dynamic `import("lit")`                                                                      | `imports` (`data.dynamic`, source: enclosing symbol) | Definite to the module; computed specifier: unresolved `(dynamic import)`                                                                                                                                                                                                                             |
| `require("lit")` in JS files; `const x = require()` / `const {a: b} = require()` bindings    | `imports` (`data.require`)                           | Module definite; bindings through the checker's CommonJS aliasing to the original declaration (also into `.ts` modules)                                                                                                                                                                               |
| `require(expr)` with a non-literal argument in JS                                            | `imports` (`data.require`)                           | Unresolved `(computed require)`, reason `computed-specifier`; not a call                                                                                                                                                                                                                              |
| Triple-slash `/// <reference path>`                                                          | `imports` (`data.reference: "path"`)                 | Definite to the referenced captured file's module; `missing-module` otherwise                                                                                                                                                                                                                         |
| Triple-slash `/// <reference types>` / `lib`                                                 | `imports` (`data.reference`)                         | Unresolved: `external-package` (type packages live in `node_modules`) / `external` (standard library)                                                                                                                                                                                                 |
| Calls, `new`, tagged templates, `super(…)`                                                   | `calls`                                              | The checker's symbol for the callee, keeping only **callable** declarations (a merged function + namespace, or an `export =` function + namespace, is the function): definite if that is one graph symbol; **candidates** when several (union receivers, repeated JS functions); unresolved otherwise |
| JSX `<Component>` / `<ns.Component>`                                                         | `calls` (`data.jsx`)                                 | As calls; intrinsic lowercase elements are not links                                                                                                                                                                                                                                                  |
| Type references, `typeof x`                                                                  | `references`                                         | Type positions keep type declarations (a merged interface + namespace resolves to the interface); `typeof x` keeps value declarations                                                                                                                                                                 |
| `extends` (classes, interfaces), `implements`                                                | `extends`, `implements`                              | Checker symbol of the heritage expression                                                                                                                                                                                                                                                             |
| Structure                                                                                    | `contains`                                           | Definite                                                                                                                                                                                                                                                                                              |

Usage meaning decides which of a merged symbol's declarations count, before
mapping to graph symbols: calls keep callable declarations, type positions and
`import type`/`export type` bindings keep type declarations (so `import type
{ X }` where `X` is a constant and a type selects the type), value positions
drop type-only declarations. A plain value import binding keeps every meaning
and therefore gives candidates for a merged name.

**Locally bound `require`, `module` and `exports` (same-length rename).** The
compiler treats a call to anything named `require` in a JavaScript file as a
module import, and `module.exports = …`/`exports.x = …` as CommonJS exports,
by name alone, even where the file declares its own `require`, `module` or
`exports`. The fix is at the source (`rename.ts`): before a JavaScript file
reaches the compiler, a syntactic scope analysis of that file classifies every
occurrence of the three names, working on the decoded identifier and its full
token span:

| Classification | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Compiler text                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `real`         | The module system's binding: Node's CommonJS wrapper parameter; a free name in an ES-module-syntax file (bundler semantics); or `const require = X(base)` where `X` **provably is Node's `createRequire`** by origin, whatever its local name (an ES named import `createRequire [as cr]`, a namespace or default import's `.createRequire`, or `const { createRequire: cr } = require("module")` with a real `require`), the file never replaces that factory, and `base` is this file's own location | unchanged                                                                                        |
| `local`        | Bound to a declaration of the file's own                                                                                                                                                                                                                                                                                                                                                                                                                                                               | renamed to a program-wide fresh name of the same length                                          |
| `uncertain`    | Decided only at run time                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | renamed to a second fresh name that is never declared, so the compiler infers nothing through it |

Fresh names are chosen once per program and occur in **no** captured file, so a
renamed `import { require }` and the exporter's renamed `export function
require` always agree, and nothing can collide with an existing `requirf`. ES
import/export specifier _names_ `require`/`module`/`exports` are spelled with
the fresh name in every JS file for the same reason (`export { require as
loader }` renames only the local side). Offsets are unchanged, and facts
restore the original names: no fresh name appears in any stored fact,
identity or diagnostic (a test asserts this over all stored facts). Files
record `data.renamedForCompiler`.

**Exact, and tested against Node.** `test/graph-typescript-scope-oracle.test.mjs`
generates 286 small files (411 call sites; summary in
`evidence/w2-d/scope-oracle.txt`). They cover every declaration form:

- function declarations at top level, in a function, in a block, in nested
  blocks, in labelled and `switch` blocks, and duplicated;
- `var`/`let`/`const` before and after use;
- parameters, default and destructured parameters, and a body `var`
  re-declaring a parameter (with and without parameter expressions);
- catch clauses, plain and destructured;
- class static blocks, class and function expression names, class declaration
  names;
- import bindings;
- `for`/`for-in`/`for-of` heads with `let`/`const`/`var`;
- arrows, getters, setters, methods, generators and async functions;
- a function declaration directly as an `if`/`else` branch (no braces), and
  nested `if`s;
- the wrapper's `arguments`: written in an arrow, written by an arrow called
  later, returned by an arrow and written, read only (`arguments.length`,
  `arguments[0]`), and a non-arrow function's own `arguments`;
- `createRequire` aliased (`as cr`, `{ createRequire: cr }`), replaced on the
  module object (assignment, `Object.assign`), with another base
  (`new URL("./sub/", import.meta.url)`), and spoofed;
- the call forms `require(…)`, `(require)(…)`, `(0, require)(…)` and
  `module.require(…)`, plain and shadowed;
- a free `require` in an ES module, and `module.require` in an ES module;
- `var arguments` (also `= arguments`), `let`/function/parameter named
  `arguments`, and the wrapper's `arguments` written from a computed class or
  object key, and passed on;
- every call that receives the wrapper's `arguments` (`Array.from`,
  `slice.call`, `f(...arguments)`), including the bypasses of a callee
  proof: a local `Array`, a patch from another file, a computed key on
  `[].constructor` or the array prototype, `Function.prototype.call`,
  `Object.assign`, `Reflect.set`, `defineProperty`, a renamed global, and
  identity copies written afterwards; and array spreads under replaced
  iterators (`Array.prototype[Symbol.iterator]`, `values`,
  `Object.prototype[Symbol.iterator]`, the array iterator's `next`);
- `createRequire` with a reassigned `__filename`, with a local
  `pathToFileURL`, with `node:url`'s `pathToFileURL`, and with `__filename`
  in an ES module;
- cross-file pairs (exporter and Node-run consumer): named, default,
  namespace and barrel imports of a free-`require` value, of a
  `createRequire` value, and of a local-`require` value; and a free-`require`
  value reached through an object member (`{ d }`, `{ value: d }`), a
  function return, an array element, destructuring, an object spread, a class
  field, a JSDoc generic and a 30-step alias chain, directly and through a
  barrel, with the same routes over a real `createRequire` loader as the
  control (no label allowed there).

Each form appears in sloppy CommonJS, strict CommonJS and ES modules where it is
valid. The test runs every file in Node (one child process, sequential) and
records whether each call reaches the real loader, a local function, another
directory (`sub/dep.cjs`), or throws. It then checks two things against Node:
the analysis' classification of the callee, and the links the module actually
**emits** for that site, after indexing the whole corpus:

- where Node used something local (or threw), there must be no link into the
  dependency;
- where Node used the real loader and the analysis says so, there must be a
  resolved import of it, and the member call `v.real()` on the value must
  resolve into it. For the forms the compiler does not type, it must instead
  be `untyped-require`;
- where Node used something local, threw or loaded another directory, neither
  the import nor the member may link into it;
- for the bundler reading, the import and the member must carry
  `data.assumes`. Cross-file sites check the member link in the importing
  file, so every dependent route above must carry the label.

Result: **0 classification and 0 emitted-link disagreements**. 296 static
sites match exactly: 130 local, 147 real, and 19 where Node throws or never
reaches the site (TDZ, an undefined hoisted var, an early error, an
uncallable branch function), classified local. The model that this
verifies:

- **Block scope.** `let`/`const`/`class`/block functions are block-scoped. A
  catch binding is scoped to its block only. A class static block is its own
  `var` scope.
- **Parameters.** Default-parameter expressions see the parameters, not the
  body's `var`s. A body `var` of a parameter's name is the same binding.
- **Names of expressions.** Function and class expression names bind only
  inside the expression.
- **Annex B.3.2.1.** In sloppy function code, a block-level function also binds
  a `var` in the function, except when the name is a parameter or replacing it
  with `var` would conflict with an enclosing lexical declaration. Duplicates
  in one block are allowed.
- **CommonJS top level.** This is the body of Node's wrapper function, whose
  parameters are `exports`, `require` and `module`. So Annex B never hoists
  these names there. Node confirms that after `if (true) { function require
() {} }` a top-level `require` is the real loader. A top-level `function
require` replaces the parameter, and a top-level `let require` is an early
  error.
- **Annex B.3.4.** A function declaration that is directly an `if` or `else`
  branch (no braces), in sloppy code, behaves as if it were in a block of its
  own. It is hoisted like a block function, and its name binds inside it.
- **Strict mode.** ES modules, `"use strict"` prologues and class bodies have
  no Annex B. A strict function's `arguments` is not mapped to its parameters
  (confirmed by the oracle).

**Conservative (`uncertain`, never treated as the loader).** These have no
static answer:

- an occurrence inside a `with` body;
- any occurrence whose binding scope contains a direct `eval(…)` that could
  add a nearer `var` (sloppy) or assign the binding (any mode);
- the CommonJS wrapper binding when the file reassigns it anywhere: `var
require = …` at top level, `require = …`, compound or destructuring
  assignment, or `for (require of …)`;
- in sloppy CommonJS code, any use of the **wrapper's** `arguments` other
  than a plain read or an array spread. `arguments` is mapped to the
  parameters `exports, require, module, __filename, __dirname`. Plain reads
  are `arguments.length` and `arguments[i]`. Every call that receives it
  counts as passing it on, whatever the callee: `Array.from(arguments)`,
  `Array.prototype.slice.call(arguments)`, `[].slice.call(arguments)` and
  `f(...arguments)` included. Any of these callees can be replaced from
  another file, through a computed key, through `Function.prototype.call`,
  `Object.assign`, `Reflect.set` or `defineProperty`, or under another name of
  the global object, so no proof is attempted. Only an array spread
  (`[...arguments]`) stays harmless, because it iterates through the
  arguments object's own `Symbol.iterator`. That is the built-in
  `Array.prototype.values`, captured when the object is created; replacing
  `Array.prototype[Symbol.iterator]`, `Array.prototype.values` or
  `Object.prototype[Symbol.iterator]` does not change it. A replaced
  `%ArrayIteratorPrototype%.next` receives only the iterator, never the
  object, and `caller.arguments` is an unmapped copy in V8. The oracle checks
  each of these in Node. `f(...arguments)` goes through the same iterator and
  passes only values, so treating it as passing is deliberately over-cautious.
  Writing, deleting, passing `arguments` itself on, returning it or aliasing
  it counts. Which function's `arguments` an
  occurrence denotes is resolved:
  - arrows inherit it;
  - a computed member key or a decorator is evaluated in the enclosing scope,
    not the method's;
  - a `var arguments` (with or without `= arguments`) in the wrapper's own var
    scope does not replace the mapped object;
  - any other binding of that name is a different binding: `let`/`const`, a
    function, a parameter, or a nested function's `var`;
  - any other function has its own `arguments`.
- a `createRequire` result when the file could have replaced the factory: a
  write to any `createRequire` property, an
  `Object.assign`/`defineProperty`/`defineProperties`/`Reflect.set`/
  `setPrototypeOf` call that mentions it or is given the module object, or
  the module object used other than as a member read.

Such a `require("x")` gives an `imports` link that is unresolved with reason
`dynamic-scope`, with `x` kept in `data.targets`. The call and members of its
value are `dynamic-scope` too, and the file is partial with a diagnostic. 36
oracle sites are in this category; the analysis says `uncertain` (or the exact
answer) and never "real" where Node did not use the real loader.

A `createRequire` base counts as this file's own location only when that is
**proven**:

- `import.meta.url`/`import.meta.filename` in an ES module whose
  `import.meta` the file never writes or lets escape;
- the wrapper's own `__filename` in CommonJS, unshadowed and never written,
  including through the wrapper's `arguments`;
- `pathToFileURL(<one of those>)`, where `pathToFileURL` provably comes from
  `node:url`/`url` (the same origin test as `createRequire`) and is never
  replaced.

`__filename` in an ES module and `import.meta` in CommonJS make Node throw,
and are not this file. Any other base resolves from somewhere else. One example is `createRequire(new URL("./sub/",
import.meta.url))`. Its requires are unresolved with reason
`createrequire-base`, the specifier kept, and no would-be target, because the
target from this file would be the wrong one. Indirect eval
(`(0, eval)(…)`, `globalThis.eval(…)`, `new Function(…)`) runs in global
scope and cannot change a module's bindings, so it is ignored, and the oracle
confirms the real loader there.

**Value flow is not modelled.** A local binding that holds the real loader at
run time is classified local. Examples are `function load(require) {…}
load(require)` (2 oracle sites) and `const r = require; r("x")`. That loses
an import edge; it is never a wrong link.

**Not modelled, with exactly what is emitted:**

- **AMD.** `define(function (require, exports, module) { require("./b") })`:
  the call is to a local parameter. It is emitted as an unresolved `calls`
  link (`local`) and no `imports` link, although the AMD loader would load
  `./b` at run time.
- **Globals across script files.** A top-level `var require` in a non-module
  browser script is, in a browser, a global that other scripts see. The
  analysis uses Node's per-file scope. In the declaring file it is the wrapper
  binding, and when reassigned (as in `requirejs`'s `require.js`) its
  occurrences are `uncertain`/`dynamic-scope`. In other files `require` keeps
  its CommonJS meaning, and their `require("x")` calls are emitted as import
  edges.
- **Free `require` (and `module.require`) in an ES module.** In an
  ES-module-syntax file (or a `.js` file under `"type": "module"`) this is
  treated as the loader (bundler semantics); Node itself throws a
  ReferenceError there. Every link that rests on that reading carries
  `data.assumes: "bundler-require"`, in this file and in others: the import,
  its bindings, and the calls and members reached through them by any route
  the checker follows. This is decided by the differential analysis below,
  not by following routes by hand. An agent can therefore tell the assumption
  from a fact.
- **Monkey-patching the loader.** Replacing `Module.prototype.require` or
  `Module._load` (as mocking libraries do), or mutating Node's `module` object
  from another file, is outside the binding model. Such code is read as
  ordinary CommonJS.
- **Other callee forms.** These forms of the real loader are supported and
  linked (`data.calleeForm`): `require(…)`, `(require)(…)`, `(0, require)(…)`
  and `module.require(…)`. The compiler types none of the last three. Their
  bindings (`const p = (0, require)("x")`, `const { a } = …`) are emitted as
  `imports` links unresolved with reason `untyped-require`, and so are calls
  and members through them (`p.real()`). These forms are not
  linked: `require.call(…)`, `.apply`, `.bind`, an alias variable
  (`const r = require; r(…)`), a tagged template, `new require(…)`, a
  `{ require }` shorthand and `[require][0](…)`.

**Spelling.** If any occurrence that must be renamed is written with an escape
(`\u{0072}equire`), it cannot be replaced at the same length, so that file
**fails** with a diagnostic. An escaped _real_ `require` needs no rename and is
fine. A parse failure inside the analysis also fails just that file.

Paths aliases (`paths`/`baseUrl`), `package.json` `imports`/`exports`/`type`,
`moduleResolution` modes and workspace packages all work through the compiler's
own resolver over the snapshot.

**Unresolved, with the name kept and `data.reason`:**

| reason                | Meaning                                                                                                                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `external`            | The checker found declarations, but outside the project (standard library); or a name that resolved through a binding whose module did resolve but whose member has no declaration                                                                          |
| `external-package`    | A bare specifier that does not resolve (`node_modules` is never walked), every binding imported from it, and every call, `new`, type reference (including qualified names such as `ns.T`), heritage clause and member lookup reached through such a binding |
| `missing-module`      | The same for a relative specifier with no captured file (for example `new FlowProducer()` imported from an unbuilt `../../dist/...`)                                                                                                                        |
| `unresolved-alias`    | The same for a specifier matching a `paths` pattern of the owning config, or a `#` subpath import, that resolves to no captured file                                                                                                                        |
| `no-symbol`           | The checker has no symbol: untyped JS, `any`/`unknown` receivers (often because the receiver's type came from an uncaptured package), computed callees                                                                                                      |
| `local`               | The target is a parameter, local variable, local function or other non-symbol declaration                                                                                                                                                                   |
| `computed-specifier`  | `import(expr)` or JS `require(expr)` with a non-literal specifier                                                                                                                                                                                           |
| `compiler-limit`      | The TypeScript checker exhausted its stack on this lookup (deep inference chains); the file is partial                                                                                                                                                      |
| `dynamic-scope`       | A `require`/`module`/`exports` whose meaning is decided at run time (see above), anything reached through its value, and unresolved names inside a `with` body                                                                                              |
| `not-a-module`        | A binding from a captured file that was analysed, has no syntax errors, and has no imports or exports (a script). The import edge itself links to that file and carries `data.notAModule: true`; that flag means exactly this and nothing else              |
| `partial-target`      | A binding from a captured file with syntax errors and no exports found (its exports cannot be ruled out)                                                                                                                                                    |
| `target-unavailable`  | The target file failed analysis (parser, binder, scope analysis or a broken config); the import edge and its bindings are unresolved, the file kept in `data.targets`                                                                                       |
| `untyped-require`     | A binding, call or member reached through a captured module required by a form the compiler does not type (`(0, require)(…)`, `(require)(…)`, `module.require(…)`, an escaped `require`). The import edge links to the module                               |
| `partial-declaration` | The link's outcome depends on recovered text after a syntax error (see Status and "Differential analysis"); the normal program's targets are kept                                                                                                           |
| `createrequire-base`  | A require through `createRequire` with a base other than this file's location; no would-be target is kept                                                                                                                                                   |
| `renamed-export`      | An ES binding of an export named `require`/`module`/`exports` between a JS file and a TS file or a CommonJS property, whose spellings differ for the compiler                                                                                               |
| `ambiguous-project`   | Equally ranked configs disagree and at least one has no complete answer; their targets are kept                                                                                                                                                             |
| `incomplete-config`   | The file's config `extends` a base that was not captured, and the link's outcome depends on settings that base could supply (see Status); would-be targets are kept, the reason without that rule is in `data.reasonWithoutConfig`                          |

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
  diagnostics (ranged). Heritage grammar the parser accepts but that has no
  meaning also makes it partial, with a diagnostic: `class C extends A, B`,
  two `extends` clauses, `extends` after `implements`, or `implements` on an
  interface.
- **What a partial declaration supports.** The text of a declaration from
  its first syntax error to its end is recovered structure that the source
  does not actually state. So is a whole heritage clause list when the error
  is inside it (including the grammar defects above). Links that depend on
  that text are decided by the differential analysis below:
  - **Existence and name.** A name before the error is not untrusted, so a
    call to `function f(x: , y) {}` links to `f`, `new Base()` links to a
    truncated `class Base`, and an import of the file links to its module.
  - **Anything that depends on the text after the error** is unresolved with
    reason `partial-declaration`: a member declared after it (`x.b()` with
    `interface I { a: ; b(): void }`), a return type after it
    (`f(1, 2).go()`), and every value that carries such a type onward
    (a variable, a callback parameter typed by the callee, a returned value,
    an array element, a destructured or spread value, a class field, a
    generic instantiation, another file, a barrel). Members inherited
    through a heritage clause holding the error, and the `extends`/
    `implements` links written in it, are withheld too.
  - **Labelling.** The normal program's would-be targets are kept in
    `data.targets`. Like any incomplete set, they never make a candidate set
    complete.
  - **Containment.** A link that resolves the same without the untrusted
    text stays definite, even in the same file or through the same
    declaration (`new Box().go()` beside a broken function returning `Box`).
- **Open declarations: what recovery may have dropped.** The differential
  analysis below sees only the text the parser kept. Recovery can also throw
  text away (`a = [1, ;` swallows the next member; an unterminated comment
  or string swallows everything after it), and a lookup that then falls
  through to an inherited or outer declaration agrees in both programs. One
  notion covers this: a declaration or scope is **open from offset N**, and
  one check consumes it, for every definite target or candidate set.
  - **Where trust ends** (`trustEnd`): the start of the construct the error
    belongs to. An error inside or at the end of a comment, string,
    template, regular expression or JSX element belongs to it from its
    opening delimiter, so an unterminated one reported at the end of the
    line or file is untrusted from where it opens. Only the parser's own
    diagnostics count; grammar checks that drop no text (JS-only syntax,
    heritage defects) open nothing. A parser diagnostic that drops no text
    either (an octal literal) is not told apart and opens its file.
  - **(a) Member lists.** A class, interface, enum, namespace, type literal
    or object literal is open from the first trust end inside its member
    list, or from its own end if its closing brace is missing. A lookup
    through a receiver whose type involves an open one is withheld unless
    every target is a member of it lying wholly before N. The receiver's
    type is followed through its symbol's declarations (merged ones
    included), base classes and interfaces, `implements` clauses, union and
    intersection parts, type arguments, constraints, mapped types' source,
    and the declarations of its properties (`typeof`, indexed access and
    `Partial<…>` included). So `new S1().m()` with `class S1 extends Base {
a = [1, ; m() {} }` is withheld, though both programs land on `Base.m`.
    Members wholly before the error stay definite; the member that holds the
    error (`broken(x: , y) {…}`, its name before it) is not wholly before it
    and is withheld, though the neutral text keeps its name.
  - **(b) Scopes.** A file with any parse error has an open scope from the
    first trust end, and so does an open namespace body. Decided for names:
    - a name used in an open scope whose declaration lies outside that
      scope (an outer scope, a global from another file) is withheld: an
      unseen declaration could shadow it. One declared in the scope is
      withheld if an unseen one could replace it (`var`, or a function in a
      JS file); imports, `let`/`const`, classes, interfaces, types and TS
      functions are kept;
    - a global declared by another script file is withheld from every file
      while any captured script file is open (its unseen top-level
      declarations would be globals too);
    - an import, re-export or namespace member resolves through the modules
      it consults: the specifier's module and, when the name is not declared
      there, its whole `export *` closure. If one of them is open, the link
      is withheld unless the target is declared in that open module and is
      not replaceable. An unseen export of the same name could shadow a star
      export or make it ambiguous. Names declared in the open file, before
      or after the error, stay definite: they are seen;
    - in a TS file with an open scope, every class, interface, enum and
      namespace declared directly in it is open from its own end: an unseen
      merge partner (a later `interface X`) could add members. Their own
      members stay definite; anything that falls through them (an inherited
      member) is withheld.

    Cost: nothing for files without parse errors (BullMQ). With one broken
    file, every name imported through a barrel whose `export *` closure
    includes it is withheld. That is most of BullMQ's tests, which import
    from `src/classes/index.ts` (see Observations). In a project of scripts,
    one broken script withholds every cross-file global.

  - **Spans for the differential analysis** start at the trust end too,
    never at the reported position. They are never empty. Trust that ends
    outside every statement (an unterminated comment after a recovered
    class) is a span to the end of the file.
  - Like the differential labels, these are `partial-declaration` with the
    would-be targets kept. The neutral program does not apply the rule (it
    answers only what the kept text supports).

- **Differential analysis.** Two kinds of input are untrusted: (a) the
  syntax-error tails above, and (b) each free `require`/`module` in an ES
  module that is read as the loader only under the bundler assumption. When
  a project's program contains neither (the normal case, as in BullMQ),
  nothing else happens. Otherwise, for each kind present, a second program is
  built over the same snapshot with that input neutralised **at the same
  offsets** (`untrusted.ts`):
  - (a) each tail becomes spaces (line breaks kept in place), starting with
    exactly the closing brackets that were open where it starts (or, when the parser closed the
    declaration in less room, only the tail's own closing brackets), so every
    following statement parses at the same position as before. This is
    checked: if any top-level statement outside the tails would move or
    change kind, everything from the first tail to the end of the file is
    neutralised instead;
  - (b) the assumed `require`/`module` is renamed, at the same length, to an
    undeclared name, as the dynamic-scope rule does.

  Every file of the project is extracted again against that program, and
  each link is compared with the link at the same site (kind and range). If
  the target set and reason are the same, the link does not depend on the
  untrusted input and is unchanged. If they differ, or the site has no link
  there, the link depends on it. For (a), a link with targets and no other
  reason becomes unresolved `partial-declaration` with the normal program's
  targets kept. For (b), it keeps its outcome and gains
  `data.assumes: "bundler-require"`. If both kinds apply to one link,
  `partial-declaration` wins. The type checker does all the propagation;
  there are no hand-written routes. Structural `contains` links come from the
  parse alone and are not compared. A neutral extraction that fails or is cut
  off marks every link of that file as dependent.

  Cost: nothing for a project without untrusted input. Otherwise one extra
  program and one extra extraction of the project's files per kind present
  (two when a project has both). Unchanged files reuse the normal program's
  parsed and bound source files. A project whose program does not reach an
  untrusted file builds nothing extra. Measured on BullMQ with one broken
  file: see `evidence/w2-d/README.md`.

- **Compiler stack limits.** The checker's inference recurses once per step, so
  a long chain (`let v1 = v0; …` or `function f1() { return f0(); } …`) can
  exhaust the stack.
  - **Warm-up.** After every (re)build, the whole program is warmed in program
    order (variable types and function return types of every captured file),
    so each step builds on a computed one. A 1,000-step chain then indexes
    clean, and a file's answers never depend on which other files happened to
    be extracted before a rebuild. A file whose own warm-up overflows is
    skipped by later warm-ups.
  - **Rebuild on overflow.** After an overflow the checker's internal state is
    not trustworthy: a retried lookup can silently answer "no symbol". So an
    overflow aborts that file's extraction, the program is rebuilt and
    re-warmed, and the file is retried with the overflowing node answered as
    `compiler-limit` without asking the checker. In the reversed 10,000-step
    test chain that is the one deep expression `g0().go()`: its two lookups
    (`g0` and `.go`) become `compiler-limit`, and every other link is intact.
  - **Caps.** After 25 rebuilds for one file that file fails, and the checker
    is rebuilt before the next file. After 200 rebuilds in one project, the
    remaining files fail with a diagnostic saying so.
- **Tests and stack size.** No stack-limit test depends on the machine's
  stack size:
  - The binder test runs in a fresh Node process that searches for a nesting
    depth at which parsing succeeds and binding overflows, then requires the
    binder outcome at that depth. If no such depth exists, it is reported as
    an explicit skip.
  - The reversed-chain, independence and nested-parentheses tests check that
    their overflow actually happened, and otherwise skip that part with a
    reason.
  - The warm-up results hold at any stack size.

  Checked with `node --stack-size=700 --test` and `node --stack-size=2048
--test`: 84 of 84 pass, with no skip needed at either size. Node rejects
  `--stack-size` inside `NODE_OPTIONS`. The test runner passes it on to its
  per-file processes, and the tests forward it to the child processes they
  start.

- **Parser and binder stack limits.** Each file parses in its own guard, so a
  file the parser cannot handle (10,000 nested parentheses) fails alone. The
  binder runs when the checker is created. On a binder overflow the offending
  file is identified (the file whose binding started but did not finish, or,
  failing that, by binding each file alone), it fails alone with a
  diagnostic, and the host's parse cache is discarded, because the binder
  writes into cached files. If the culprit cannot be isolated, that config's
  files fail, never the whole module.
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
  subtree. In that case it claims nothing from the compiler's parse, which
  would be the default input list of every file. Even then it skips files that
  a healthy config in the same directory selects with its own `files`/`include`,
  so a `tsconfig.tools.json` containing `[1,2]` never fails the files of a
  sibling `tsconfig.web.json`. Ownership ranking still applies, so a
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
- `files`, `include` and `exclude` must be arrays of strings. Any other value
  (for example `"include": 42`) makes the selection unreadable: the config is
  broken, and only the guarded directory fallback applies.
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
  - every other link that had an unresolved reason other than `local` (its
    original reason is kept in `data.reasonWithoutConfig`).

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
   _project_. This is a reporting nuance, not a blocker.
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

Full numbers, the comparison across rounds and every hand check are in
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
  fallback do not apply to BullMQ. Round 5 (the rename) leaves resolution
  unchanged: BullMQ has no locally bound `require`/`module`/`exports`, and 0
  files are renamed. 14 qualified type names through namespace imports of
  uncaptured packages (`sinon.SinonStub`, `vi.fn`, `DefaultTheme.NavItem`) move
  from `external` to `external-package` (item 3). Hand checks found no wrong
  link in any round: round 1 checked 24 resolved, 12 unresolved and all 4
  candidate sets; rounds 2 to 6, each with a new seed, checked 30 resolved,
  15 unresolved and all 4 candidate sets. Rounds 6 to 10 leave BullMQ's
  totals identical to round 5. Rounds 9 and 10 build no second program
  there, and no BullMQ file uses the wrapper's `arguments` or has a parse
  error.
- **One syntax error in BullMQ's `class Job`** (`isFailed(x: , y)`): 6
  programs instead of 4. 2,030 links become `partial-declaration` (round 9:
  388), against 15,782 still resolved:
  - the same 388 as in round 9 (the differential analysis);
  - 6 lookups through `interface JobQueue extends Omit<MinimalQueue, …>`
    declared in the open `job.ts`, falling through to `MinimalQueue`
    (open-scope merge partner);
  - 18 calls of `job.isFailed()`: the member holding the error. Its name
    comes first, but it is not wholly before the error;
  - 1,618 names (1,243 calls, 225 imports, 148 type references, one
    `extends`, one `implements`) imported through barrels whose `export *`
    closure includes `job.ts`, chiefly `src/classes/index.ts` (29 star
    exports, imported by 48 files). An unseen `export` in `job.ts` could
    shadow or make ambiguous any of those names.
- **`requirejs` in round 10:** 410 links become `partial-declaration`
  (resolved 471 → 63, candidate sets 2 → 0). `tests/packagesMultiLevel/build.js`
  is a script (a bare object literal) with parse errors, so its scope is open
  and any global could be redeclared unseen. 407 calls to globals declared
  by script files are withheld: `define` 404, `finished` 2 and `D` 1. In
  `dist/file.js` the parser reports an octal literal (`0777`), so its own JS
  functions `mkDir`/`mkFullDir` (3 calls) are replaceable in an open scope.
  The rename and
  import-edge figures are unchanged.
- **A project with a local `require`: `requirejs`** (`7faea649`, 406 files, 0
  failed). 133 files are renamed (`require` in 116, `exports` in 73, `module`
  in 61), almost all AMD `define(function (require, exports, module) {…})`
  modules. With the rename, 199 calls go to the local `require` parameters
  (unresolved `local`), and 16 `require` import edges remain (2 resolved, the
  genuine CommonJS ones in `dist/dist-site.js`). A run with the rename disabled
  had 180 import edges (4 resolved). The two extra resolved edges were AMD
  `require("./b")` calls inside `define` factories; the AMD loader would load
  them, but they are not CommonJS, and they are now reported conservatively as
  calls to the local parameter. `jiti` (a loader shim, 142 files) uses
  `createRequire(import.meta.url)("…")` directly; it has no locally bound
  `require` and nothing is renamed.
  Unresolved links are dominated by uncaptured packages (`vitest`, `ioredis`,
  `node:*`) and the standard library. The existing deep analysis
  (`src/implementation/`) is unchanged and remains available on top.
- Pymtheg `src/`: 208 files clean; 9,055 of 26,071 links resolved. The ratio is
  lower because most calls go into `typescript` and `zod`, which live in
  `node_modules`.
- Time (observation, loaded machine): before the W2-I core landed, the BullMQ
  first index took 38 to 66 s, of which the module's analysis was about 10 s,
  the rest core storage. With W2-I merged it takes 9 to 18 s, and an unchanged
  re-index takes 3 to 6 s (about 5 ms of analysis; stored facts reused).
