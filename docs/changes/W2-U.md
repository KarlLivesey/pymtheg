# W2-U: TypeScript extraction crash

## Problem

Indexing this repository's own `src/` and `web/src/` with the TypeScript
module failed four valid files with `TypeScript extraction failed: Cannot
read properties of undefined (reading 'kind')`: `src/mcp/architecture.ts`,
`web/src/ArchitectureView.tsx`, `web/src/MachineDefinitionEditor.tsx` and
`web/src/SourcePlanLinks.tsx`. The files were reported as failed, as if their
content were at fault, and were retried on every index.

## Cause

One cause, in `extract.ts` `lookup()`. When a member access has no symbol
(its receiver's type is `any` or unknown), the extractor checks whether the
receiver's root is a binding of an untyped or uncertain `require(...)`. For
a destructured name it climbed from the binding element with `while
(!ts.isVariableDeclaration(holder)) holder = holder.parent`. A name
destructured from a function PARAMETER has no variable declaration above
its pattern, so the climb walked past the parameter and the function to the
source file, and then past it (`undefined.kind`).

The four sites, and the three shapes they reduce to:

| File                                  | Site                                                           | Shape                                            |
| ------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `src/mcp/architecture.ts`             | `({ searchText, ...e }) => e.summary.slice(…)`                 | object pattern with a rest, a callback parameter |
| `web/src/ArchitectureView.tsx`        | `([title, paths]) => paths.map(…)`                             | array pattern, a callback parameter              |
| `web/src/MachineDefinitionEditor.tsx` | `function …({ value, onChange }: {…}) { value.states.map(…) }` | annotated object pattern, a component parameter  |
| `web/src/SourcePlanLinks.tsx`         | `function …({ item, … }: {…}) { item.links.some(…) }`          | the same                                         |

Minimal reproduction: `export function f({ a }: { a: any }) { a.b(); }`.

The byte comparison found a fifth file with the same crash on `origin/main`:
jiti's `src/plugins/import-meta-env.ts` (`export default function
importMetaEnvPlugin({ template, types }: any)`), now read as well.

## Fix

- `symbols.ts` exports `rootDeclaration()`, which climbs only through
  binding elements and binding patterns and returns the variable
  declaration, or `undefined` for a destructured parameter. `lookup()` uses
  it: only a variable's initialiser can be a `require(...)`, so a
  destructured parameter simply has no such reason, and the link is what the
  compiler answers.
- The class: every climb of this kind in the module was checked. `rename.ts`
  had the same unbounded loop (guarded in practice by a preceding `const`
  check, which only holds under a variable declaration); it now uses the
  same bounded helper. `symbols.ts` already used it. The other parent
  walks in the module stop at a node kind that is always present
  (`while (ts.isParenthesizedExpression(…))`, `while
(ts.isLabeledStatement(…))`, explicit `ts.findAncestor`), or follow
  `parent.parent` only where the AST shape guarantees it (a parameter's
  function, a variable declaration's statement).
- Correctness: every link of the four files was compared with the
  TypeScript checker's own symbol at the link's name (program from the
  project's `tsconfig.json`): 159 resolved links agree, 1,029 links are
  unresolved in both, 0 disagree (`evidence/w2-u/checker-comparison.txt`).

## An internal exception is not invalid code

Before: any exception while extracting one file (from the extractor, or
`The compiler did not load this source`) was caught per file and returned
as an ordinary `failed` result with `TypeScript extraction failed: …`. It
looked exactly like a content failure; a core with content-failure caching
(W2-M: a returned failure is cached unless `failureKind: "transient"`) would
have cached it, so the file would stay failed until its text changed.

Now:

- The diagnostic names the module and the file and says it is not the
  file's fault: `Internal error in the TypeScript module while reading
src/x.ts (a defect in pymtheg, not a problem in this file; it is retried
on the next index): <message>`.
- The result carries `failureKind: "transient"`, so it is never cached as
  a content failure. The current core ignores the field and re-reads every
  failed file anyway; W2-M's core retries it.
- The same marking applies to the compiler-limit failures that depend on
  the environment, not on the file's text: the checker exhausting its stack
  more than the retry limit in one file, and the project-wide rebuild cap.
- The module's own reuse of an unchanged snapshot never reuses such a
  result: it reuses only results that carry the module's analysis data, and
  re-reads failed files only when they are recorded syntax failures.
- Syntax errors are unchanged: a returned content failure (no
  `failureKind`), with the compiler's message.
- An exception outside the per-file loop (building the project model or a
  program) still propagates out of `analyze`, which the core reports as an
  analysis error for the module and retries; it is never a content
  failure of a file.

A test hook (`injectedExtractionFaults`, empty in normal use) makes
extraction of a given path throw, to pin this behaviour.

## Tests

`test/graph-typescript-crash.test.mjs`:

- the three shapes (object pattern with rest, array pattern, annotated
  object pattern), each read, unresolved as the compiler says for `any`
  members, and a member through a destructured parameter resolved to its
  declaration; both fail on the previous extractor;
- a destructured parameter in a JS file is never taken for a `require`
  binding;
- an injected internal exception: `failed`, `failureKind: "transient"`,
  the internal-error message naming the file, distinct from a syntax error
  in the same project (no `failureKind`, `Syntax error at line …`), other
  files unaffected, and read again on the next index with the same content.

## Evidence

`evidence/w2-u/`: the reproduction on this repository's sources (before and
after), the checker comparison, and the byte comparison with `origin/main`
on BullMQ, requirejs, jiti and this repository: every file that did not
crash before has a byte-identical stored result (the module version string
excepted): BullMQ 261/261, requirejs 406/406, jiti 141/141 (plus the one
that crashed, now clean), this repository 271/271 (plus the four, now
clean).

## Version

Module version 16.

## Known limits

- None new. A construct that makes the extractor throw still fails only
  that file, now reported as an internal error and retried.
