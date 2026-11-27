// SPDX-License-Identifier: MIT
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTagsParser } from "../../tree-sitter.js";
import type {
  AnalyzedFile,
  Diagnostic,
  Json,
  LanguageModule,
  ParseResult,
  ScopedAnalysis,
  SourceInput,
} from "../../types.js";
import { count, stage } from "../../work.js";
import { GoExtractor } from "./extract.js";
import { syntaxFailure } from "./failure.js";
import { directoryOf, importPathOf, readLayout } from "./gomod.js";
import { affectedFiles, surface } from "./incremental.js";
import type { FileFact } from "./model.js";
import { linkNotes, resolveGo } from "./resolve.js";
import { installation, runHelper } from "./toolchain.js";
import {
  factFor,
  fileStatus,
  parseFacts,
  type ToolchainFacts,
} from "./toolchain-facts.js";

const ID = "go";
/** Key of the one package symbol hosted per directory package (added by analyze). */
const PACKAGE_KEY = "package";

/**
 * The vendored, patched grammar (grammars/go: upstream v0.25.0 + PRs #202 and
 * #198, see its manifest.json and docs/changes/W2-S.md). Resolved from this
 * file so it works from dist/ and from the installed package alike.
 */
const GRAMMAR = fileURLToPath(
  new URL("../../../../grammars/go/tree-sitter-go.wasm", import.meta.url),
);

type Helper = { parse(text: string): ParseResult };
let helper: Promise<Helper> | undefined;
let pending: SourceInput | undefined;

/**
 * One reusable Tree-sitter parser for the process. The query is minimal; the
 * extraction walks the whole borrowed tree in the helper's second pass.
 */
function parser(): Promise<Helper> {
  helper ??= (async () => {
    return createTagsParser({
      wasmPath: GRAMMAR,
      query: "(package_clause) @package",
      secondPass({ tree, result }) {
        const source = pending!;
        // A file that cannot be read is not valid code: it has failed and
        // contributes nothing (see W2-B.md, "Failed files").
        const fail = (diagnostic: Diagnostic) => {
          result.status = "failed";
          result.symbols = [];
          result.links = [];
          result.diagnostics = [diagnostic];
          delete result.data;
        };
        const failure = syntaxFailure(tree.rootNode, source.text);
        if (failure) return fail(failure);
        const extractor = new GoExtractor(source.path, source.text);
        extractor.run(tree.rootNode);
        if (extractor.truncated) return fail(extractor.truncated);
        result.status = "clean";
        result.symbols = extractor.symbols;
        result.links = extractor.links;
        result.diagnostics = [...extractor.diagnostics];
        result.data = {
          go: extractor.fact as unknown as Json,
          surface: surface(result, extractor.fact),
        };
      },
    });
  })().catch((error: unknown) => {
    helper = undefined;
    throw error;
  });
  return helper;
}

async function parse(source: SourceInput): Promise<ParseResult> {
  const tags = await parser();
  pending = source;
  try {
    return tags.parse(source.text);
  } finally {
    pending = undefined;
  }
}

/**
 * Hosts ONE `package` symbol per (directory, package name) in a deterministic
 * file: the first non-test, clean file by path, else the first file by path.
 * Other files' facts are returned unchanged (omitted).
 */
/**
 * The opt-in toolchain route's facts for this snapshot (W3-L), or undefined
 * with a report note saying why they are not available. Source-only links
 * stand wherever there is no fact.
 */
