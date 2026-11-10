/** A bounded line replacement, not an all-pairs diff. Unchanged prefix/suffix are omitted. */
export function textChange(before: string, after: string, limit = 12000) {
  const previous = before.slice(0, limit).split("\n"),
    current = after.slice(0, limit).split("\n");
  let start = 0,
    endBefore = previous.length,
    endAfter = current.length;
  while (
    start < endBefore &&
    start < endAfter &&
    previous[start] === current[start]
  )
    start++;
  while (
    endBefore > start &&
    endAfter > start &&
    previous[endBefore - 1] === current[endAfter - 1]
  ) {
    endBefore--;
    endAfter--;
  }
  return {
    line: start + 1,
    removed: previous.slice(start, endBefore),
    added: current.slice(start, endAfter),
    truncated: before.length > limit || after.length > limit,
  };
}

/** Display line-ending differences separately from meaningful retained text changes. */
export function linkedTextChange(before: string, after: string, limit = 12000) {
  return {
    ...textChange(
      before.replace(/\r\n?/g, "\n"),
      after.replace(/\r\n?/g, "\n"),
      limit,
    ),
    lineEndingsNormalized: before.includes("\r") || after.includes("\r"),
  };
}
