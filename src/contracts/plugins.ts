// SPDX-License-Identifier: MIT
import {
  defaultScaffoldBodyMode,
  defaultPluginTimeoutMs,
  scaffoldBodyModes,
  type ScaffoldBodyMode,
} from "../shared/outputs.js";
import { contractManifest } from "./manifest.js";
import { portableContractDocument } from "./portable.js";
import { realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { runProcess, type ProcessClock } from "../backends/process.js";
import { json } from "../shared/identity.js";
import type { ContractDocument } from "./document.js";
import type { Scaffold } from "./scaffold.js";
export function pluginFailure(stderr: string, fallback: string) {
  if (/heap out of memory|allocation failed|Reached heap limit/i.test(stderr))
    return "Emitter exceeded its 256 MiB memory budget. Reduce the design scope or update the plugin to process declarations incrementally. No output was accepted.";
  return stderr.trim().slice(0, 2000) || fallback;
}
const outputSchema = z
  .object({
    target: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
    extension: z.string().regex(/^\.[a-z0-9]{1,12}$/),
    output: z
      .object({
        source: z.string().max(8 * 1024 * 1024),
        bodyPolicy: z.enum(scaffoldBodyModes).optional(),
        outputMode: z.enum(["stubs", "contracts"]).optional(),
        symbols: z
          .array(
            z
              .object({
                symbolId: z.string(),
                name: z.string().min(1).max(256),
              })
              .strict(),
          )
          .max(100000),
        notes: z.array(z.string().max(4096)).max(100),
        dependencies: z.array(z.string().max(1024)).max(100),
        omitted: z
          .array(
            z
              .object({
                symbolId: z.string(),
                reason: z.string().min(1).max(4096),
              })
              .strict(),
          )
          .max(100000)
          .optional(),
      })
      .strict(),
  })
  .strict();
export async function emitPlugin(
  doc: ContractDocument,
  path: string,
  target: string,
  signal: AbortSignal,
  options: {
    bodyPolicy?: ScaffoldBodyMode;
    requirePolicy?: boolean;
    clock?: ProcessClock;
    timeoutMs?: number;
  } = {},
): Promise<Scaffold> {
  doc = portableContractDocument(doc);
  const bodyPolicy =
    options.bodyPolicy ?? doc.bodyPolicy ?? defaultScaffoldBodyMode;
  let plugin: string;
  try {
    plugin = await realpath(resolve(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw Error(
        `Emitter plugin file was not found: ${resolve(path)}. Check --plugin or choose --target typescript, rust or go without a plugin.`,
      );
    throw error;
  }
  if (!(await stat(plugin)).isFile())
    throw Error("Emitter plugin must be a local file");
  const result = await runProcess(
    process.execPath,
    [
      "--max-old-space-size=256",
      fileURLToPath(new URL("./plugin-runner.js", import.meta.url)),
      plugin,
    ],
    {
      cwd: dirname(plugin),
      timeoutMs: options.timeoutMs ?? defaultPluginTimeoutMs,
      maxBytes: 9 * 1024 * 1024,
      signal,
      input: json({ ...doc, bodyPolicy }),
      ...(options.clock ? { clock: options.clock } : {}),
    },
  );
  if (result.kind !== "exited" || result.code !== 0)
    throw Error(
      `Emitter plugin ${result.kind}: ${pluginFailure(result.stderr, "no valid output")}`,
    );
  let checked: z.infer<typeof outputSchema>;
  try {
    checked = outputSchema.parse(JSON.parse(result.stdout) as unknown);
  } catch (error) {
    const detail =
      error instanceof z.ZodError
        ? error.issues
            .slice(0, 3)
            .map(
              (issue) =>
                `${issue.path.join(".") || "output"}: ${issue.message}`,
            )
            .join("; ")
        : "expected one valid JSON response. stdout is reserved for the protocol; use console.error for plugin logging";
    throw Error("Emitter plugin returned malformed output: " + detail);
  }
  if (checked.target !== target)
    throw Error(
      `Emitter plugin declares target "${checked.target}", but --target is "${target}". Run again with --target ${checked.target}.`,
    );
  if (
    (checked.output.bodyPolicy && checked.output.bodyPolicy !== bodyPolicy) ||
    (options.requirePolicy && !checked.output.bodyPolicy)
  )
    throw Error(
      `Emitter plugin did not confirm the requested ${bodyPolicy} body policy. Update the emitter to return bodyPolicy with its output.`,
    );
  if (
    doc.outputMode === "contracts" &&
    checked.output.outputMode !== "contracts"
  )
    throw Error(
      "Emitter plugin does not confirm contracts-only output. Use stubs mode or update the plugin to support outputMode: contracts.",
    );
  const declarations = new Map(doc.declarations.map((d) => [d.symbolId, d])),
    seen = new Set<string>();
  for (const item of [
    ...checked.output.symbols,
    ...(checked.output.omitted ?? []),
  ]) {
    if (!declarations.has(item.symbolId) || seen.has(item.symbolId))
      throw Error(
        `Emitter plugin returned ${declarations.has(item.symbolId) ? "duplicate" : "unknown"} source symbol: ${item.symbolId}`,
      );
    seen.add(item.symbolId);
  }
  if (seen.size !== declarations.size)
    throw Error(
      "Emitter plugin must map or explicitly omit every supplied declaration; missing: " +
        [...declarations.keys()]
          .filter((id) => !seen.has(id))
          .slice(0, 8)
          .join(", "),
    );
  return {
    format: target,
    extension: checked.extension,
    source: checked.output.source,
    snapshotId: doc.snapshotId,
    implementation:
      doc.outputMode === "contracts"
        ? "declarations"
        : (checked.output.bodyPolicy ?? "plugin_defined"),
    mode: doc.outputMode ?? "stubs",
    contractManifest: {
      ...contractManifest(doc),
      omitted: [
        ...doc.omitted,
        ...(checked.output.omitted ?? []).map((s) => ({
          name: declarations.get(s.symbolId)!.name,
          reason: s.reason,
        })),
      ],
    },
    assurance: "plugin_declared",
    symbols: checked.output.symbols.map((s) => ({
      ...s,
      span: declarations.get(s.symbolId)!.span,
    })),
    omitted: [
      ...doc.omitted,
      ...(checked.output.omitted ?? []).map((s) => ({
        name: declarations.get(s.symbolId)!.name,
        reason: s.reason,
      })),
    ],
    dependencies: checked.output.dependencies,
    notes: [
      ...checked.output.notes,
      ...(!checked.output.bodyPolicy
        ? [
            "Legacy emitter did not declare a body policy; no fail-fast or empty-body guarantee is available.",
          ]
        : []),
      "Third-party output is untrusted as a correctness claim; review its syntax and body contract before use.",
    ],
  };
}

/** Validate module syntax/API/target before advertising a registered language. */
export async function probePlugin(
  path: string,
  target: string,
  signal: AbortSignal,
  clock?: ProcessClock,
  timeoutMs = defaultPluginTimeoutMs,
) {
  const result = await runProcess(
    process.execPath,
    [
      "--max-old-space-size=256",
      fileURLToPath(new URL("./plugin-runner.js", import.meta.url)),
      path,
      "--metadata",
    ],
    {
      cwd: dirname(path),
      timeoutMs,
      maxBytes: 16384,
      signal,
      ...(clock ? { clock } : {}),
    },
  );
  if (result.kind !== "exited" || result.code !== 0)
    throw Error(
      `Cannot register emitter (${result.kind}): ${pluginFailure(result.stderr, "no valid metadata")}`,
    );
  const schema = z
    .object({
      apiVersion: z.literal("pymtheg.emitter/v1"),
      target: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
      extension: z.string().regex(/^\.[a-z0-9]{1,12}$/),
    })
    .strict();
  let metadata: z.infer<typeof schema>;
  try {
    metadata = schema.parse(JSON.parse(result.stdout));
  } catch {
    throw Error(
      "Cannot register emitter: invalid API, target or file extension metadata",
    );
  }
  if (metadata.target !== target)
    throw Error(
      `Cannot register target ${target}: emitter declares ${metadata.target}. Use --plugin ${metadata.target}=${path}.`,
    );
  return metadata;
}
