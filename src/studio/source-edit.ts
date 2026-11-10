import type { ProjectIR } from "../semantic/core.js";
import { hash, type Span } from "../shared/identity.js";
export interface SourceChange {
  span: Span;
  before: string;
  text: string;
}

/** Preview one set of source transactions against the already captured project. */
export function sourceEditPreview(
  ir: ProjectIR,
  file: string,
  edits: SourceChange[],
  seeds: Iterable<string>,
  notices: string[] = [],
) {
  const sources = new Map(
    ir.snapshot.sources.map((source) => [source.file, source]),
  );
  const source = sources.get(file);
  if (!source)
    throw Error("The edited source is not in this checked snapshot.");
  const files = [...new Set(edits.map((edit) => edit.span.file))].map(
    (file) => {
      const frozen = sources.get(file);
      if (!frozen)
        throw Error("An edited file is outside the checked snapshot.");
      const changes = edits
        .filter((edit) => edit.span.file === file)
        .sort((a, b) => b.span.start - a.span.start || b.span.end - a.span.end);
      let text = frozen.text,
        start = text.length;
      for (const change of changes) {
        if (
          change.span.end > start ||
          change.span.start < 0 ||
          change.span.end < change.span.start ||
          text.slice(change.span.start, change.span.end) !== change.before
        )
          throw Error(
            "The requested edits overlap or do not match the checked source. Check again before applying them.",
          );
        text =
          text.slice(0, change.span.start) +
          change.text +
          text.slice(change.span.end);
        start = change.span.start;
      }
      return {
        file,
        expectedSourceHash: frozen.hash,
        before: frozen.text,
        hash: hash(text),
        text,
        edits: changes,
      };
    },
  );
  const reverse = new Map<string, string[]>();
  for (const edge of ir.edges) {
    const users = reverse.get(edge.to) ?? [];
    users.push(edge.from);
    reverse.set(edge.to, users);
  }
  const affectedIds = new Set<string>(),
    pending = [...seeds];
  while (pending.length)
    for (const id of reverse.get(pending.pop()!) ?? []) {
      if (!affectedIds.has(id)) {
        affectedIds.add(id);
        pending.push(id);
      }
    }
  const discoveryWarnings = ir.snapshot.diagnostics.filter(
    (d) => d.code === "L003",
  );
  const recoveredFiles = ir.snapshot.sources.filter(
    (source) => source.recovered,
  ).length;
  const primary = files.find((changed) => changed.file === file);
  return {
    schema: "pymtheg.source-edit/v1" as const,
    file,
    snapshotId: ir.snapshot.id,
    expectedSourceHash: source.hash,
    hash: primary?.hash ?? source.hash,
    text: primary?.text ?? source.text,
    edits,
    files,
    affected: [...affectedIds]
      .map((id) => ir.symbols.get(id)!)
      .filter(Boolean)
      .map((declaration) => ({
        symbolId: declaration.id,
        name: declaration.name,
        file: declaration.span.file,
      })),
    affectedComplete: discoveryWarnings.length === 0 && recoveredFiles === 0,
    notices: [
      ...(discoveryWarnings.length
        ? [
            "Caller discovery is incomplete. The affected list may omit callers. " +
              discoveryWarnings.map((d) => d.message).join("; "),
          ]
        : []),
      ...(recoveredFiles
        ? [
            `There is recovered syntax in ${recoveredFiles} source file${recoveredFiles === 1 ? "" : "s"}; the affected list may omit callers. Correct the source errors before relying on complete impact.`,
          ]
        : []),
      ...notices,
    ],
  };
}
