// SPDX-License-Identifier: MIT
/** `pymtheg link …`: requirement ↔ code-symbol links. Formatting only; logic is in
 * src/architecture/code-links.ts. */
import {
  checkCodeLinks,
  CodeLinkError,
  codeLinkHistory,
  codeLinkSchema,
  createCodeLink,
  createRequirement,
  failsCheck,
  listCodeLinks,
  refreshCodeLink,
  removeCodeLink,
  requirementsFor,
  unlinkedWork,
  type GraphSummary,
  type ResolvedCodeLink,
  type SymbolSummary,
} from "../architecture/code-links.js";

export const linkUsage = `pymtheg link SUBCOMMAND [--root DIRECTORY] [--json] [--no-sync]
  requirement ID --title TITLE [--text TEXT] [--kind requirement|decision|component|risk|milestone|test]
  add RECORD SELECTOR [--note TEXT]      SELECTOR as for "graph symbol": name, identity, symbol:ID, path:line[:column]
  remove LINK_ID                         LINK_ID or a unique prefix of 8+ characters
  refresh LINK_ID                        accept the current symbol of a changed/moved link
  list [--record RECORD] [--symbol SELECTOR] [--file PATH]
  check [--allow-moved]                  exit 1 if any link is missing, changed, unverifiable or moved
  touched SELECTOR | --file PATH [--impact] [--depth 5]
  unlinked [--symbols] [--limit 200]
  history
`;
const quote = (v: unknown) => JSON.stringify(v);
const usage = (message: string) => new CodeLinkError("invalid-input", message);
const where = (s: SymbolSummary) =>
  `${s.path}${s.line === null ? "" : ":" + s.line}`;
function graphLines(graph: GraphSummary | null): string[] {
  if (!graph) return [];
  const lines: string[] = [];
  if (graph.failedFiles.length)
    lines.push(
      `Failed files (${graph.failedFiles.length}): ` +
        graph.failedFiles
          .map((f) => `${quote(f.path)} (${f.reason})`)
          .join("; "),
    );
  if (graph.staleFiles.length)
    lines.push(
      `Stale files (graph not synced): ${graph.staleFiles.join(", ")}`,
    );
  return lines;
}
function linkLines(r: ResolvedCodeLink): string[] {
  const s = r.link.symbol;
  const lines = [
    `${r.state.toUpperCase().padEnd(12)} ${r.link.id.slice(0, 8)} ${r.link.record}${r.recordPresent ? "" : " (record no longer exists)"} -> ${s.language} ${s.kind} ${s.identity} ${s.path}`,
  ];
  if (r.state !== "ok") lines.push(`  ${r.message}`);
  if (r.current && r.state !== "ok")
    lines.push(`  now: ${r.current.identity} at ${where(r.current)}`);
  for (const sug of r.suggestions)
    lines.push(
      `  suggestion: ${sug.kind} ${sug.identity} at ${where(sug)} ${sug.graphId} (${sug.reason})`,
    );
  return lines;
}

