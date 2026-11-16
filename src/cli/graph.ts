import {
  executeGraph,
  type GraphCommand,
  type GraphResponse,
} from "../graph/commands.js";
import type { Located } from "../graph/command-locations.js";
import type { GraphLink, GraphSymbol } from "../graph/types.js";
const quote = (value: unknown) => JSON.stringify(value);
type DisplaySymbol = GraphSymbol & Partial<Located>;
function locationText(
  file: string,
  value: Partial<Located> & { range: { start: number; end: number } },
) {
  return typeof value.line === "number" && typeof value.column === "number"
    ? `${file}:${value.line}:${value.column}${typeof value.endLine === "number" && typeof value.endColumn === "number" ? `-${value.endLine}:${value.endColumn}` : ""} [UTF-16 ${value.range.start}..${value.range.end}]`
    : `${file} [UTF-16 ${value.range.start}..${value.range.end}; line unavailable]`;
}
function symbolText(symbol: DisplaySymbol) {
  return `${quote(symbol.name)}${symbol.identity !== symbol.name ? " [" + symbol.identity + "]" : ""} (${symbol.kind}) ${locationText(symbol.file, symbol)} ${symbol.id}`;
}
export function formatGraph(response: GraphResponse): string {
  const lines = [
    `Graph ${response.command}: ${response.status}${response.indexExists ? "" : " (no index)"}`,
    `${response.counts.files} files, ${response.counts.symbols} symbols, ${response.counts.links} links; ${response.counts.unresolved} unresolved, ${response.counts.ambiguous} candidate sets`,
    `Sync: ${response.sync.mode}${response.sync.durationMs === null ? "" : `; ${response.sync.durationMs.toFixed(1)} ms (observation)`}`,
  ];
  if (response.sync.report)
    lines.push(
      `Indexed ${response.sync.report.indexed}; unchanged ${response.sync.report.unchanged}; removed ${response.sync.report.removed}`,
    );
  // The opt-in toolchain route (absent when off).
  const toolchain = response.toolchain?.go;
  if (toolchain)
    lines.push(
      toolchain.state === "used"
        ? `Toolchain go: used (${toolchain.version}; ${toolchain.configuration}); ${toolchain.upgradedLinks} links upgraded, ${toolchain.verifiedSets} verified sets, ${toolchain.confirmedLinks} confirmed, ${toolchain.disagreements} disagreements; ${toolchain.packages?.clean}/${toolchain.packages?.total} packages clean${toolchain.universeClean ? "" : " (implementer sets off: a loaded package has errors)"}`
        : toolchain.state === "unavailable"
          ? `Toolchain go: unavailable, source-only links: ${toolchain.reason}`
          : "Toolchain go: on, not indexed yet",
    );
  lines.push(`Failed files (${response.failedFiles.length}):`);
  for (const file of response.failedFiles)
    lines.push(
      `  ${quote(file.path)} [${file.language ?? "context/claim"}]: ${quote(file.reason)}`,
    );
  if (response.command === "status")
    for (const module of response.modules)
      lines.push(
        `  Module ${module.id}: current ${module.version}; indexed ${module.indexedVersions.join(", ") || "none"}; ${module.files} files`,
      );
  for (const file of response.staleFiles)
    lines.push(`  Stale ${file.change}: ${quote(file.path)}`);
  for (const warning of response.warnings)
    lines.push(
      `Warning [${warning.code}]: ${warning.message}${warning.files.length ? " " + warning.files.map(quote).join(", ") : ""}`,
    );
  const data = response.data;
  const showSymbols = (items: unknown) => {
    for (const symbol of (items ?? []) as DisplaySymbol[])
      lines.push(`  ${symbolText(symbol)}`);
  };
  const showLinks = (items: unknown) => {
    for (const link of (items ?? []) as (Omit<GraphLink, "candidates"> & {
      source: DisplaySymbol | null;
      target: DisplaySymbol | null;
      certainty: string;
      decidedBy?: string;
      line: number;
      column: number;
      endLine: number;
      endColumn: number;
      candidates: (GraphLink["candidates"][number] & {
        symbol: DisplaySymbol | null;
      })[];
    })[]) {
      lines.push(
        `  ${link.certainty}${link.decidedBy === "toolchain" ? " (toolchain)" : ""} ${link.kind}: ${link.source ? symbolText(link.source) : quote(link.file)} -> ${link.target ? symbolText(link.target) : link.resolution === "ambiguous" ? "one of [" + link.candidates.map((item) => (item.symbol ? symbolText(item.symbol) : item.id)).join("; ") + "]" : quote(link.targetName)} at ${locationText(link.file, link)}`,
      );
      if (link.data !== undefined)
        lines.push(`    Stored details: ${quote(link.data)}`);
    }
  };
  if (data) {
    if (data.inputs)
      for (const input of data.inputs as {
        input: string;
        matches: DisplaySymbol[];
        nearMatches?: DisplaySymbol[];
      }[]) {
        lines.push(`Matches for ${quote(input.input)}:`);
        showSymbols(input.matches);
        if (input.nearMatches?.length) {
          lines.push("  None. Near matches (not selected):");
          showSymbols(input.nearMatches);
        }
      }
    if (data.symbol) showSymbols([data.symbol]);
    showSymbols(data.matches);
    showSymbols(data.symbols);
    showLinks(data.links);
    if (data.hasPossibleCallers !== undefined) {
      lines.push(
        `Possible callers (unresolved): ${data.hasPossibleCallers ? "present; suggestions only, not candidate sets or definite calls" : "none matched within reported bounds"}`,
      );
      if (data.classCounts)
        lines.push(
          data.countBound === undefined
            ? `Call classes (returned): ${quote(data.classCounts)}`
            : `Call classes (totals${data.countsTruncated ? `, at least; counting stops at ${String(data.countBound)}` : ""}): ${quote(data.classCounts)}`,
        );
      for (const item of (data.possibleCallers ?? []) as {
        symbol?: DisplaySymbol;
        links?: unknown[];
        matchKind?: string;
      }[]) {
        if (item.symbol)
          lines.push(
            `  Possible frontier: ${symbolText(item.symbol)} ${(item as { classCounts?: unknown }).classCounts ? quote((item as { classCounts?: unknown }).classCounts) : ""}`,
          );
        for (const link of (item.links ?? [item]) as { matchKind: string }[]) {
          lines.push(`  Possible match: ${link.matchKind}`);
          showLinks([link]);
        }
      }
      if (data.possiblePath) {
        const path = data.possiblePath as { links: unknown[] };
        lines.push("Possible call path (unresolved; not a proven path):");
        showLinks(path.links);
      }
    }
    if (
      data.possibleTraversalLinks &&
      (data.possibleTraversalLinks as unknown[]).length
    ) {
      lines.push("Traversed possible calls (unresolved; opt-in):");
      showLinks(data.possibleTraversalLinks);
    }
    if (data.callers)
      for (const item of data.callers as {
        symbol: DisplaySymbol;
        certainty: string;
        distance: number;
      }[])
        lines.push(
          `  ${item.certainty} caller at depth ${item.distance}: ${symbolText(item.symbol)}`,
        );
    if (data.found !== undefined)
      lines.push(
        `Call path: ${data.found ? data.certainty : "not found within bounds"}`,
      );
    if (data.depth !== undefined)
      lines.push(
        `Bounds: depth ${data.depth}, maximum ${data.maxNodes} nodes and ${data.maxEdges} edges; truncated ${response.truncated}`,
      );
    if (data.observedLinks && !(data.links as unknown[])?.length) {
      lines.push("Observed links (not a proven path):");
      showLinks(data.observedLinks);
    }
  }
  if (response.truncated) {
    const counts = response.resultCounts;
    lines.push(
      `Truncated: returned ${counts.matches} matches, ${counts.symbols} symbols, ${counts.links} links, ${counts.callers} callers, ${counts.observedLinks} observed links (limit ${response.limit}; traversal bounds above).`,
    );
  }
  return lines.join("\n") + "\n";
}

