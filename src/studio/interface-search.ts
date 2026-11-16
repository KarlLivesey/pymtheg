// SPDX-License-Identifier: MIT
import { compareText } from "../shared/order.js";
export function relativeSource(root: string, file: string): string {
  return file.startsWith(root + "/") ? file.slice(root.length + 1) : file;
}
export function searchInterfaces<T extends { name: string; file: string }>(
  rows: readonly T[],
  query: string,
  root: string,
): T[] {
  const wanted = query.trim().toLowerCase();
  const rank = (name: string) =>
    name.toLowerCase() === wanted
      ? 0
      : name.toLowerCase().startsWith(wanted)
        ? 1
        : 2;
  return rows
    .filter((row) =>
      (row.name + " " + relativeSource(root, row.file))
        .toLowerCase()
        .includes(wanted),
    )
    .sort(
      (a, b) =>
        rank(a.name) - rank(b.name) ||
        compareText(a.name, b.name) ||
        compareText(relativeSource(root, a.file), relativeSource(root, b.file)),
    );
}
