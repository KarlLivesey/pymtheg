// SPDX-License-Identifier: MIT
import { mkdtemp, open, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { captureLease, reapStaleCaptures } from "./capture-lease.js";
import { architectureLimits } from "../architecture/limits.js";
import { decodeObservation, observationPath } from "./storage.js";
import { isObservationPart } from "../architecture/limits.js";
import type { ObservedSource, ObservedGraph } from "./schema.js";

export class ObservationFallbackError extends Error {}
export async function observeInProcess(
  files: ObservedSource[],
  version: ObservedGraph["version"],
  projectId: string | null,
  signal: AbortSignal,
  execution: {
    runnerURL?: URL;
    onReady?: () => void;
    heapMiB?: number;
    sourcePaths?: string[];
  } = {},
): Promise<ObservedGraph> {
  signal.throwIfAborted();
  await reapStaleCaptures();
  const root = await mkdtemp(join(tmpdir(), "pym-code-process-"));
  let lease: Awaited<ReturnType<typeof captureLease>> | undefined;
  try {
    lease = await captureLease(root, signal, execution.onReady);
    await lease.ready;
    const input = join(root, "input.jsonl");
    const handle = await open(input, "wx");
    try {
      await handle.writeFile(
        JSON.stringify({
          version,
          options: { projectId, sourcePaths: execution.sourcePaths },
        }) + "\n",
      );
      for (const file of files) {
        signal.throwIfAborted();
        await handle.writeFile(JSON.stringify(file) + "\n");
      }
    } finally {
      await handle.close();
    }
    const bytes = files.reduce((n, f) => n + Buffer.byteLength(f.text), 0);
    const heap =
      execution.heapMiB ??
      Math.min(1024, Math.max(512, Math.ceil((bytes * 80) / 1024 / 1024)));
    if (!Number.isInteger(heap) || heap < 16 || heap > 1024)
      throw Error("Invalid capture process heap bound.");
    lease.start(
      fileURLToPath(
        execution.runnerURL ?? new URL("./capture-child.js", import.meta.url),
      ),
      input,
      heap,
    );
    const result = await lease.result;
    signal.throwIfAborted();
    if (result.kind === "exited" && result.code === 0) {
      const receipt = z
        .array(
          z
            .string()
            .refine(
              (path) => path === observationPath || isObservationPart(path),
            ),
        )
        .min(1)
        .max(10001)
        .parse(JSON.parse(await readFile(join(root, "receipt.json"), "utf8")));
      const documents = [];
      let total = 0;
      for (const [index, path] of receipt.entries()) {
        signal.throwIfAborted();
        const file = join(root, index + ".json");
        const size = (await stat(file)).size;
        total += size;
        if (
          size > architectureLimits.documentBytes ||
          total > architectureLimits.snapshotBytes
        )
          throw Error(
            "Code capture output exceeds its retained byte limits; previous versions were preserved.",
          );
        documents.push({ path, text: await readFile(file, "utf8") });
      }
      const graph = decodeObservation(documents);
      if (!graph) throw Error("Capture process returned no code version.");
      return graph;
    }
    const confirmedOOM =
      result.kind === "exited" &&
      (result.signal === "SIGABRT" || result.code === 134) &&
      /FATAL ERROR: (?:Reached heap limit|Ineffective mark-compacts near heap limit|CALL_AND_RETRY_LAST Allocation failed)[^\n]*[Oo]ut of memory/.test(
        result.stderr,
      );
    if (result.kind === "exited" && (result.signal || result.code === 134))
      throw new ObservationFallbackError(
        confirmedOOM
          ? `The full-project parser exhausted its memory bound for ${files.length} files (${bytes} source bytes).`
          : `The full-project parser stopped ${result.signal ? "with signal " + result.signal : "with exit code " + result.code} for ${files.length} files (${bytes} source bytes). The cause is unknown; memory exhaustion was not confirmed.`,
      );
    if (result.kind === "output_limit")
      throw Error(
        "Code capture exceeded its diagnostic output limit; previous versions were preserved.",
      );
    throw Error(
      result.stderr.trim().slice(0, 2000) ||
        "Code capture process failed; previous versions were preserved.",
    );
  } finally {
    await lease?.close();
    await rm(root, { recursive: true, force: true });
  }
}
