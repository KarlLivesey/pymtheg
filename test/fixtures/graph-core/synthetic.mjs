// Shared deterministic workload for operation-count tests and timing observations.
export const module = {
  id: "synthetic",
  version: "1",
  extensions: [".syn"],
  parse({ path, text }) {
    const symbols = Array.from({ length: 10 }, (_, i) => ({
      key: String(i),
      name: `${path}:${i}`,
      identity: String(i),
      kind: "function",
      range: { start: 0, end: text.length },
    }));
    return {
      status: "clean",
      diagnostics: [],
      symbols,
      links: symbols.map((s) => ({
        sourceKey: s.key,
        kind: "calls",
        targetName: s.name,
        range: s.range,
      })),
    };
  },
  resolve({ symbols, links }) {
    const named = new Map(symbols.map((s) => [s.name, s.id]));
    const byFile = new Map();
    for (const symbol of symbols) {
      const group = byFile.get(symbol.file) ?? [];
      group.push(symbol.id);
      byFile.set(symbol.file, group);
    }
    return {
      resolutions: links.map((l) => ({
        linkId: l.id,
        targetId: named.get(l.targetName) ?? null,
      })),
      links: symbols.flatMap((s) => [
        {
          key: `definite:${s.key}`,
          file: s.file,
          sourceId: s.id,
          kind: "derived-definite",
          targetName: s.name,
          range: s.range,
          targetId: s.id,
        },
        {
          key: `candidate:${s.key}`,
          file: s.file,
          sourceId: s.id,
          kind: "derived-candidate",
          targetName: "choice",
          range: s.range,
          candidateIds: byFile.get(s.file).slice(0, 3),
        },
      ]),
    };
  },
};
