import { hash } from "../shared/identity.js";
import { parseArchitectureJson } from "../architecture/json.js";
import type {
  ArchitectureDocument,
  ArchitectureEntity,
} from "../architecture/schema.js";
const administrative = new Set([
  "status",
  "evidence",
  "evidenceRevision",
  "originRevision",
  "linkReviewRevision",
  "linkBaselines",
  "sourceHashes",
  "sourceRoots",
  "sourceExpectations",
  "sourceReviewSnapshot",
  "sourceSelectionSnapshot",
  "sourceSelections",
  "sourceReviewSelection",
]);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function canonical(value: unknown, depth = 0): unknown {
  if (depth > 200) throw Error("Planning intent exceeds 200 levels of nesting");
  if (Array.isArray(value)) return value.map((v) => canonical(v, depth + 1));
  if (object(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k], depth + 1)]),
    );
  return value;
}
/** Parse each native plan document once for a complete comparison page. */
export function implementationPlanHashes(
  documents: readonly ArchitectureDocument[],
) {
  const byPath = new Map(documents.map((d) => [d.path, d]));
  const decoded = new Map<string, unknown>();
  return (entity: ArchitectureEntity): string => {
    if (!entity.planning) return entity.contentHash;
    const document = byPath.get(entity.document);
    if (!document)
      throw Error(
        "Retained plan document is unavailable for intent comparison",
      );
    if (!decoded.has(document.path))
      decoded.set(document.path, parseArchitectureJson(document.text).value);
    let value = decoded.get(document.path);
    for (const part of entity.pointer) {
      if (Array.isArray(value) && typeof part === "number") value = value[part];
      else if (object(value) && Object.hasOwn(value, part)) value = value[part];
      else throw Error("Retained plan identity has an invalid source pointer");
    }
    if (!object(value))
      throw Error("Retained planning record is not an object");
    const intent = Object.fromEntries(
      Object.entries(value).filter(([key]) => !administrative.has(key)),
    );
    if (Array.isArray(intent.links))
      intent.links = intent.links
        .map((v) => canonical(v))
        .sort((a, b) =>
          JSON.stringify(a) < JSON.stringify(b)
            ? -1
            : JSON.stringify(a) > JSON.stringify(b)
              ? 1
              : 0,
        );
    const expectations = new Map<string, Set<string>>();
    const add = (raw: unknown) => {
      if (object(raw))
        for (const [id, v] of Object.entries(raw)) {
          if (typeof v === "string") {
            const set = expectations.get(id) ?? new Set<string>();
            set.add(v);
            expectations.set(id, set);
          }
        }
    };
    if (object(value.sourceRoots) && Object.keys(value.sourceRoots).length)
      for (const root of Object.values(value.sourceRoots)) {
        if (object(root)) add(root.expectations);
      }
    else add(value.sourceExpectations);
    intent.sourceExpectations = Object.fromEntries(
      [...expectations.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, values]) => [id, [...values].sort()]),
    );
    return hash(JSON.stringify(canonical(intent)));
  };
}
