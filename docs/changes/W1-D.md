# W1-D: document import

Selection now recognises `doc/` and `.rst` in addition to existing defaults.
`readArchitectureFolder(input, options)` accepts a directory or a single file;
single-file document paths use its basename. Originals remain unchanged. RST
underline headings (and matching overline/underline pairs) become ordinary
linkable sections with original line spans and refresh identities. Styles define
levels in encounter order, capped at the existing six Markdown levels. This is
section recognition, not an RST renderer; indented literal blocks are ignored.
RST titles stay literal (including trailing `#` and `{#...}`), and adornments
accept printable ASCII punctuation. Bullet items and `::` are not headings.
Karl explicitly approved minimal RST wiring in `headings.ts`,
`heading-identities.ts`, and `model.ts` beyond the original owned paths.

`DocumentSelection` adds `include?: readonly string[]` and
`exclude?: readonly string[]` alongside existing `file`, `directory`, and `signal`.
Pass the same options as the third argument of
`folderInventory(entries, selection, options)`. Patterns are relative POSIX paths:
literal files/directories (including descendants), `*`, `?`, and `**`;
`**/` also matches zero directories. Absolute paths and `..` segments are rejected.
An include list replaces default scope predicates; an empty list selects nothing.
Excludes win over includes. Format restrictions, generated/private-directory
pruning, symlink avoidance, and quotas remain independent of scope overrides.
Examples: `{ include: ["engineering/**", "doc/guide.rst"], exclude: ["**/draft*"] }`.

Both discovery APIs return `skipped`:

```ts
{
  total: number;
  pathLimit: 100;
  counts: Partial<Record<SkipReason, number>>;
  paths: { path: string; reason: SkipReason; kind: "file" | "directory" | "entry" }[];
  truncated: number;
}
```

Reasons are `unsupported-type`, `excluded`, `too-large`, `outside-selection`,
`generated-private`, `symbolic-link`, and `special-file`. Counts cover all discovered
skips; paths retain the first 100 in sorted discovery order, with omitted count
stated. Pruned filesystem directories count once; descendants are uninspected,
not claimed counted. Upload inventories count supplied file entries and cannot
report entries the picker did not supply. The legacy `excluded` strings remain
available with their original wording and directory collapsing. Special files
appear only in `skipped`, never in the saved legacy exclusion ledger; single
special-file sources use the supplied basename. Markdown registry warnings stay
unchanged; only unregistered RST documents avoid a false mismatch warning. Filesystem reading
and upload preflight both reject documents over 16 MiB and attach `skipped` to
that error.
Aggregate size/count limits and IO/decoding failures still reject the import.
`renderImportSummary({ ..., skipped })` renders counts, bounded paths and the bound,
including a zero-skip summary. Runtime/private exclusions remain absent from
retained import ledgers to preserve existing cross-transport drift semantics.

## Wiring still needed (outside this chunk)

- `src/cli/help.ts`, import-architecture help: describe repeatable include/exclude
  path/glob options and single-file sources.
- `src/cli/main.ts`, top-level import-architecture branch: parse include/exclude values
  and pass arrays to `readArchitectureFolder(sourceRoot, { signal, include,
  exclude })`. Pass `skipped: loaded.skipped` to **both** preview and saved
  `writeImport` calls. The renderer is ready; current CLI output does not yet
  expose the structured skip summary. Continue retaining the legacy ledger.
- `src/project/documents.ts`, `projectDocumentation`: accept/pass
  `DocumentSelection` options with default scope predicates; in
  `previewProjectDocumentation`, forward `found.skipped` in the shared result
  base (including the no-documents case). This also exposes it to init/setup
  callers.
- `web/src/ArchitectureView.tsx`, `folderSelection` useMemo: pass include/exclude
  arrays as the third `folderInventory` argument; display `inventory.skipped` and
  the summary attached to oversize preflight errors. Preserve it in import
  preview requests. `src/studio/service.ts`, `previewArchitectureImport`, and
  `src/studio/server.ts`, `startStudio`
  `/api/architecture/import-preview` and `/api/architecture/import-commit` handlers: validate and carry
  that summary through preview/commit if transport-wide reporting is desired.
  Already-uploaded document arrays alone cannot reconstruct omitted files.

No dedicated MCP folder-import endpoint exists in the current server; future
wiring should call the same reader/policy and return `skipped`, rather than
implementing another selector. CLI/MCP/Studio option controls and end-to-end
summary propagation remain incomplete and are not claimed delivered here.

Indexes are rebuilt on read; no index-version bump is needed. Relaxing the
per-document size rejection to a reported skip belongs to the chunk that wires
`skipped` into CLI output, so a successful import cannot hide oversized input.
