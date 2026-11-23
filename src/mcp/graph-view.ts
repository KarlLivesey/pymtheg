// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import type { GraphResponse } from "../graph/commands.js";
import {
  macroScopeAssumption,
  macroScopeAssumptionText,
} from "../graph/languages/rust/macro-scope.js";
import {
  unbuiltEntryAssumption,
  unbuiltEntryAssumptionText,
} from "../graph/languages/typescript/entry-build.js";
import { textPage } from "./text-pages.js";

const assumptionDescriptions = new Map([
  [macroScopeAssumption, macroScopeAssumptionText],
  [unbuiltEntryAssumption, unbuiltEntryAssumptionText],
]);

const record = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {};
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const clip = (v: unknown, size = 200) => {
  const text = String(v ?? "");
  let end = size;
  if (
    end > 0 &&
    /[\uD800-\uDBFF]/.test(text[end - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(text[end] ?? "")
  )
    end--;
  return text.length <= size ? text : text.slice(0, end) + "… [see detail]";
};
export const graphSections = [
  "answer",
  "symbols",
  "links",
  "possible_callers",
  "frontiers",
  "candidates",
  "failed_files",
  "stale_files",
  "warnings",
  "modules",
  "legend",
  "detail",
] as const;
export type GraphSection = (typeof graphSections)[number];
/** A projection of command facts only: no resolution, selection or traversal here. */
export class GraphView {
  readonly tables: Record<string, Record<string, unknown>[]> = {};
  readonly details = new Map<string, string>();
  readonly summary: Record<string, unknown>;
  private readonly reasonCodes = new Map<string, string>();
  private readonly symbols = new Map<string, Record<string, unknown>>();
  private readonly linkRows = new Map<string, Record<string, unknown>>();
  constructor(response: GraphResponse) {
    for (const name of graphSections) this.tables[name] = [];
    const symbol = (input: unknown): string | null => {
      const s = record(input);
      if (typeof s.id !== "string") return null;
      if (!this.symbols.has(s.id)) {
        this.details.set(s.id, JSON.stringify(s));
        const row = {
          ref: s.id,
          name: clip(s.name),
          qualifiedName: clip(s.identity),
          kind: s.kind,
          language: s.module,
          status: s.status,
          ...this.location(s),
        };
        this.symbols.set(s.id, row);
        this.tables.symbols!.push(row);
      }
      return s.id;
    };
    const link = (input: unknown) => {
      const l = record(input);
      if (typeof l.id !== "string") return null;
      if (!this.linkRows.has(l.id)) {
        this.details.set(l.id, JSON.stringify(l));
        const row = {
          ref: l.id,
          kind: l.kind,
          certainty: l.certainty,
          ...(l.decidedBy ? { decidedBy: l.decidedBy } : {}),
          sourceStatus: l.sourceStatus,
          targetStatus: l.targetStatus,
          source: symbol(l.source),
          target: symbol(l.target),
          targetName: clip(l.targetName),
          ...this.location(l),
          reasons: this.reasons(l.data),
          // A definite library link has a target, not candidates.
          candidateCount:
            l.certainty === "library"
              ? 0
              : list(l.candidates).length + list(l.libraries).length,
          // Library targets are outside this project, never local symbols.
          ...(l.certainty === "library"
            ? { library: this.library(list(l.libraries)[0]) }
            : {}),
          detailRef: l.id,
        };
        this.linkRows.set(l.id, row);
        for (const c of list(l.candidates))
          this.tables.candidates!.push({
            link: l.id,
            symbol: symbol(c.symbol) ?? c.id,
            status: c.status,
          });
        if (l.certainty !== "library")
          for (const c of list(l.libraries))
            this.tables.candidates!.push({
              link: l.id,
              library: this.library(c),
            });
      }
      return this.linkRows.get(l.id)!;
    };
    const data = record(response.data);
    const answer: Record<string, unknown>[] = [];
    if (data.library) {
      const library = record(data.library);
      answer.push({
        type: "library",
        unit: clip(library.unit),
        ...(library.symbol === undefined
          ? {}
          : { symbol: clip(library.symbol) }),
        place: "outside-project",
      });
    }
    if (data.symbol)
      answer.push({ type: "selected", ref: symbol(data.symbol) });
    if (data.from) answer.push({ type: "from", ref: symbol(data.from) });
    if (data.to) answer.push({ type: "to", ref: symbol(data.to) });
    for (const s of list(data.matches))
      answer.push({ type: "match", ref: symbol(s) });
    for (const s of list(data.symbols))
      answer.push({ type: "symbol", ref: symbol(s) });
    for (const input of list(data.inputs)) {
      for (const s of list(input.matches))
        answer.push({
          type: "selection",
          input: clip(input.input),
          ref: symbol(s),
          ambiguous: list(input.matches).length !== 1 || !!input.truncated,
          truncated: input.truncated,
        });
      // Suggestions for a selector that selected nothing; never selected.
      for (const s of list(input.nearMatches))
        answer.push({
          type: "near-match",
          input: clip(input.input),
          ref: symbol(s),
        });
    }
    const regular = new Set<string>();
    for (const l of [
      ...list(data.links),
      ...list(data.observedLinks),
      ...list(data.possibleTraversalLinks),
      ...list(record(data.possiblePath).links),
    ]) {
      const row = link(l);
      if (row && !regular.has(String(row.ref))) {
        regular.add(String(row.ref));
        this.tables.links!.push(row);
      }
    }
    for (const s of list(record(data.possiblePath).symbols)) symbol(s);
    for (const c of list(data.callers))
      answer.push({
        type: "impact",
        ref: symbol(c.symbol),
        certainty: c.certainty,
        distance: c.distance,
      });
    for (const group of list(data.possibleCallers)) {
      const frontier = group.symbol
        ? symbol(group.symbol)
        : symbol(data.symbol);
      if (group.links)
        this.tables.frontiers!.push({
          symbol: frontier,
          distance: group.distance,
          classCounts: group.classCounts,
          truncated: group.truncated,
        });
      for (const l of group.links ?? [group]) {
        const row = link(l);
        if (row)
          this.tables.possible_callers!.push({
            ...row,
            frontier,
            matchKind: l.matchKind,
          });
      }
    }
    this.tables.answer = answer.map((row) => ({
      ...this.symbols.get(String(row.ref)),
      ...row,
    }));
    const requested = [
      data.path,
      record(data.symbol).file,
      record(data.from).file,
      record(data.to).file,
      ...list(data.inputs).map((i) => i.input),
    ].filter((v): v is string => typeof v === "string");
    const priority = (path: string) => {
      const index = requested.findIndex(
        (input) =>
          input === path ||
          (input.startsWith(path + ":") &&
            /^\d+(?::\d+)?$/.test(input.slice(path.length + 1))),
      );
      return index < 0 ? Infinity : index;
    };
    const failedFiles = [...response.failedFiles].sort(
      (a, b) => priority(a.path) - priority(b.path),
    );
    this.tables.failed_files = failedFiles.map((f, i) => ({
      path: f.path,
      language: f.language,
      reasons: this.reasons({ reason: f.reason }),
      detailRef: this.detail(`failure:${i}`, f),
      range: f.range,
    }));
    this.tables.stale_files = response.staleFiles.map((f) => ({ ...f }));
    this.tables.warnings = response.warnings.map((w, i) => ({
      code: w.code,
      message: clip(w.message, 400),
      fileCount: w.files.length,
      detailRef: this.detail(`warning:${i}`, w),
    }));
    this.tables.modules = response.modules;
    const pick = [
      "found",
      "certainty",
      "hasPossibleCallers",
      "classCounts",
      "countsTruncated",
      "countBound",
      "depth",
      "maxNodes",
      "maxEdges",
      "maxPossibleLinks",
      "visited",
      "possibleBounds",
      "includePossible",
      "caseSensitive",
      "caseFolding",
    ];
    const query = Object.fromEntries(
      pick.filter((k) => data[k] !== undefined).map((k) => [k, data[k]]),
    );
    if (data.inputs)
      query.inputs = list(data.inputs).map((input) => ({
        input: clip(input.input),
        matches: list(input.matches).length,
        truncated: input.truncated,
        totalAtLeast: input.totalAtLeast,
        ...(list(input.nearMatches).length
          ? {
              nearMatches: list(input.nearMatches).map((s) =>
                clip(record(s).identity),
              ),
              nearMatchMeaning:
                "Nothing was selected. These symbols have a similar name; select one by its qualifiedName or ref.",
            }
          : {}),
      }));
    if (data.possiblePath)
      query.possiblePath = {
        certainty: record(data.possiblePath).certainty,
        symbols: list(record(data.possiblePath).symbols).map(symbol),
        links: list(record(data.possiblePath).links).map((l) => record(l).id),
      };
    const toolchain = response.toolchain;
    const toolchainClipped =
      toolchain && Buffer.byteLength(JSON.stringify(toolchain)) > 4096;
    const toolchainView = toolchainClipped
      ? {
          setting: toolchain.setting,
          go: {
            state: toolchain.go.state,
            reason: clip(toolchain.go.reason, 400),
            errorCount: toolchain.go.errors?.length ?? 0,
          },
          detailRef: this.detail("toolchain", toolchain),
        }
      : (toolchain ?? null);
    this.summary = {
      command: response.command,
      toolchain: toolchainView,
      toolchainTruncated: !!toolchainClipped,
      // D22: the trust that applies on this machine, and how to answer it.
      ...(response.trust ? { trust: response.trust } : {}),
      ...(response.trustAnswer ? { trustAnswer: response.trustAnswer } : {}),
      status: response.status,
      exitCode: response.exitCode,
      indexExists: response.indexExists,
      sync: {
        mode: response.sync.mode,
        complete: response.sync.complete,
        reportRef: response.sync.report
          ? this.detail("sync-report", response.sync.report)
          : null,
      },
      counts: response.counts,
      failedFileCount: response.failedFiles.length,
      staleFileCount: response.staleFiles.length,
      warnings: response.warnings.map((w) => w.code),
      truncated: response.truncated,
      query,
      resultCounts: response.resultCounts,
      coreLimit: response.limit,
      sectionCounts: {
        ...Object.fromEntries(
          Object.entries(this.tables).map(([k, v]) => [k, v.length]),
        ),
        detail: this.details.size,
      },
      locationBasis:
        "indexed snapshot; 1-based UTF-16 columns; current files may differ when stale",
      next: "Repair named failed files first. If the index is absent/incomplete, start code_graph index (or a query with noSync:false) and await completion. Read named sections with graph_result; follow nextOffset. Candidate membership is in candidates (filter ref=link ref). Narrow code_graph selectors/limit/depth if core truncated; pages do not recover core omissions.",
    };
  }
  /** A library target: unit and symbol outside this project, clipped. */
  private library(value: unknown) {
    const l = record(value);
    return {
      ref: l.id,
      ecosystem: l.ecosystem,
      unit: clip(l.unit),
      ...(l.symbol === undefined ? {} : { symbol: clip(l.symbol) }),
      ...(l.version === undefined
        ? {}
        : { version: clip(l.version), versionSource: clip(l.versionSource) }),
      evidence: l.evidence,
      place: "outside-project",
    };
  }
  private detail(ref: string, value: unknown) {
    this.details.set(ref, JSON.stringify(value));
    return ref;
  }
  private location(s: Record<string, any>) {
    return {
      file: s.file,
      at: typeof s.line === "number" ? `${s.file}:${s.line}:${s.column}` : null,
      line: s.line,
      column: s.column,
      endLine: s.endLine,
      endColumn: s.endColumn,
      range: s.range,
    };
  }
  private reasons(value: unknown) {
    const data = record(value);
    const codes = [];
    for (const field of [
      "reason",
      "uncertainty",
      "open",
      "overflow",
      "opaqueAttributes",
      "reasons",
      "assumes",
      "conditions",
      "cause",
    ]) {
      if (data[field] === undefined) continue;
      for (const v of Array.isArray(data[field])
        ? data[field]
        : [data[field]]) {
        const key = JSON.stringify([field, v]);
        let code = this.reasonCodes.get(key);
        if (!code) {
          code = `r${this.reasonCodes.size + 1}`;
          this.reasonCodes.set(key, code);
          const description =
            field === "assumes" && typeof v === "string"
              ? assumptionDescriptions.get(v)
              : undefined;
          this.tables.legend!.push({
            code,
            field,
            value: clip(typeof v === "string" ? v : JSON.stringify(v), 400),
            ...(description ? { description } : {}),
            detailRef: this.detail(code, {
              field,
              value: v,
              ...(description ? { description } : {}),
            }),
          });
        }
        codes.push(code);
      }
    }
    return codes;
  }
  bytes() {
    // Count rows independently: a retention check must not build a graph-sized string.
    // Include conservative framing overhead and escaped detail strings.
    let bytes = 1024 + Buffer.byteLength(JSON.stringify(this.summary));
    for (const [name, rows] of Object.entries(this.tables)) {
      bytes += Buffer.byteLength(name) + 8;
      for (const row of rows)
        bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
    }
    for (const entry of this.details)
      bytes += Buffer.byteLength(JSON.stringify(entry)) + 1;
    return bytes;
  }
  page(section: GraphSection, offset: number, limit: number, ref?: string) {
    if (section === "detail") {
      const text = this.details.get(ref ?? "");
      if (text === undefined)
        throw Error(
          "Unknown detail ref. Use a ref/detailRef from this job's pages.",
        );
      return {
        ...textPage(text, offset, Math.min(limit, 16384)),
        ref,
        totalCharacters: text.length,
        contentHash: createHash("sha256").update(text).digest("hex"),
      };
    }
    const all = this.tables[section]!.filter(
      (r) =>
        !ref ||
        r.link === ref ||
        r.frontier === ref ||
        r.symbol === ref ||
        r.ref === ref ||
        r.code === ref,
    );
    if (offset > all.length)
      throw Error("Offset exceeds this section; use nextOffset.");
    const items = [];
    let bytes = 0;
    for (const row of all.slice(offset, offset + limit)) {
      const size = Buffer.byteLength(JSON.stringify(row));
      if (bytes + size > 24576) break;
      items.push(row);
      bytes += size;
    }
    if (!items.length && offset < all.length)
      throw Error(
        "One item exceeds the compact page budget; use section detail with its ref or narrow the query.",
      );
    return {
      section,
      ref: ref ?? null,
      items,
      total: all.length,
      offset,
      nextOffset:
        offset + items.length < all.length ? offset + items.length : null,
      pageLimited: items.length < Math.min(limit, all.length - offset),
    };
  }
}
