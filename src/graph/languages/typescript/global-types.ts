// SPDX-License-Identifier: MIT
import ts from "typescript";
import type { LibraryTarget } from "../../types.js";
import { fromVirtual, LIB_ROOT } from "./project.js";

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
const nodeUnits = new Map<string, string>();
for (const [unit, names] of [
  ["url", "URL URLSearchParams URLPattern URLPatternInit URLPatternResult"],
  ["util", "TextEncoder TextDecoder"],
  ["buffer", "Blob File Buffer"],
  ["worker_threads", "BroadcastChannel MessageChannel MessagePort"],
  [
    "perf_hooks",
    "performance Performance PerformanceEntry PerformanceMark PerformanceMeasure PerformanceObserver PerformanceObserverEntryList PerformanceResourceTiming",
  ],
  [
    "stream/web",
    "ByteLengthQueuingStrategy CompressionStream CountQueuingStrategy DecompressionStream QueuingStrategy ReadableByteStreamController ReadableStream ReadableStreamBYOBReader ReadableStreamBYOBRequest ReadableStreamDefaultController ReadableStreamDefaultReader TextDecoderStream TextEncoderStream TransformStream TransformStreamDefaultController WritableStream WritableStreamDefaultController WritableStreamDefaultWriter",
  ],
] as const)
  for (const name of names.split(" ")) nodeUnits.set(name, unit);

// Global types declared by @types/node 24.13.3 alongside its Web API values.
// The fetch interfaces come from web-globals/fetch.d.ts and undici-types.
const nodeWebTypes = new Set([
  "CloseEventInit",
  "EventListenerOptions",
  "EventSourceInit",
  "MessageEventInit",
  "QueuingStrategy",
  "RequestInit",
  "ResponseInit",
  "URLPatternInit",
  "URLPatternResult",
  "WebSocketInit",
]);
const body = "body bodyUsed arrayBuffer blob bytes formData json text";
const event =
  "bubbles cancelBubble cancelable composed currentTarget defaultPrevented eventPhase isTrusted returnValue srcElement target timeStamp type composedPath initEvent preventDefault stopImmediatePropagation stopPropagation";
