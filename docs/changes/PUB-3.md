# PUB-3: a README a stranger can use

README.md now answers, in order: what Pymtheg is and what it does today, why
it exists, who it is for and who it is not for, when to use it and its limits,
where it runs and what it writes, a quick start, a documentation map, and
status, contributing and licence. The status section says version 0.1.0, first
public release, and that interfaces may change before 1.0.

Every quick-start command was run against the built CLI and against a global
install from a packed tarball. Every relative link and path in the README
exists. No test pinned old README wording; no test changed.

## What moved where

- Studio feature list: [studio.md](../studio.md).
- `init`, document import and local state: [project-init.md](../project-init.md).
- MCP tool descriptions: [mcp.md](../mcp.md), [code-guide.md](../code-guide.md).
- Example walk-throughs (`check`, `simulate`, `verify`, `emit` on
  `examples/mvp`), scopes and `--scope` files: [journeys.md](../journeys.md),
  [support.md](../support.md).
- Language boundary: [grammar.md](../grammar.md), [support.md](../support.md).
- Contracts-mode scaffolds and `--body empty`: [output-plugins.md](../output-plugins.md).
- Exit codes and their precedence, `--timeout`, `--out` and `--verbose`, the
  install footprint, `npx` signal handling and the tarball `./` or `file:`
  rule are covered in no shipped user doc, so they stay, shortened, in the
  README's "More detail" section. (The `exhaustive` field is also explained
  in [mcp.md](../mcp.md) and [support.md](../support.md).)

## What was removed

- "Pymtheg is a provisional name" and "The package is private": the package
  is published under this name.
- "The package is not published yet" and the tarball install as the main path.
- Links to files no longer in the repository (`research/sources/index.json`,
  `evidence/acceptance.json`, `evidence/benchmarks.json`,
  `evidence/validation.md`, `evidence/product-audit/`), the review-36 counts
  and the trial/audit links, which describe internal history, not the product.
- The "Preserved research" section, the renaming notes and the internal
  validation-command list. The research folder and old examples are still in
  the repository; they are history, not user documentation.