async function toolchainFacts(
  request: NonNullable<
    Parameters<NonNullable<LanguageModule["analyze"]>>[0]["toolchain"]
  >,
  files: Parameters<NonNullable<LanguageModule["analyze"]>>[0]["files"],
  contextFiles: Parameters<
    NonNullable<LanguageModule["analyze"]>
  >[0]["contextFiles"],
): Promise<ToolchainFacts | undefined> {
  const unavailable = (reason: string) => {
    request.note({ status: "unavailable", reason });
    return undefined;
  };
  if (!contextFiles.some((file) => file.path === "go.mod"))
    return unavailable("no go.mod at the project root");
  if (contextFiles.some((file) => file.path === "go.work"))
    return unavailable("go.work workspaces are not supported yet");
  const workDir = resolve(request.workDir, "go");
  const install = await installation(
    request.setting,
    request.environment,
    workDir,
    request.signal,
  );
  if ("unavailable" in install) return unavailable(install.unavailable);
  const sources = files
    .filter((file) => file.path.endsWith(".go"))
    .map((file) => ({ path: file.path, text: file.text, hash: file.hash }));
  // An absolute, symlink-free root: go reports file paths under it, and the
  // overlay of the snapshot's files is keyed by the same paths.
  let root: string;
  try {
    root = await realpath(resolve(request.root));
  } catch {
    return unavailable(`the project root ${request.root} cannot be read`);
  }
  const run = await runHelper(root, install, sources, workDir, request.signal);
  if ("unavailable" in run) return unavailable(run.unavailable);
  const facts = parseFacts(
    run.output,
    new Map(files.map((file) => [file.path, file.text])),
  );
  // The configuration as the installation reports it, on every record.
  facts.configuration = install.configuration;
  if (facts.listFailed)
    return unavailable(`go list failed: ${facts.errors[0] ?? "no output"}`);
  request.note({
    status: "available",
    go: install.go,
    version: facts.goVersion,
    configuration: install.configuration,
    cached: run.cached,
    key: run.key,
    // An observation only; nothing depends on it.
    helperMs: Math.round(run.elapsedMs),
    packages: facts.packages,
    universeClean: facts.universe,
    errors: facts.errors.slice(0, 20),
  });
  return facts;
}

