// SPDX-License-Identifier: MIT
import { hash } from "../shared/identity.js";
import { z } from "zod";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { ObservedGraph } from "./schema.js";
type Part = {
  schema: "pymtheg.observed-file/v1";
  file: ObservedGraph["files"][number];
  nodes: ObservedGraph["nodes"];
  edges: ObservedGraph["edges"];
  diagnostics: ObservedGraph["diagnostics"];
};
const index = z.number().int().nonnegative();
const expandedPartBytes = 16 * 1024 * 1024;
const compressedSchema = z
  .object({
    schema: z.literal("pymtheg.observed-file/v3"),
    encoding: z.literal("deflate-raw-base64"),
    bytes: z.number().int().nonnegative().max(expandedPartBytes),
    content: z
      .string()
      .max(expandedPartBytes)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .refine((text) => text.length % 4 === 0, "Invalid base64 length"),
  })
  .strict();

/** Compression changes storage only; expansion retains the existing byte bound. */
export function serializePart(value: ReturnType<typeof encodePart>): string {
  const text = JSON.stringify(value);
  const bytes = Buffer.byteLength(text);
  if (bytes > expandedPartBytes)
    throw Error(
      "Expanded code part exceeds 16 MiB; existing versions were preserved.",
    );
  if (bytes < 256 * 1024) return text;
  const packed = JSON.stringify({
    schema: "pymtheg.observed-file/v3",
    encoding: "deflate-raw-base64",
    bytes,
    content: deflateRawSync(Buffer.from(text), { level: 6 }).toString("base64"),
  });
  return Buffer.byteLength(packed) < bytes ? packed : text;
}

export function partExpandedBytes(value: unknown, storedBytes: number): number {
  return value &&
    typeof value === "object" &&
    "schema" in value &&
    value.schema === "pymtheg.observed-file/v3"
    ? compressedSchema.parse(value).bytes
    : storedBytes;
}
const compactSchema = z
  .object({
    schema: z.enum(["pymtheg.observed-file/v2", "pymtheg.observed-file/v4"]),
    file: z.unknown(),
    strings: z.array(z.string()).max(3000000),
    nodes: z
      .array(
        z.tuple([
          index,
          index,
          index,
          index,
          index,
          index,
          index,
          index.nullable(),
          index,
          index.nullable(),
          z.boolean().optional(),
        ]),
      )
      .max(100000),
    edges: z
      .array(
        z.tuple([
          index,
          index.nullable(),
          index,
          index,
          index.nullable(),
          index,
          index,
          index.nullable().optional(),
        ]),
      )
      .max(1000000),
    diagnostics: z.array(z.tuple([index, index, index, index])).max(100000),
  })
  .strict();
/** Dictionary references and tuples remove repeated field keys, paths and symbol IDs. */
export function encodePart(part: Part) {
  const strings: string[] = [],
    ids = new Map<string, number>();
  const intern = (value: string) => {
    const previous = ids.get(value);
    if (previous !== undefined) return previous;
    const id = strings.length;
    strings.push(value);
    ids.set(value, id);
    return id;
  };
  const nodes = part.nodes.map((n) => [
    intern(n.id),
    intern(n.name),
    intern(n.qualifiedName),
    intern(n.kind),
    n.span.start,
    n.span.end,
    intern(n.signature),
    n.declarationHash === hash(n.signature) ? null : intern(n.declarationHash),
    intern(n.body),
    n.bodyHash === null ? null : intern(n.bodyHash),
    ...(n.moduleScoped === undefined ? [] : [n.moduleScoped]),
  ]);
  const edges = part.edges.map((e) => [
    intern(e.from),
    e.to === null ? null : intern(e.to),
    intern(e.targetName),
    intern(e.kind),
    e.targetKind === undefined ? null : intern(e.targetKind),
    e.span.start,
    e.span.end,
    ...(e.importTarget ? [intern(JSON.stringify(e.importTarget))] : []),
  ]);
  const diagnostics = part.diagnostics.map((d) => [
    intern(d.severity),
    intern(d.message),
    d.span.start,
    d.span.end,
  ]);
  return {
    schema: "pymtheg.observed-file/v4",
    file: part.file,
    strings,
    nodes,
    edges,
    diagnostics,
  };
}
/** Legacy parts are preserved; expanded data still goes through the public graph validator. */
export function decodePart(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "schema" in value &&
    value.schema === "pymtheg.observed-file/v3"
  ) {
    const packed = compressedSchema.parse(value);
    let expanded: Buffer;
    try {
      expanded = inflateRawSync(Buffer.from(packed.content, "base64"), {
        maxOutputLength: expandedPartBytes,
      });
    } catch {
      throw Error(
        "Retained code part is invalid or has an expanded size beyond the 16 MiB limit. Re-export a healthy code version.",
      );
    }
    if (expanded.length !== packed.bytes)
      throw Error(
        "Retained code part expanded size does not match its metadata.",
      );
    value = JSON.parse(expanded.toString("utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      !("schema" in value) ||
      !["pymtheg.observed-file/v2", "pymtheg.observed-file/v4"].includes(
        String(value.schema),
      )
    )
      throw Error(
        "Compressed code parts must contain one dictionary part, not nested compression.",
      );
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("schema" in value) ||
    !["pymtheg.observed-file/v2", "pymtheg.observed-file/v4"].includes(
      String(value.schema),
    )
  )
    return value;
  const part = compactSchema.parse(value);
  if (
    part.schema === "pymtheg.observed-file/v2" &&
    part.nodes.some((n) => n[7] === null)
  )
    throw Error(
      "Legacy code dictionary has an invalid declaration hash reference.",
    );
  const string = (id: number) => {
    const value = part.strings[id];
    if (value === undefined)
      throw Error("Retained code dictionary reference is invalid.");
    return value;
  };
  const file = part.file as { path: string };
  const span = (start: number, end: number) => ({
    file: file?.path,
    start,
    end,
  });
  return {
    schema: "pymtheg.observed-file/v1",
    file: part.file,
    nodes: part.nodes.map(
      ([
        id,
        name,
        qualifiedName,
        kind,
        start,
        end,
        signature,
        declarationHash,
        body,
        bodyHash,
        moduleScoped,
      ]) => ({
        id: string(id),
        name: string(name),
        qualifiedName: string(qualifiedName),
        ...(moduleScoped === undefined ? {} : { moduleScoped }),
        kind: string(kind),
        span: span(start, end),
        signature: string(signature),
        declarationHash:
          declarationHash === null
            ? hash(string(signature))
            : string(declarationHash),
        body: string(body),
        bodyHash: bodyHash === null ? null : string(bodyHash),
      }),
    ),
    edges: part.edges.map(
      ([from, to, targetName, kind, targetKind, start, end, importTarget]) => ({
        from: string(from),
        to: to === null ? null : string(to),
        targetName: string(targetName),
        kind: string(kind),
        ...(targetKind === null ? {} : { targetKind: string(targetKind) }),
        ...(importTarget == null
          ? {}
          : { importTarget: JSON.parse(string(importTarget)) }),
        resolution: to === null ? "unresolved" : "resolved",
        span: span(start, end),
      }),
    ),
    diagnostics: part.diagnostics.map(([severity, message, start, end]) => ({
      severity: string(severity),
      message: string(message),
      span: span(start, end),
    })),
  };
}