const webMembers = new Map(
  Object.entries({
    AbortController: "abort signal",
    AbortSignal:
      "aborted onabort reason throwIfAborted addEventListener dispatchEvent removeEventListener",
    Blob: "size type arrayBuffer bytes slice stream text",
    ByteLengthQueuingStrategy: "highWaterMark size",
    CloseEvent: event + " code reason wasClean",
    CloseEventInit: "code reason wasClean bubbles cancelable composed",
    CompressionStream: "readable writable",
    CountQueuingStrategy: "highWaterMark size",
    CustomEvent: event + " detail",
    Crypto: "getRandomValues randomUUID subtle",
    CryptoKey: "algorithm extractable type usages",
    DecompressionStream: "readable writable",
    DOMException: "code message name",
    Event: event,
    EventListenerOptions: "capture",
    EventSource:
      "close CLOSED CONNECTING OPEN onerror onmessage onopen readyState url withCredentials addEventListener removeEventListener dispatchEvent",
    EventSourceInit: "withCredentials",
    EventTarget: "addEventListener dispatchEvent removeEventListener",
    File: "name lastModified size type arrayBuffer bytes slice stream text",
    FormData: "append set get getAll has delete keys values entries forEach",
    Headers:
      "append delete entries forEach get getSetCookie has keys set values",
    MessageChannel: "port1 port2",
    MessageEvent:
      event + " data lastEventId origin ports source initMessageEvent",
    MessageEventInit:
      "data lastEventId origin ports source bubbles cancelable composed",
    Navigator:
      "hardwareConcurrency language languages locks platform userAgent",
    Performance:
      "clearMarks clearMeasures clearResourceTimings getEntries getEntriesByName getEntriesByType mark measure now setResourceTimingBufferSize timeOrigin toJSON",
    PerformanceEntry: "duration entryType name startTime toJSON",
    PerformanceMark: "detail duration entryType name startTime toJSON",
    PerformanceMeasure: "detail duration entryType name startTime toJSON",
    PerformanceObserver: "disconnect observe takeRecords",
    PerformanceObserverEntryList:
      "getEntries getEntriesByName getEntriesByType",
    QueuingStrategy: "highWaterMark size",
    ReadableByteStreamController: "byobRequest desiredSize close enqueue error",
    ReadableStream: "locked cancel getReader pipeThrough pipeTo tee",
    ReadableStreamBYOBReader: "read releaseLock closed cancel",
    ReadableStreamBYOBRequest: "view respond respondWithNewView",
    ReadableStreamDefaultController: "desiredSize close enqueue error",
    ReadableStreamDefaultReader: "read releaseLock closed cancel",
    Request:
      body +
      " cache clone credentials destination headers integrity keepalive method mode redirect referrer referrerPolicy signal url",
    RequestInit:
      "body cache credentials headers integrity keepalive method mode redirect referrer referrerPolicy signal window",
    Response: body + " clone headers ok redirected status statusText type url",
    ResponseInit: "headers status statusText",
    Storage: "length clear getItem key removeItem setItem",
    SubtleCrypto:
      "decrypt deriveBits deriveKey digest encrypt exportKey generateKey importKey sign unwrapKey verify wrapKey",
    TextDecoder: "decode encoding fatal ignoreBOM",
    TextDecoderStream: "encoding fatal ignoreBOM readable writable",
    TextEncoder: "encode encodeInto encoding",
    TextEncoderStream: "encoding readable writable",
    TransformStream: "readable writable",
    TransformStreamDefaultController: "desiredSize enqueue error terminate",
    URL: "hash host hostname href origin password pathname port protocol search searchParams username toJSON toString",
    URLSearchParams:
      "append delete entries forEach get getAll has keys set size sort toString values",
    WebSocket:
      "binaryType bufferedAmount extensions onclose onerror onmessage onopen protocol readyState url close send CLOSED CLOSING CONNECTING OPEN addEventListener removeEventListener dispatchEvent",
    WritableStream: "locked abort close getWriter",
    WritableStreamDefaultController: "error",
    WritableStreamDefaultWriter:
      "closed desiredSize ready abort close releaseLock write",
  }).map(([name, members]) => [name, new Set(members.split(" "))]),
);
const webStatics = new Set([
  "AbortSignal.abort",
  "AbortSignal.any",
  "AbortSignal.timeout",
  "ReadableStream.from",
  "Response.error",
  "Response.json",
  "Response.redirect",
  "URL.canParse",
  "URL.createObjectURL",
  "URL.parse",
  "URL.revokeObjectURL",
]);

export const nodeCanDeclare = (owner: string) =>
  nodeGlobals.has(owner) || nodeWebTypes.has(owner);

type NodeReceiver = { type: ts.Type; name: string };
const receiverCache = new WeakMap<
  ts.TypeChecker,
  WeakMap<ts.Type, NodeReceiver[]>
>();

/** Check the receiver's compiler identity before using its public Node API. */
export function nodeReceiverTypes(
  checker: ts.TypeChecker,
  receiver: ts.Expression,
) {
  const type = checker.getTypeAtLocation(receiver);
  let cache = receiverCache.get(checker);
  if (!cache) receiverCache.set(checker, (cache = new WeakMap()));
  const previous = cache.get(type);
  if (previous) return previous;
  const result: NodeReceiver[] = [];
  const seen = new Set<ts.Type>();
  const visit = (type: ts.Type) => {
    if (seen.has(type)) return;
    seen.add(type);
    if (type.isUnionOrIntersection()) {
      type.types.forEach(visit);
      return;
    }
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = checker.getBaseConstraintOfType(type);
      if (constraint) visit(constraint);
      return;
    }
    const symbol = type.getSymbol();
    const name = symbol?.name;
    if (
      name &&
      (nodeCanDeclare(name) || name === "Performance") &&
      symbol.declarations?.some((decl) =>
        decl.getSourceFile().fileName.startsWith(LIB_ROOT + "/"),
      )
    )
      result.push({ type, name });
  };
  visit(type);
  cache.set(type, result);
  return result;
}