async function analyze(
  context: Parameters<NonNullable<LanguageModule["analyze"]>>[0],
): Promise<AnalyzedFile[] | ScopedAnalysis> {
  const { files, contextFiles, toolchain } = context;
  const scope = toolchain ? undefined : affectedFiles(context);
  if (scope?.size === 0) return { files: [], resolutionFiles: [] };
  const layout = readLayout(contextFiles);
  const groups = new Map<string, typeof files>();
  for (const file of files) {
    if (file.result.status === "failed") continue;
    const fact = (file.result.data as unknown as { go?: FileFact } | undefined)
      ?.go;
    if (fact?.package === undefined || !fact.packageRange) continue;
    const key = `${directoryOf(file.path)}\u0000${fact.package}`;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  const hosts = new Map<string, string>();
  for (const members of groups.values()) {
    const rank = (file: (typeof files)[number]) =>
      (file.path.endsWith("_test.go") ? 2 : 0) +
      (file.result.status === "clean" ? 0 : 1);
    const host = [...members].sort(
      (a, b) =>
        rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    )[0]!;
    hosts.set(host.path, directoryOf(host.path));
  }
  // Package-level names, to decide whether a predeclared identifier is shadowed.
  // A `_test.go` declaration shadows only for that package's test files.
  const packageNames = new Map<
    string,
    { plain: Set<string>; test: Set<string> }
  >();
  for (const file of files) {
    if (file.result.status === "failed") continue;
    const fact = (file.result.data as unknown as { go?: FileFact } | undefined)
      ?.go;
    if (fact?.package === undefined) continue;
    const key = `${directoryOf(file.path)}\u0000${fact.package}`;
    let names = packageNames.get(key);
    if (!names)
      packageNames.set(key, (names = { plain: new Set(), test: new Set() }));
    for (const symbol of file.result.symbols)
      if (
        [
          "function",
          "var",
          "const",
          "struct",
          "interface",
          "type",
          "alias",
        ].includes(symbol.kind) &&
        !(symbol.kind === "function" && symbol.name === "init")
      )
        (fact.test ? names.test : names.plain).add(symbol.name);
  }
  // Recompute every file's facts from its parse facts: drop the previous host symbol and overflow notes.
  const next = new Map<string, ParseResult>();
  for (const file of files) {
    if (file.result.status === "failed" || (scope && !scope.has(file.path)))
      continue;
    const symbols = file.result.symbols.filter(
      (symbol) => symbol.key !== PACKAGE_KEY,
    );
    const directory = hosts.get(file.path);
    if (directory !== undefined) {
      const fact = (file.result.data as unknown as { go: FileFact }).go;
      const importPath = fact.package!.endsWith("_test")
        ? undefined
        : importPathOf(layout, directory);
      symbols.unshift({
        key: PACKAGE_KEY,
        name: fact.package!,
        kind: "package",
        identity: fact.package!,
        range: fact.packageRange!,
        data: {
          directory,
          ...(importPath === undefined ? {} : { importPath }),
        },
      });
    }
    // Notes and shadowed-predeclared links from a previous analyze are recomputed.
    const parsed = file.result.links.filter(
      (link) =>
        !(link.data as { predeclaredName?: boolean } | undefined)
          ?.predeclaredName,
    );
    const fact = (file.result.data as unknown as { go?: FileFact } | undefined)
      ?.go;
    const packageScope =
      fact?.package === undefined
        ? undefined
        : packageNames.get(`${directoryOf(file.path)}\u0000${fact.package}`);
    for (const use of fact?.predeclared ?? []) {
      const shadowed =
        packageScope?.plain.has(use.n) ||
        (file.path.endsWith("_test.go") && packageScope?.test.has(use.n));
      if (!shadowed) continue;
      parsed.push({
        sourceKey: use.src,
        kind: use.k === "call" ? "calls" : "references",
        targetName: use.n,
        range: { start: use.s, end: use.e },
        data:
          use.k === "type"
            ? { t: { n: use.n }, predeclaredName: true }
            : { expr: { k: "name", n: use.n }, predeclaredName: true },
      });
    }
    const links = parsed.map((link) => {
      const data = link.data as { [key: string]: Json } | undefined;
      if (
        !data ||
        !(
          "overflow" in data ||
          "builtin" in data ||
          "open" in data ||
          "reason" in data ||
          "cause" in data ||
          "tc" in data ||
          "toolchain" in data ||
          "uncertainty" in data
        )
      )
        return link;
      const {
        overflow: _overflow,
        builtin: _builtin,
        open: _open,
        reason: _reason,
        cause: _cause,
        tc: _tc,
        toolchain: _toolchain,
        uncertainty: _uncertainty,
        ...rest
      } = data;
      void _overflow;
      void _builtin;
      void _open;
      void _reason;
      void _cause;
      void _tc;
      void _toolchain;
      void _uncertainty;
      return { ...link, data: rest };
    });
    // A previous run's toolchain record is recomputed too.
    const { toolchain: _fileToolchain, ...fileData } = (file.result.data ??
      {}) as { [key: string]: Json };
    void _fileToolchain;
    next.set(file.path, {
      ...file.result,
      ...(file.result.data === undefined ? {} : { data: fileData }),
      symbols,
      links,
    });
  }
  // The opt-in toolchain route (W3-L): its facts on each file and link, read
  // by the resolver (both the notes run below and the real resolution).
  const facts = toolchain
    ? await toolchainFacts(toolchain, files, contextFiles)
    : undefined;
  if (facts)
    for (const [path, result] of next) {
      const status = fileStatus(facts, path);
      result.data = {
        ...((result.data as { [key: string]: Json } | undefined) ?? {}),
        toolchain: status,
      };
      if (status.status !== "in-configuration") continue;
      result.links = result.links.map((link) => {
        const fact = factFor(facts, path, link);
        return fact
          ? {
              ...link,
              data: {
                ...((link.data as { [key: string]: Json } | undefined) ?? {}),
                tc: fact as unknown as Json,
              },
            }
          : link;
      });
    }
  // Over-cap candidate sets (left unresolved) and real builtin calls are only known
  // project-wide; record them on the links themselves.
  count("analyze.go.decisionFiles", scope?.size ?? files.length);
  const notes = await stage("analyze.go.notes", () =>
    linkNotes(
      context.projectId,
      ID,
      files.map((file) =>
        next.has(file.path) ? { ...file, result: next.get(file.path)! } : file,
      ),
      contextFiles,
      scope,
    ),
  );
  for (const [path, group] of notes) {
    const result = next.get(path)!;
    result.links = result.links.map((link, index) => {
      const note = group.get(index);
      if (!note) return link;
      if (note.local) count("analyze.go.localParameterCalls");
      return {
        ...link,
        data: {
          ...((link.data as { [key: string]: Json } | undefined) ?? {}),
          ...(note.builtin ? { builtin: true } : {}),
          // A member on a library-typed value: its declaring owner is not
          // provable from the checkout (C-14).
          ...(note.library ? { uncertainty: note.library } : {}),
          // A failed link: the code it needs is in failed files (named, never
          // targets).
          ...(note.invalid
            ? { reason: "invalid-code", cause: { files: note.invalid } }
            : {}),
          // A call through a parameter, result or receiver: its value comes
          // from the caller.
          ...(note.local ? { reason: "local" } : {}),
          ...(note.open
            ? {
                open: {
                  reason: note.open[0]!,
                  // Every reason that applies, when there is more than one.
                  ...(note.open.length > 1 ? { reasons: note.open } : {}),
                },
              }
            : {}),
          ...(note.overflow
            ? {
                overflow: {
                  candidates: note.overflow.candidates,
                  cap: note.overflow.cap,
                },
              }
            : {}),
          // Where a toolchain fact decided the link: its origin, and what the
          // source-only route said when it named another definite target.
          ...(note.toolchain && facts
            ? {
                toolchain: {
                  origin: "toolchain",
                  go: facts.goVersion,
                  configuration: facts.configuration,
                  upgrade: note.toolchain.upgrade,
                  from: note.toolchain.from,
                  ...(note.toolchain.sourceOnly
                    ? { sourceOnly: note.toolchain.sourceOnly }
                    : {}),
                },
              }
            : {}),
        },
      };
    });
  }
  if (facts && toolchain) {
    const counts: Record<string, number> = {};
    const disagreements: Json[] = [];
    let outside = 0;
    for (const [path, group] of notes)
      for (const [index, note] of group) {
        if (!note.toolchain) continue;
        const key = `${note.toolchain.upgrade}:${note.toolchain.from}`;
        counts[key] = (counts[key] ?? 0) + 1;
        if (note.toolchain.sourceOnly) {
          const link = next.get(path)!.links[index]!;
          disagreements.push({
            file: path,
            range: [link.range.start, link.range.end],
            kind: link.kind,
            name: link.targetName,
            sourceOnly: note.toolchain.sourceOnly,
          });
        }
      }
    for (const [, result] of next) {
      const status = (result.data as { toolchain?: { status?: string } })
        .toolchain?.status;
      if (status !== "in-configuration") outside += result.links.length;
    }
    toolchain.note({
      status: "merged",
      decided: counts,
      disagreements,
      sourceOnlyLinks: outside,
    });
  }
  const output: AnalyzedFile[] = [];
  for (const file of files) {
    const result = next.get(file.path);
    if (result && JSON.stringify(result) !== JSON.stringify(file.result))
      output.push({ path: file.path, result });
  }
  return scope ? { files: output, resolutionFiles: [...scope] } : output;
}

const go: LanguageModule = {
  id: ID,
  version: "33",
  extensions: [".go"],
  contextFiles: ["go.mod", "go.work", "**/vendor/modules.txt"],
  incrementalAnalysis: true,
  // C-55: in a session the indexer keeps the decoded inputs.
  keepsInput: true,
  scopedFileLinkKinds: ["embeds"],
  parse,
  analyze,
  resolve: (context) => {
    count(
      "resolve.go.decisionFiles",
      context.resolutionFiles?.size ??
        context.files.filter((file) => file.module === ID).length,
    );
    return resolveGo(ID, context);
  },
};
export default go;
