// SPDX-License-Identifier: MIT
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { captureImplementation } from "./capture.js";
import { atomicWrite } from "../reporting/publish.js";
import { json } from "../shared/identity.js";
import { ArchitectureStore } from "../architecture/store.js";
import { retainObservation } from "./workspace.js";
import { discoverImplementationFiles } from "./files.js";

export async function observeCommand(args: string[], signal: AbortSignal) {
  const files: string[] = [];
  const options = new Map<string, string>();
  let retain = false,
    list = false;
  for (let i = 0; i < args.length; i++) {
    const argument = args[i]!;
    if (argument === "--list") {
      if (list) throw Error("Duplicate --list option");
      list = true;
      continue;
    }
    if (argument === "--retain") {
      if (retain) throw Error("Duplicate --retain option");
      retain = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      files.push(argument);
      continue;
    }
    if (
      !["--root", "--label", "--out", "--format", "--directory"].includes(
        argument,
      ) ||
      options.has(argument) ||
      !args[i + 1] ||
      args[i + 1]!.startsWith("--")
    )
      throw Error("Invalid observe option " + argument);
    options.set(argument, args[++i]!);
  }
  const format = options.get("--format") ?? "text";
  if (!["text", "json"].includes(format))
    throw Error("Observe format must be text or json");
  const root = resolve(options.get("--root") ?? ".");
  if (list) {
    if (
      files.length ||
      retain ||
      options.has("--out") ||
      options.has("--label")
    )
      throw Error(
        "--list discovers candidate paths only; omit files, --retain, --out and --label.",
      );
    const inventory = await discoverImplementationFiles(
      root,
      options.get("--directory") ?? ".",
      signal,
    );
    process.stdout.write(
      format === "json"
        ? json(inventory)
        : [
            `${inventory.files.length} candidate TypeScript/JavaScript files ${inventory.directory === "." ? "under the project root" : "in " + inventory.directory}.`,
            "Contents were not read or checked. Pass selected paths to observe to capture their code.",
            ...inventory.files,
            ...inventory.warnings,
          ].join("\n") + "\n",
    );
    return inventory.complete ? 0 : 2;
  }
  if (options.has("--directory"))
    throw Error(
      "--directory applies only with --list; pass selected files to capture code.",
    );
  const graph = await captureImplementation(
    root,
    files,
    options.get("--label") ?? "Working tree",
    signal,
  );
  const output = options.get("--out");
  let retainedRevision: string | null = null;
  let storage: Awaited<ReturnType<typeof retainObservation>>["storage"] | null =
    null;
  if (retain) {
    const store = await ArchitectureStore.open(root);
    try {
      const current = await store.readAsync();
      const retained = await retainObservation(
        store,
        graph,
        current?.id ?? null,
        signal,
      );
      retainedRevision = retained.id;
      storage = retained.storage;
    } finally {
      await store.closeReadWorkers();
      store.close();
    }
  }
  if (output) {
    const path = resolve(output);
    const destination = await realpath(path).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return path;
        throw error;
      },
    );
    const canonicalRoot = await realpath(root);
    if (
      files.some((file) => resolve(root, file) === path) ||
      graph.scope.files.some(
        (file) =>
          resolve(canonicalRoot, file) === destination ||
          resolve(root, file) === path,
      )
    )
      throw Error("Refusing to overwrite observed source");
    await atomicWrite(path, json(graph), signal);
  }
  process.stdout.write(
    format === "json"
      ? json(graph)
      : [
          `${graph.version.label}: ${graph.nodes.length} observed nodes, ${graph.edges.length} edges in ${graph.files.length} files.`,
          `Snapshot ${graph.snapshotId}`,
          ...(retainedRevision
            ? [`Retained architecture revision ${retainedRevision}`]
            : []),
          ...(storage
            ? [
                `Code storage: ${storage.newBytes} new bytes in ${storage.newParts} parts; ${storage.reusedBytes} bytes reused in ${storage.reusedParts} parts (including version metadata).`,
              ]
            : []),
          `Declaration coverage: ${graph.coverage.declarations}; relationship coverage: ${graph.coverage.relationships}; ${graph.edges.filter((edge) => edge.resolution === "unresolved").length} unresolved edges.`,
          `Unresolved targets by origin: ${["builtin", "external-package", "local-binding", "unknown"].map((kind) => `${kind} ${graph.edges.filter((edge) => edge.resolution === "unresolved" && (edge.targetKind ?? "unknown") === kind).length}`).join(", ")}. Origin labels do not resolve or validate the target.`,
          ...graph.limitations,
          "This observes code presence and structure, not implemented business behaviour.",
          ...(graph.omittedFiles ?? []).map(
            (file) => `${file.path} (${file.bytes} bytes): ${file.reason}`,
          ),
          ...graph.diagnostics.map((item) => {
            const text = graph.files.find(
              (file) => file.path === item.span.file,
            )?.text;
            const before = text?.slice(0, item.span.start);
            const position =
              before === undefined
                ? " (source position unavailable)"
                : `:${before.split("\n").length}:${before.length - before.lastIndexOf("\n")}`;
            return `${item.span.file}${position}: ${item.message}`;
          }),
        ].join("\n") + "\n",
  );
  return graph.completeness === "complete" ? 0 : 2;
}
