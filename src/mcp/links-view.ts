/** Bounded presentation only: all resolution and mutation stays in code-links. */
export const linkSections = [
  "items",
  "matches",
  "failed_files",
  "not_followed",
  "symbols",
] as const;
export type LinkSection = (typeof linkSections)[number];
type Row = Record<string, any>;
export interface LinkView {
  summary: Row;
  tables: Record<LinkSection, Row[]>;
}
export function makeLinkView(
  action: string,
  result: Row,
  input: Row = {},
): LinkView {
  let clippedText = false;
  const preview = (value: unknown, max = 1200) => {
    const s = String(value ?? "");
    if (s.length > max) {
      clippedText = true;
      let end = max - 16;
      if (
        /[\uD800-\uDBFF]/.test(s[end - 1] ?? "") &&
        /[\uDC00-\uDFFF]/.test(s[end] ?? "")
      )
        end--;
      return s.slice(0, end) + "… [truncated]";
    }
    return s;
  };
  const symbol = (s: Row | null | undefined) =>
    s
      ? {
          ref: s.graphId ?? null,
          language: s.language,
          path: s.path,
          kind: s.kind,
          identity: preview(s.identity),
          name: preview(s.name),
          line: s.line ?? null,
          ...(s.reason ? { reason: preview(s.reason) } : {}),
        }
      : null;
  const stored = (s: Row) => ({
    id: s.id,
    record: s.record,
    symbol: symbol({
      ...s.symbol,
      graphId: s.hint?.graphId,
      line: s.hint?.line,
    }),
    removed: s.removed,
  });
  const resolved = (r: Row) => ({
    ...stored(r.link),
    state: r.state,
    recordPresent: r.recordPresent,
    current: symbol(r.current),
    differs: r.differs,
    suggestions: r.suggestions.map(symbol),
    suggestionsBound: 20,
    unverifiableFile: r.unverifiableFile,
    mayBeHiddenBy: r.mayBeHiddenBy.slice(0, 20),
    hiddenFileCount: r.mayBeHiddenBy.length,
    message: preview(r.message),
    next:
      r.state === "ok"
        ? "No refresh needed."
        : r.state === "moved" || r.state === "changed"
          ? "Review current code, then explicitly refresh this link if accepted."
          : "Inspect named files/suggestions; repair code or explicitly remove and add the intended symbol. Suggestions are never applied.",
  });

  const tables: LinkView["tables"] = {
    items: [],
    matches: [],
    failed_files: [],
    not_followed: [],
    symbols: [],
  };
  const graph = result.graph;
  const verificationComplete =
    !graph ||
    (graph.complete &&
      !graph.failedFiles.length &&
      !graph.staleFiles.length &&
      !graph.warnings.length);
  const summary: Row = {
    action,
    status:
      result.status ??
      (action === "check"
        ? result.passed && verificationComplete
          ? "ok"
          : "needs-attention"
        : "complete"),
    counts: result.counts ?? null,
    passed: action === "check" ? result.passed && verificationComplete : null,
    libraryPassed: result.passed ?? null,
    allowMoved: result.allowMoved ?? false,
    failingCount: result.failing?.length ?? 0,
    orphanedCount: result.orphaned?.length ?? 0,
    verificationComplete,
    graph: graph
      ? {
          complete: graph.complete,
          syncMode: graph.syncMode,
          failedFileCount: graph.failedFiles.length,
          staleFiles: graph.staleFiles.slice(0, 20),
          staleFileCount: graph.staleFiles.length,
          warnings: graph.warnings.map((w: string) => preview(w)).slice(0, 20),
        }
      : null,
    impactIncomplete: result.impactIncomplete ?? false,
    impactNotes: (result.impactNotes ?? [])
      .map((s: string) => preview(s))
      .slice(0, 20),
    notFollowedCount: result.notFollowedCount ?? 0,
    sourceTruncated: result.symbolsTruncated ?? false,
    message: preview(
      result.message ??
        (action === "check" && !verificationComplete
          ? "Links could not all be verified. Inspect failed/stale files and warnings; do not treat this as all good."
          : ""),
    ),
    publicRule: result.publicRule ?? null,
  };
  tables.failed_files = (graph?.failedFiles ?? []).map((f: Row) => ({
    ...f,
    reason: preview(f.reason),
  }));
  const selectedInputs = [input.file, input.selector, input.symbol].filter(
    (v): v is string => typeof v === "string",
  );
  const isSelected = (path: string) =>
    selectedInputs.some(
      (value) =>
        value === path ||
        (value.startsWith(path + ":") &&
          /^\d+(?::\d+)?$/.test(value.slice(path.length + 1))),
    );
  tables.failed_files.sort(
    (a, b) => Number(isSelected(b.path)) - Number(isSelected(a.path)),
  );
  if (result.links)
    tables.items = [...result.links]
      .sort(
        (a: Row, b: Row) =>
          Number(b.state !== "ok" || !b.recordPresent) -
          Number(a.state !== "ok" || !a.recordPresent),
      )
      .map(resolved);
  else if (result.touched)
    tables.items = result.touched.map((t: Row) => ({
      ...t,
      title: preview(t.title),
      symbol: symbol(t.symbol),
    }));
  else if (result.entries)
    tables.items = result.entries.map((e: Row) => ({
      ...e,
      symbol: symbol(e.symbol),
    }));
  else if (result.requirements)
    tables.items = result.requirements.map((r: Row) => ({
      ...r,
      title: preview(r.title),
      type: "requirement",
    }));
  else if (action === "requirement")
    tables.items = [{ ...result.record, checkpoint: result.checkpoint }];
  else if (result.link)
    tables.items = [
      {
        ...stored(result.link),
        ...(result.before ? { before: resolved(result.before) } : {}),
      },
    ];
  tables.matches = (
    result.matches?.length
      ? result.matches
      : Array.isArray(result.records) && typeof result.records[0] === "object"
        ? result.records
        : []
  ).map((s: Row) =>
    s.graphId ? symbol(s)! : { ...s, title: preview(s.title) },
  );
  tables.symbols = (result.symbols ?? []).map((s: Row) => symbol(s)!);
  tables.not_followed = (result.notFollowed ?? []).map((s: Row) => ({
    ...symbol(s),
    certainty: s.certainty,
  }));
  if (!tables.items.length && tables.matches.length) {
    tables.items = tables.matches.map((row) => ({
      ...row,
      type: row.ref ? "selector-match" : "record-match",
    }));
  }
  if (action === "unlinked" && result.symbols) {
    tables.items.push(
      ...tables.symbols.map((row) => ({ ...row, type: "public-symbol" })),
    );
  }
  summary.textClipped = clippedText;
  summary.sourceTruncated ||=
    (result.notFollowedCount ?? 0) > tables.not_followed.length ||
    (result.links ?? []).some(
      (r: Row) => r.suggestions.length >= 20 || r.mayBeHiddenBy.length > 20,
    );
  summary.totals = Object.fromEntries(
    Object.entries(tables).map(([k, v]) => [k, v.length]),
  );
  return { summary, tables };
}