export function nodeMemberTarget(
  owner: string,
  member: string,
  bundled: string,
) {
  if (owner === "Console" || !bundled.includes(".prototype."))
    return nodeGlobalTarget(bundled);
  return webMembers.get(owner)?.has(member)
    ? nodeGlobalTarget(`${owner}.prototype.${member}`)
    : undefined;
}

const nodeTargets = new Map<string, LibraryTarget | undefined>();

/** Alternatives from the documented Node globals and their verified type surface. */
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
  const web = /^([^.]*)\.prototype\.([^.]*)$/.exec(symbol);
  if (web && webMembers.get(web[1]!)?.has(web[2]!))
    return {
      ecosystem: "node",
      unit: nodeUnits.get(web[1]!) ?? "globals",
      symbol: nodeWebTypes.has(web[1]!) ? `${web[1]}.${web[2]}` : symbol,
      evidence: "declared-builtin",
    };
  if (webStatics.has(symbol))
    return {
      ecosystem: "node",
      unit: nodeUnits.get(symbol.slice(0, symbol.indexOf("."))) ?? "globals",
      symbol,
      evidence: "declared-builtin",
    };
  if (!nodeCanDeclare(symbol)) return undefined;
  return {
    ecosystem: "node",
    unit: timers.has(symbol)
      ? "timers"
      : symbol === "console" || symbol === "Console"
        ? "console"
        : (nodeUnits.get(symbol) ?? "globals"),
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
  { hasNode: boolean; expectsNode: boolean; otherGlobals: ReadonlySet<string> }
>();
const testGlobals = [
  "afterAll",
  "afterEach",
  "beforeAll",
  "beforeEach",
  "describe",
  "expect",
  "it",
  "test",
];
const ambientGlobals = new Map<string, readonly string[]>([
  ["vite/client", ["ImportMeta", "ImportMetaEnv"]],
  [
    "vitest/globals",
    [...testGlobals, "assert", "bench", "suite", "vi", "vitest"],
  ],
  ["jest", [...testGlobals, "fit", "jest", "xdescribe", "xit", "xtest"]],
  ["@types/jest", [...testGlobals, "fit", "jest", "xdescribe", "xit", "xtest"]],
  ["react", ["React", "JSX"]],
  ["@types/react", ["React", "JSX"]],
]);
// These are shared Web APIs documented for Bun, Workers and Deno. Ambient
// test or build-tool packages have no such web-platform surface.
const environmentGlobals =
  "AbortController AbortSignal Blob Body BroadcastChannel Console DOMException Event EventTarget File FormData Headers ReadableStream ReadableStreamDefaultReader ReadableStreamDefaultController Request RequestInit Response ResponseInit TextDecoder TextEncoder TransformStream URL URLSearchParams WebSocket WritableStream console crypto fetch performance queueMicrotask setInterval setTimeout clearInterval clearTimeout structuredClone".split(
    " ",
  );
const environmentTypes = new Set([
  "bun",
  "bun-types",
  "@types/bun",
  "@cloudflare/workers-types",
  "deno.window",
  "deno.worker",
]);
function missingAmbientGlobals(name: string): readonly string[] {
  return environmentTypes.has(name) ||
    name.startsWith("@cloudflare/workers-types/")
    ? environmentGlobals
    : (ambientGlobals.get(name) ?? []);
}

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
    otherGlobals: new Set(
      [...expected].flatMap((name) =>
        available.has(name) ? [] : missingAmbientGlobals(name),
      ),
    ),
  };
  programTypes.set(program, result);
  return result;
}
