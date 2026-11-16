// SPDX-License-Identifier: MIT
/** Bounded display diff; original sources and hashes remain authoritative. */
export interface CodeDifferenceLimits {
  maxCharacters?: number;
  maxLines?: number;
  maxCells?: number;
}
export interface CodeDifferenceRow {
  kind: "context" | "removed" | "added";
  text: string;
  beforeLine: number | null;
  afterLine: number | null;
}
export function codeDifference(
  before: string,
  after: string,
  limits: CodeDifferenceLimits = {},
) {
  const maxCharacters = limits.maxCharacters ?? 12000;
  const maxLines = limits.maxLines ?? 300;
  const maxCells = limits.maxCells ?? 40000;
  if (
    ![maxCharacters, maxLines, maxCells].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    maxCharacters > 12000 ||
    maxLines > 300 ||
    maxCells > 40000
  )
    throw Error("Use positive integer display limits.");
  const split = (text: string) =>
    text ? text.replace(/\r\n?/g, "\n").split("\n") : [];
  const a = split(before),
    b = split(after);
  let prefix = 0,
    endA = a.length,
    endB = b.length,
    comparisons = 0;
  while (prefix < endA && prefix < endB) {
    comparisons++;
    if (a[prefix] !== b[prefix]!) break;
    prefix++;
  }
  while (endA > prefix && endB > prefix) {
    comparisons++;
    if (a[endA - 1] !== b[endB - 1]!) break;
    endA--;
    endB--;
  }
  const cut = (lines: string[]) => {
    const result = [];
    let remaining = maxCharacters,
      truncated = false;
    for (let i = 0; i < lines.length; i++) {
      if (result.length >= maxLines || remaining <= 0) {
        truncated = true;
        break;
      }
      let line = lines[i]!;
      if (line.length > remaining) {
        line = line.slice(0, remaining);
        if (/[\uD800-\uDBFF]$/.test(line)) line = line.slice(0, -1);
        truncated = true;
      }
      result.push(line);
      remaining -= line.length + 1;
    }
    return { lines: result, truncated };
  };
  const left = cut(a.slice(prefix, endA)),
    right = cut(b.slice(prefix, endB));
  const x = left.lines,
    y = right.lines,
    entries: CodeDifferenceRow[] = [];
  let cells = 0,
    coarse = false;
  let displayRemaining = maxCharacters * 2,
    displayClipped = false;
  const add = (
    kind: CodeDifferenceRow["kind"],
    text: string,
    i: number | null,
    j: number | null,
  ) => {
    // Context helps orient a change; it must not consume the change's display budget.
    if (kind === "context" && text.length > 500) {
      text = text.slice(0, 500);
      if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
      displayClipped = true;
    }
    if (displayRemaining <= 0) {
      displayClipped = true;
      return;
    }
    if (text.length > displayRemaining) {
      text = text.slice(0, displayRemaining);
      if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
      displayClipped = true;
    }
    displayRemaining -= text.length + 1;
    entries.push({
      kind,
      text,
      beforeLine: i === null ? null : i + 1,
      afterLine: j === null ? null : j + 1,
    });
  };
  for (let i = Math.max(0, prefix - 2); i < prefix; i++)
    add("context", a[i]!, i, i);
  if ((x.length + 1) * (y.length + 1) > maxCells) {
    coarse = true;
    x.forEach((text, i) => add("removed", text, prefix + i, null));
    y.forEach((text, i) => add("added", text, null, prefix + i));
  } else {
    const width = y.length + 1,
      grid = new Uint16Array((x.length + 1) * width);
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--) {
        cells++;
        grid[i * width + j] =
          x[i] === y[j]!
            ? grid[(i + 1) * width + j + 1]! + 1
            : Math.max(grid[(i + 1) * width + j]!, grid[i * width + j + 1]!);
      }
    let i = 0,
      j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]!) {
        add("context", x[i]!, prefix + i, prefix + j);
        i++;
        j++;
      } else if (
        i < x.length &&
        (j === y.length ||
          grid[(i + 1) * width + j]! >= grid[i * width + j + 1]!)
      ) {
        add("removed", x[i]!, prefix + i, null);
        i++;
      } else {
        add("added", y[j]!, null, prefix + j);
        j++;
      }
    }
  }
  const truncated = left.truncated || right.truncated;
  if (!truncated)
    for (let i = 0; i < Math.min(2, a.length - endA, b.length - endB); i++)
      add("context", a[endA + i]!, endA + i, endB + i);
  const equal =
    before.replace(/\r\n?/g, "\n") === after.replace(/\r\n?/g, "\n");
  const shownBefore = new Set(
    entries
      .filter(
        (e) =>
          e.beforeLine !== null &&
          e.beforeLine > prefix &&
          e.beforeLine <= endA,
      )
      .map((e) => e.beforeLine),
  );
  const shownAfter = new Set(
    entries
      .filter(
        (e) =>
          e.afterLine !== null && e.afterLine > prefix && e.afterLine <= endB,
      )
      .map((e) => e.afterLine),
  );
  return {
    equal,
    lineEndingsDiffer: before !== after && equal,
    lineEndingsNormalized: /\r/.test(before) || /\r/.test(after),
    entries: equal ? [] : entries,
    complete: !truncated && !displayClipped,
    coarse,
    cells,
    comparisons,
    beforeLines: a.length,
    afterLines: b.length,
    omittedBeforeLines: Math.max(0, endA - prefix - shownBefore.size),
    omittedAfterLines: Math.max(0, endB - prefix - shownAfter.size),
  };
}
