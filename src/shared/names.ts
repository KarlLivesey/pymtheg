// SPDX-License-Identifier: MIT
import { identity } from "./identity-values.js";
const reserved = new Set(
  "true false unit Bool Int Nat String Unit List Result flow rule op type resource machine import if else for in retry on cancel return call let match assert unknown own transition move take borrow effects requires ensures bound budget overhead cost states initial terminal state event invariant when stable atomic protocol submit outcome creates settles".split(
    " ",
  ),
);
export function identifierProblem(name: string): string | null {
  if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name))
    return "Use a name starting with a letter or underscore, followed by letters, numbers or underscores.";
  return reserved.has(name)
    ? `“${name}” is reserved by the language. Choose a descriptive name such as “quantity” or “calculateQuote”.`
    : null;
}
export function unusedSourceName(
  preferred: string,
  existing: readonly string[],
): string {
  const used = new Set(existing);
  if (!used.has(preferred)) return preferred;
  const base = preferred.endsWith(identity.extension)
    ? preferred.slice(0, -identity.extension.length)
    : preferred;
  let suffix = 2;
  while (used.has(`${base}-${suffix}${identity.extension}`)) suffix++;
  return `${base}-${suffix}${identity.extension}`;
}
/** Bounded spelling hint only; never resolves a missing identifier. */
export function nearbyName(
  name: string,
  candidates: Iterable<string>,
  limit = 128,
): string | null {
  if (name.length > 64) return null;
  let best: string | null = null,
    distance = 3,
    seen = 0,
    tied = false;
  for (const candidate of candidates) {
    if (++seen > limit) break;
    if (candidate.length > 64 || Math.abs(candidate.length - name.length) > 2)
      continue;
    let row = Array.from({ length: candidate.length + 1 }, (_, i) => i);
    for (let i = 0; i < name.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < candidate.length; j++)
        next.push(
          Math.min(
            next[j]! + 1,
            row[j + 1]! + 1,
            row[j]! + (name[i] === candidate[j] ? 0 : 1),
          ),
        );
      row = next;
    }
    const current = row[candidate.length]!;
    if (current < distance) {
      best = candidate;
      distance = current;
      tied = false;
    } else if (current === distance && candidate !== best) tied = true;
  }
  return !tied && distance <= 2 ? best : null;
}