/** Own error rendering keeps --json failures machine-readable without changing the global CLI report. */
export async function graphCommand(
  args: string[],
  signal: AbortSignal,
): Promise<number> {
  const json = args.includes("--json");
  try {
    const positional: string[] = [];
    const values = new Map<string, string>();
    const flags = new Set<string>();
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (
        [
          "--json",
          "--no-sync",
          "--case-sensitive",
          "--include-possible",
        ].includes(arg)
      ) {
        if (flags.has(arg)) throw Error("Duplicate " + arg);
        flags.add(arg);
      } else if (["--root", "--depth", "--limit"].includes(arg)) {
        if (values.has(arg) || !args[i + 1] || args[i + 1]!.startsWith("--"))
          throw Error("Missing or duplicate " + arg);
        values.set(arg, args[++i]!);
      } else if (arg.startsWith("--"))
        throw Error("Unknown graph option " + arg);
      else positional.push(arg);
    }
    const response = await executeGraph(
      {
        command: positional[0] as GraphCommand,
        args: positional.slice(1),
        root: values.get("--root"),
        noSync: flags.has("--no-sync"),
        caseSensitive: flags.has("--case-sensitive"),
        includePossible: flags.has("--include-possible"),
        depth: values.has("--depth")
          ? Number(values.get("--depth"))
          : undefined,
        limit: values.has("--limit")
          ? Number(values.get("--limit"))
          : undefined,
      },
      {
        signal,
        progress:
          positional[0] === "index"
            ? (progress) =>
                process.stderr.write(
                  `graph ${progress.phase}${progress.module ? " " + progress.module : ""}: ${progress.done}/${progress.total}${progress.path ? " " + quote(progress.path) : ""}\n`,
                )
            : undefined,
      },
    );
    process.stdout.write(
      json ? JSON.stringify(response) + "\n" : formatGraph(response),
    );
    return response.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exitCode = signal.aborted ? 130 : 3;
    if (json)
      process.stdout.write(
        JSON.stringify({
          schema: "pymtheg.graph/v1",
          command: args[0] ?? null,
          status: "error",
          exitCode,
          error: { message },
        }) + "\n",
      );
    else process.stderr.write(`Graph error: ${message}\n`);
    return exitCode;
  }
}
