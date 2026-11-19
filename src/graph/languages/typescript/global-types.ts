// SPDX-License-Identifier: MIT
import type ts from "typescript";
import type { LibraryTarget } from "../../types.js";
import { fromVirtual } from "./project.js";

// Node 24's documented global objects, classes and functions. The Console
// interface describes the documented global console and the node:console class.
// https://nodejs.org/docs/latest-v24.x/api/globals.html
const nodeGlobals = new Set([
  "__dirname",
  "__filename",
  "AbortController",
  "AbortSignal",
  "Blob",
  "BroadcastChannel",
  "Buffer",
  "ByteLengthQueuingStrategy",
  "CloseEvent",
  "CompressionStream",
  "Console",
  "CountQueuingStrategy",
  "Crypto",
  "CryptoKey",
  "CustomEvent",
  "DecompressionStream",
  "DOMException",
  "Event",
  "EventSource",
  "EventTarget",
  "File",
  "FormData",
  "Headers",
  "MessageChannel",
  "MessageEvent",
  "MessagePort",
  "Navigator",
  "PerformanceEntry",
  "PerformanceMark",
  "PerformanceMeasure",
  "PerformanceObserver",
  "PerformanceObserverEntryList",
  "PerformanceResourceTiming",
  "ReadableByteStreamController",
  "ReadableStream",
  "ReadableStreamBYOBReader",
  "ReadableStreamBYOBRequest",
  "ReadableStreamDefaultController",
  "ReadableStreamDefaultReader",
  "Request",
  "Response",
  "Storage",
  "SubtleCrypto",
  "TextDecoder",
  "TextDecoderStream",
  "TextEncoder",
  "TextEncoderStream",
  "TransformStream",
  "TransformStreamDefaultController",
  "URL",
  "URLPattern",
  "URLSearchParams",
  "WebAssembly",
  "WebSocket",
  "WritableStream",
  "WritableStreamDefaultController",
  "WritableStreamDefaultWriter",
  "atob",
  "btoa",
  "clearImmediate",
  "clearInterval",
  "clearTimeout",
  "console",
  "crypto",
  "exports",
  "fetch",
  "global",
  "localStorage",
  "module",
  "navigator",
  "performance",
  "process",
  "queueMicrotask",
  "require",
  "sessionStorage",
  "setImmediate",
  "setInterval",
  "setTimeout",
  "structuredClone",
]);
const consoleMethods = new Set([
  "assert",
  "clear",
  "count",
  "countReset",
  "debug",
  "dir",
  "dirxml",
  "error",
  "group",
  "groupCollapsed",
  "groupEnd",
  "info",
  "log",
  "table",
  "time",
  "timeEnd",
  "timeLog",
  "trace",
  "warn",
]);
const timers = new Set([
  "clearImmediate",
  "clearInterval",
  "clearTimeout",
  "setImmediate",
  "setInterval",
  "setTimeout",
]);

export const nodeCanDeclare = (owner: string) => nodeGlobals.has(owner);
const nodeTargets = new Map<string, LibraryTarget | undefined>();

/** Only directly documented global names and console methods get a Node fact. */
export function nodeGlobalTarget(symbol: string): LibraryTarget | undefined {
  if (!nodeTargets.has(symbol))
    nodeTargets.set(symbol, documentedTarget(symbol));
  return nodeTargets.get(symbol);
}

function documentedTarget(symbol: string): LibraryTarget | undefined {
  const method = /^Console\.prototype\.([^.]*)$/.exec(symbol)?.[1];
  if (method && consoleMethods.has(method))
    return {
      ecosystem: "node",
      unit: "console",
      symbol: "Console.prototype." + method,
      evidence: "declaring-owner",
    };
  if (!nodeGlobals.has(symbol)) return undefined;
  return {
    ecosystem: "node",
    unit: timers.has(symbol)
      ? "timers"
      : symbol === "console" || symbol === "Console"
        ? "console"
        : "globals",
    symbol,
    evidence: "declared-builtin",
  };
}

type TypeResolution = {
  resolvedTypeReferenceDirective?: { resolvedFileName: string };
};
type VisitTypeResolution = (resolution: TypeResolution, name: string) => void;

const programTypes = new WeakMap<
  ts.Program,
  { hasNode: boolean; expectsNode: boolean; otherMissing: boolean }
>();

/** Configured and referenced types participate in the program's global scope. */
export function globalTypeAvailability(
  program: ts.Program,
  isNodeTypeFile: (path: string) => boolean,
) {
  const previous = programTypes.get(program);
  if (previous) return previous;
  const expected = new Set(program.getCompilerOptions().types ?? []);
  const available = new Set<string>();
  const compiler = program as ts.Program & {
    forEachResolvedTypeReferenceDirective: (visit: VisitTypeResolution) => void;
    getAutomaticTypeDirectiveResolutions: () =>
      | { forEach: (visit: VisitTypeResolution) => void }
      | undefined;
  };
  let hasNode = false;
  for (const source of program.getSourceFiles()) {
    for (const reference of source.typeReferenceDirectives)
      expected.add(reference.fileName);
    const path = fromVirtual(source.fileName);
    if (path !== undefined && source.isDeclarationFile && isNodeTypeFile(path))
      hasNode = true;
  }
  const read: VisitTypeResolution = (result, name) => {
    const path = result.resolvedTypeReferenceDirective?.resolvedFileName;
    if (path !== undefined && program.getSourceFile(path)) available.add(name);
  };
  compiler.forEachResolvedTypeReferenceDirective(read);
  compiler.getAutomaticTypeDirectiveResolutions()?.forEach(read);
  const node = (name: string) => name === "node" || name === "@types/node";
  const result = {
    hasNode: hasNode || [...available].some(node),
    expectsNode: [...expected].some(node),
    otherMissing: [...expected].some(
      (name) => !node(name) && !available.has(name),
    ),
  };
  programTypes.set(program, result);
  return result;
}
