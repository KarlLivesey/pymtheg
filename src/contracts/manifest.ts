// SPDX-License-Identifier: MIT
import { z } from "zod";
import { compareText } from "../shared/order.js";
import type { ContractDocument } from "./document.js";
import { portableContractDocument } from "./portable.js";
const entrySchema = z
  .object({
    id: z.string().max(4096),
    contract: z
      .string()
      .max(1024 * 1024)
      .refine((value) => {
        try {
          const parsed: unknown = JSON.parse(value);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return false;
          const pending: { value: unknown; depth: number }[] = [
            { value: parsed, depth: 0 },
          ];
          let nodes = 0;
          while (pending.length) {
            const { value, depth } = pending.pop()!;
            if (++nodes > 100000 || depth > 256) return false;
            if (value && typeof value === "object")
              for (const child of Object.values(value))
                pending.push({ value: child, depth: depth + 1 });
          }
          return true;
        } catch {
          return false;
        }
      }, "Contract entry must contain a JSON object"),
  })
  .strict();
export const contractManifestSchema = z
  .object({
    schema: z.literal("pymtheg.contract-manifest/v1"),
    snapshotId: z.string(),
    entries: z.array(entrySchema).max(100000),
    omitted: z
      .array(
        z
          .object({
            name: z.string(),
            reason: z.string(),
            // Plugin manifests copy document omissions verbatim. Drift still
            // counts every omission as incomplete coverage.
            applicability: z.literal("not-contract-material").optional(),
          })
          .strict(),
      )
      .max(100000),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (
      new Set(manifest.entries.map((e) => e.id)).size !==
      manifest.entries.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Contract manifest contains duplicate identities",
      });
  });
export type ContractManifest = z.infer<typeof contractManifestSchema>;
export function readContractManifest(value: unknown): ContractManifest {
  const checked = contractManifestSchema.safeParse(value);
  if (!checked.success)
    throw Error(
      "Invalid contract baseline: " +
        checked.error.issues
          .slice(0, 3)
          .map(
            (issue) =>
              `${issue.path.join(".") || "manifest"}: ${issue.message}`,
          )
          .join("; "),
    );
  return checked.data;
}