export async function linkCommand(
  args: string[],
  signal: AbortSignal,
): Promise<number> {
  const json = args.includes("--json");
  const sub = args[0] ?? "";
  try {
    const positional: string[] = [];
    const values = new Map<string, string>();
    const flags = new Set<string>();
    const valueOptions = [
      "--root",
      "--title",
      "--text",
      "--kind",
      "--note",
      "--record",
      "--symbol",
      "--file",
      "--depth",
      "--limit",
    ];
    for (let i = 1; i < args.length; i++) {
      const arg = args[i]!;
      if (
        [
          "--json",
          "--no-sync",
          "--impact",
          "--symbols",
          "--allow-moved",
        ].includes(arg)
      ) {
        if (flags.has(arg)) throw usage("Duplicate " + arg);
        flags.add(arg);
      } else if (valueOptions.includes(arg)) {
        if (values.has(arg) || args[i + 1] === undefined)
          throw usage("Missing or duplicate " + arg);
        values.set(arg, args[++i]!);
      } else if (arg.startsWith("--"))
        throw usage("Unknown link option " + arg);
      else positional.push(arg);
    }
    const common = {
      ...(values.has("--root") ? { root: values.get("--root")! } : {}),
      noSync: flags.has("--no-sync"),
      signal,
    };
    const arity = (n: number) => {
      if (positional.length !== n)
        throw usage(`link ${sub} takes ${n} argument${n === 1 ? "" : "s"}`);
    };
    const number = (name: string) => {
      if (!values.has(name)) return undefined;
      const v = Number(values.get(name));
      if (!Number.isInteger(v)) throw usage(name + " must be an integer");
      return v;
    };
    let out: { exitCode: number; text: string[]; data: object };
    if (sub === "requirement") {
      arity(1);
      if (!values.get("--title")?.trim()) throw usage("--title is required");
      const kind = values.get("--kind") as
        | "requirement"
        | "decision"
        | "component"
        | "risk"
        | "milestone"
        | "test"
        | undefined;
      const result = await createRequirement({
        ...common,
        id: positional[0]!,
        title: values.get("--title")!,
        ...(values.has("--text") ? { text: values.get("--text")! } : {}),
        ...(kind ? { kind } : {}),
      });
      out = {
        exitCode: 0,
        data: result,
        text: [
          `Created ${result.record.kind} ${result.record.id} “${result.record.title}” in ${result.record.document} (checkpoint ${result.checkpoint.slice(0, 12)}).`,
        ],
      };
    } else if (sub === "add") {
      arity(2);
      const result = await createCodeLink({
        ...common,
        record: positional[0]!,
        selector: positional[1]!,
        ...(values.has("--note") ? { note: values.get("--note")! } : {}),
      });
      const text = [result.message];
      if (result.link) text.push(`Link ID: ${result.link.id}`);
      for (const m of result.matches)
        text.push(
          `  match: ${m.kind} ${m.identity} at ${where(m)} ${m.graphId}`,
        );
      for (const r of result.records)
        text.push(`  record: ${r.id} “${r.title}”`);
      text.push(...graphLines(result.graph));
      out = {
        exitCode: ["created", "already-linked"].includes(result.status) ? 0 : 1,
        data: result,
        text,
      };
    } else if (sub === "remove") {
      arity(1);
      const result = await removeCodeLink({ ...common, link: positional[0]! });
      out = {
        exitCode: 0,
        data: result,
        text: [
          `Removed link ${result.link.id} (${result.link.record} -> ${result.link.symbol.identity}).`,
        ],
      };
    } else if (sub === "refresh") {
      arity(1);
      const result = await refreshCodeLink({ ...common, link: positional[0]! });
      out = {
        exitCode: result.status === "refused" ? 1 : 0,
        data: result,
        text: [result.message],
      };
    } else if (sub === "list" || sub === "check") {
      arity(0);
      const result =
        sub === "check"
          ? await checkCodeLinks({
              ...common,
              allowMoved: flags.has("--allow-moved"),
            })
          : await listCodeLinks({
              ...common,
              ...(values.has("--record")
                ? { record: values.get("--record")! }
                : {}),
              ...(values.has("--symbol")
                ? { symbol: values.get("--symbol")! }
                : {}),
              ...(values.has("--file") ? { file: values.get("--file")! } : {}),
            });
      const c = result.counts;
      const text = [
        `${result.links.length} code link${result.links.length === 1 ? "" : "s"}: ${c.ok} ok, ${c.changed} changed, ${c.moved} moved, ${c.missing} missing, ${c.unverifiable} unverifiable`,
        ...result.links.flatMap(linkLines),
        ...graphLines(result.graph),
      ];
      const failing = result.links.filter((r) =>
        failsCheck(r, flags.has("--allow-moved")),
      ).length;
      if (sub === "check")
        text.push(
          failing
            ? `Check failed: ${failing} link${failing === 1 ? " needs" : "s need"} attention.`
            : "Check passed.",
        );
      out = {
        exitCode: sub === "check" && failing ? 1 : 0,
        data: result,
        text,
      };
    } else if (sub === "touched") {
      if (
        positional.length > 1 ||
        (positional.length === 1) === values.has("--file")
      )
        throw usage("link touched takes one SELECTOR or --file PATH");
      const depth = number("--depth");
      const result = await requirementsFor({
        ...common,
        ...(positional.length
          ? { symbol: positional[0]! }
          : { file: values.get("--file")! }),
        impact: flags.has("--impact"),
        ...(depth === undefined ? {} : { depth }),
      });
      const text = [
        `${result.records.length} planning record${result.records.length === 1 ? "" : "s"} touched${result.records.length ? ": " + result.records.join(", ") : ""}`,
        ...result.touched.map(
          (t) =>
            `  ${t.record}${t.title ? ` “${t.title}”` : ""} via ${t.via}${t.via === "caller" ? ` (distance ${t.distance})` : ""}: ${t.symbol.identity} [${t.state}] link ${t.link.slice(0, 8)}`,
        ),
      ];
      if (result.impactIncomplete) {
        text.push(
          "Impact may be incomplete (bounds, candidate or unresolved calls)." +
            (result.impactNotes.length
              ? " " + result.impactNotes.join(" ")
              : ""),
        );
        if (result.notFollowedCount)
          text.push(
            `Callers not followed (${result.notFollowedCount}${result.notFollowedCount > result.notFollowed.length ? `, first ${result.notFollowed.length} shown` : ""}):`,
            ...result.notFollowed.map(
              (c) =>
                `  ${c.certainty} ${c.identity} at ${c.path}${c.line === null ? "" : ":" + c.line}`,
            ),
          );
      }
      text.push(...graphLines(result.graph));
      out = { exitCode: 0, data: result, text };
    } else if (sub === "unlinked") {
      arity(0);
      const limit = number("--limit");
      const result = await unlinkedWork({
        ...common,
        symbols: flags.has("--symbols"),
        ...(limit === undefined ? {} : { limit }),
      });
      const text = [
        `Requirements with no code link (${result.requirements.length}):`,
        ...result.requirements.map((r) => `  ${r.id} “${r.title}”`),
      ];
      if (result.symbols) {
        text.push(
          `Public symbols with no link (${result.symbols.length}${result.symbolsTruncated ? ", truncated" : ""}):`,
          ...result.symbols.map(
            (s) => `  ${s.language} ${s.kind} ${s.identity} at ${where(s)}`,
          ),
          `Rule: ${result.publicRule}`,
        );
        text.push(...graphLines(result.graph));
      }
      out = { exitCode: 0, data: result, text };
    } else if (sub === "history") {
      arity(0);
      const result = await codeLinkHistory(common);
      out = {
        exitCode: 0,
        data: result,
        text: [
          `${result.entries.length} recorded code-link change${result.entries.length === 1 ? "" : "s"}:`,
          ...result.entries.map(
            (e) =>
              `  #${e.sequence} ${e.time} ${e.author}: ${e.change} ${e.link.slice(0, 8)}${e.previous ? ` (previously ${e.previous.slice(0, 8)})` : ""} ${e.record} -> ${e.symbol.identity} ${e.symbol.path}`,
          ),
        ],
      };
    } else throw usage(`Unknown link subcommand ${quote(sub)}.\n${linkUsage}`);
    process.stdout.write(
      json
        ? JSON.stringify({
            ...out.data,
            command: sub,
            exitCode: out.exitCode,
          }) + "\n"
        : out.text.join("\n") + "\n",
    );
    return out.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error instanceof CodeLinkError
        ? error.code
        : signal.aborted
          ? "cancelled"
          : "error";
    const exitCode = signal.aborted ? 130 : 3;
    if (json)
      process.stdout.write(
        JSON.stringify({
          schema: codeLinkSchema,
          command: sub || null,
          status: "error",
          exitCode,
          error: { code, message },
        }) + "\n",
      );
    else process.stderr.write(`Link error [${code}]: ${message}\n`);
    return exitCode;
  }
}
