// SPDX-License-Identifier: MIT

// An incomplete lookup can replay only while its cycle tests give the same
// answers. A trace records the ancestor tests the evaluation actually used.
const reusableEntries = 16_384;
const traceLimit = 256;
export const lookupDepth = 128;
export type ImportExpansion = { key: string; length: number };

export class LookupTrace {
  readonly required = new Set<string>();
  readonly excluded = new Set<string>();
  readonly suffixes = new Map<string, number>();
  readonly shorterSuffixes = new Map<string, number>();
  depth = 0;
  valid = true;

  fits(): boolean {
    return (
      this.valid &&
      this.required.size +
        this.excluded.size +
        this.suffixes.size +
        this.shorterSuffixes.size <=
        traceLimit
    );
  }

  requireSuffix(key: string, length: number) {
    if (length > 0)
      this.suffixes.set(key, Math.max(this.suffixes.get(key) ?? 0, length));
  }

  requireShorterSuffix(key: string, length: number) {
    this.shorterSuffixes.set(
      key,
      Math.min(this.shorterSuffixes.get(key) ?? Infinity, length),
    );
  }

  absorb(child: LookupTrace, expansion?: ImportExpansion) {
    if (!this.valid) return;
    if (!child.valid) {
      this.valid = false;
      return;
    }
    this.depth = Math.max(this.depth, child.depth + 1);
    for (const key of child.required) this.required.add(key);
    for (const key of child.excluded) this.excluded.add(key);
    for (const [key, length] of child.suffixes) this.requireSuffix(key, length);
    for (const [key, length] of child.shorterSuffixes)
      if (key !== expansion?.key || expansion.length >= length)
        this.requireShorterSuffix(key, length);
    this.valid = this.fits();
  }

  matches(seen: Set<string>, expansions: Map<string, number[]>): boolean {
    if (seen.size + this.depth > lookupDepth) return false;
    for (const key of this.required) if (!seen.has(key)) return false;
    for (const key of seen) if (this.excluded.has(key)) return false;
    for (const [key, length] of this.suffixes) {
      if (expansions.get(key)?.some((active) => active < length)) return false;
    }
    for (const [key, length] of this.shorterSuffixes) {
      if (!expansions.get(key)?.some((active) => active < length)) return false;
    }
    return true;
  }
}

type Entry<T> = { result: T; cut: boolean; trace: LookupTrace };

export class LookupMemo<T> {
  private readonly entries = new Map<string, Entry<T>[]>();

  get(key: string, seen: Set<string>, expansions: Map<string, number[]>) {
    return this.entries
      .get(key)
      ?.find((entry) => entry.trace.matches(seen, expansions));
  }

  set(key: string, entry: Entry<T>) {
    const variants = this.entries.get(key);
    if (variants) {
      if (variants.length === 4) variants.shift();
      variants.push(entry);
    } else {
      if (this.entries.size === reusableEntries)
        this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(key, [entry]);
    }
  }

  clear() {
    this.entries.clear();
  }
}
