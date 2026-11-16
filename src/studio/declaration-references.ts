// SPDX-License-Identifier: MIT
/** Traverse bounded authoring data, never parse or resolve source in the browser. */
export function declarationTypeReferences(value: unknown): Set<string> {
  const pending = [value],
    result = new Set<string>();
  let visited = 0;
  while (pending.length) {
    const item = pending.pop();
    if (++visited > 10000) throw Error("Declaration contains too many fields.");
    if (Array.isArray(item)) {
      pending.push(...item);
      continue;
    }
    if (item && typeof item === "object") {
      const object = item as Record<string, unknown>;
      if (object.kind === "named" && typeof object.symbolId === "string")
        result.add(object.symbolId);
      pending.push(...Object.values(object));
    }
  }
  return result;
}
