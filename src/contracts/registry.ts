import type { ProcessClock } from "../backends/process.js";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { hash } from "../shared/identity.js";
import {
  outputTargetIds,
  defaultPluginTimeoutMs,
  pluginDeadline,
  outputTargets,
  isOutputTarget,
  type ScaffoldBodyMode,
  type OutputMode,
} from "../shared/outputs.js";
import { emitDocument, type Scaffold } from "./scaffold.js";
import { emitPlugin, probePlugin } from "./plugins.js";
import type { ContractDocument } from "./document.js";
interface TrustedEmitter {
  target: string;
  path: string;
  hash: string;
}
/** Only explicit launch configuration can register executable modules. Requests use IDs. */
export class OutputRegistry {
  private controller = new AbortController();
  private running = new Set<Promise<Scaffold>>();
  private constructor(
    private plugins: TrustedEmitter[],
    private clock?: ProcessClock,
    private timeoutMs = defaultPluginTimeoutMs,
  ) {}
  static empty() {
    return new OutputRegistry([]);
  }
  static async load(
    specifications: readonly string[],
    signal: AbortSignal = new AbortController().signal,
    options: { clock?: ProcessClock; timeoutMs?: number } = {},
  ) {
    const plugins: TrustedEmitter[] = [];
    for (const specification of specifications) {
      const equals = specification.indexOf("=");
      const target = specification.slice(0, equals),
        file = specification.slice(equals + 1);
      if (equals < 1 || !/^[a-z][a-z0-9_-]{0,39}$/.test(target) || !file)
        throw Error(
          "Use --plugin TARGET=/absolute/emitter.mjs to register a trusted output plugin.",
        );
      if (isOutputTarget(target) || plugins.some((p) => p.target === target))
        throw Error("Output target is already registered: " + target);
      const path = await realpath(resolve(file));
      const entry = await stat(path);
      if (!entry.isFile() || entry.size > 1024 * 1024)
        throw Error("Emitter entry must be a file of at most 1 MiB");
      const fingerprint = hash((await readFile(path)).toString("base64"));
      await probePlugin(path, target, signal, options.clock, options.timeoutMs);
      if (hash((await readFile(path)).toString("base64")) !== fingerprint)
        throw Error(
          "Emitter entry changed during registration. Review the file and register it again.",
        );
      plugins.push({ target, path, hash: fingerprint });
    }
    return new OutputRegistry(plugins, options.clock, options.timeoutMs);
  }
  targets() {
    return [
      ...outputTargetIds.map((id) => ({
        id,
        label: outputTargets[id].label,
        builtin: true,
      })),
      ...this.plugins.map((p) => ({
        id: p.target,
        label: p.target + " (plugin)",
        builtin: false,
      })),
    ];
  }
  launchArguments() {
    return [
      ...this.plugins.flatMap((p) => ["--plugin", p.target + "=" + p.path]),
      ...(this.timeoutMs !== defaultPluginTimeoutMs
        ? ["--plugin-timeout", this.timeoutMs + "ms"]
        : []),
    ];
  }
  async emit(
    document: ContractDocument,
    target: string,
    body: ScaffoldBodyMode,
    signal: AbortSignal,
    mode: OutputMode = "stubs",
  ): Promise<Scaffold> {
    document = { ...document, outputMode: mode };
    const combined = AbortSignal.any([signal, this.controller.signal]);
    const task = (async () => {
      if (combined.aborted) throw Error("Scaffold generation cancelled");
      if (isOutputTarget(target)) return emitDocument(document, target, body);
      const plugin = this.plugins.find((p) => p.target === target);
      if (!plugin)
        throw Error(
          "Unknown output target " +
            target +
            ". Available: " +
            this.targets()
              .map((t) => t.id)
              .join(", "),
        );
      if (
        hash((await readFile(plugin.path)).toString("base64")) !== plugin.hash
      )
        throw Error(
          "The trusted emitter entry changed after launch. Restart with the plugin explicitly configured again.",
        );
      return emitPlugin(document, plugin.path, target, combined, {
        bodyPolicy: body,
        requirePolicy: true,
        timeoutMs: this.timeoutMs,
        ...(this.clock ? { clock: this.clock } : {}),
      });
    })();
    this.running.add(task);
    try {
      return await task;
    } finally {
      this.running.delete(task);
    }
  }
  async close() {
    this.controller.abort();
    await Promise.allSettled(this.running);
  }
}

export function outputPluginArguments(args: readonly string[]) {
  const specifications: string[] = [],
    rest: string[] = [];
  let timeoutMs = defaultPluginTimeoutMs,
    specified = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plugin") {
      const specification = args[++i];
      if (!specification || specification.startsWith("--"))
        throw Error("Use --plugin TARGET=/absolute/emitter.mjs");
      specifications.push(specification);
    } else if (args[i] === "--plugin-timeout") {
      if (specified) throw Error("Choose one plugin timeout");
      timeoutMs = pluginDeadline(args[++i] ?? "");
      specified = true;
    } else rest.push(args[i]!);
  }
  return { specifications, rest, timeoutMs };
}