/** Portable declared contracts; positions and implementation bodies do not affect drift. */
export function contractManifest(doc: ContractDocument): ContractManifest {
  doc = portableContractDocument(doc);
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "span")
          .sort(([a], [b]) => compareText(a, b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  return {
    schema: "pymtheg.contract-manifest/v1",
    snapshotId: doc.snapshotId,
    entries: doc.declarations
      .map((d) => {
        const { implementationNotes, ...contract } = d;
        return {
          id: d.symbolId,
          contract: JSON.stringify(
            canonical({
              ...contract,
              notes: contract.notes.filter(
                (note) => !implementationNotes?.includes(note),
              ),
            }),
          ),
        };
      })
      .sort((a, b) => compareText(a.id, b.id)),
    // Baseline format unchanged: every omission stays incomplete coverage for
    // drift and baseline saving, including machines.
    omitted: doc.omitted.map(({ name, reason }) => ({ name, reason })),
  };
}
function contractDelta(before: unknown, after: unknown): string[] {
  const changes: string[] = [];
  const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  function typeName(value: unknown, depth = 0): string | null {
    if (!object(value) || depth > 16) return null;
    if (value.kind === "primitive" && typeof value.name === "string")
      return value.name;
    if (value.kind === "named" && typeof value.symbolId === "string")
      return value.symbolId.split("#").at(-1)!;
    if (value.kind === "list") {
      const element = typeName(value.element, depth + 1);
      if (element) return `List<${element}>`;
    }
    if (value.kind === "result") {
      const ok = typeName(value.ok, depth + 1),
        error = typeName(value.error, depth + 1);
      if (ok && error) return `Result<${ok}, ${error}>`;
    }
    return null;
  }
  function display(value: unknown): string {
    if (value === undefined) return "absent";
    const type = typeName(value);
    if (type) return type;
    if (object(value) && typeof value.name === "string") {
      const type = typeName(value.type ?? value.payload);
      if (type)
        return `${typeof value.mode === "string" && value.mode !== "value" ? value.mode + " " : ""}${value.name}: ${type}`;
    }
    const text = JSON.stringify(value);
    return text.length > 512 ? text.slice(0, 512) + "…" : text;
  }
  const walk = (a: unknown, b: unknown, path: string) => {
    if (changes.length >= 100) return;
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (typeName(a) || typeName(b)) {
      changes.push(
        `${path === "result" ? "Output type" : path}: ${display(a)} → ${display(b)}`,
      );
      return;
    }
    if (
      Array.isArray(a) &&
      Array.isArray(b) &&
      ["fields", "parameters", "variants"].includes(path)
    ) {
      const named = (items: unknown[]) =>
        items.every((v) => object(v) && typeof v.name === "string") &&
        new Set(items.map((v) => (v as { name: string }).name)).size ===
          items.length;
      if (named(a) && named(b)) {
        const before = new Map(
          a.map((v, i) => [
            (v as { name: string }).name,
            { value: v, index: i },
          ]),
        );
        const after = new Map(
          b.map((v, i) => [
            (v as { name: string }).name,
            { value: v, index: i },
          ]),
        );
        const commonBefore = [...before.keys()].filter((n) => after.has(n)),
          commonAfter = [...after.keys()].filter((n) => before.has(n));
        if (JSON.stringify(commonBefore) !== JSON.stringify(commonAfter))
          changes.push(
            `${path === "parameters" ? "Input" : path === "fields" ? "Field" : "Outcome"} order: ${display(commonBefore)} → ${display(commonAfter)}`,
          );
        for (const name of new Set([...before.keys(), ...after.keys()])) {
          const old = before.get(name),
            next = after.get(name);
          const label =
            path === "parameters"
              ? `Input ${(next?.index ?? old!.index) + 1}`
              : `${path === "fields" ? "Field" : "Outcome"} ${name}`;
          walk(old?.value, next?.value, label);
        }
        return;
      }
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const item = a[i] ?? b[i];
        const name =
          object(item) && typeof item.name === "string"
            ? item.name
            : String(i + 1);
        const label =
          path === "parameters"
            ? `Input ${i + 1}`
            : `${path === "fields" ? "Field" : "Outcome"} ${name}`;
        walk(a[i], b[i], label);
      }
      return;
    }
    if (
      a &&
      b &&
      typeof a === "object" &&
      typeof b === "object" &&
      Array.isArray(a) === Array.isArray(b)
    ) {
      const left = a as Record<string, unknown>,
        right = b as Record<string, unknown>;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
        walk(left[key], right[key], path ? path + " " + key : key);
    } else changes.push(`${path}: ${display(a)} → ${display(b)}`);
  };
  walk(before, after, "");
  return changes;
}
export function compareContractManifests(
  previous: unknown,
  current: ContractManifest,
) {
  const before = readContractManifest(previous),
    after = readContractManifest(current);
  const key = (entry: ContractManifest["entries"][number]) => {
    const value = JSON.parse(entry.contract) as Record<string, unknown>;
    return typeof value.name === "string" && typeof value.kind === "string"
      ? value.kind + ":" + value.name
      : null;
  };
  const groups = (entries: ContractManifest["entries"]) => {
    const out = new Map<string, string[]>();
    for (const e of entries) {
      const k = key(e);
      if (k) {
        const ids = out.get(k) ?? [];
        ids.push(e.id);
        out.set(k, ids);
      }
    }
    return out;
  };
  const previousGroups = groups(before.entries),
    currentGroups = groups(after.entries);
  const previousIds = new Set(before.entries.map((e) => e.id));
  const nextIds = new Set(after.entries.map((e) => e.id)),
    renames = new Map<string, string>();
  for (const e of before.entries) {
    if (nextIds.has(e.id)) continue;
    const k = key(e);
    if (!k) continue;
    const candidates = currentGroups.get(k);
    if (
      previousGroups.get(k)?.length === 1 &&
      candidates?.length === 1 &&
      !previousIds.has(candidates[0]!)
    )
      renames.set(e.id, candidates[0]!);
  }
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          k === "symbolId" && typeof v === "string"
            ? (renames.get(v) ?? v)
            : canonical(v),
        ]),
      );
    return value;
  };
  const old = new Map(
      before.entries.map((e) => [
        renames.get(e.id) ?? e.id,
        JSON.stringify(canonical(JSON.parse(e.contract))),
      ]),
    ),
    next = new Map(after.entries.map((e) => [e.id, e.contract]));
  const added = before.omitted.length
      ? []
      : after.entries.filter((e) => !old.has(e.id)).map((e) => e.id),
    removed = after.omitted.length
      ? []
      : before.entries
          .filter((e) => !next.has(renames.get(e.id) ?? e.id))
          .map((e) => e.id),
    changed = after.entries
      .filter((e) => old.has(e.id) && old.get(e.id) !== e.contract)
      .map((e) => ({
        id: e.id,
        before: old.get(e.id)!,
        after: e.contract,
        details: contractDelta(
          JSON.parse(old.get(e.id)!),
          JSON.parse(e.contract),
        ),
      }));
  return {
    schema: "pymtheg.contract-drift/v1" as const,
    added,
    removed,
    changed,
    moved: [...renames].map(([before, after]) => ({ before, after })),
    incomplete: [
      ...after.omitted,
      ...before.omitted.map((item) => ({
        ...item,
        reason: "Saved baseline has incomplete coverage: " + item.reason,
      })),
    ],
    matches:
      !added.length &&
      !removed.length &&
      !changed.length &&
      !after.omitted.length &&
      !before.omitted.length,
  };
}
