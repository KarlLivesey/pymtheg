export interface FieldChange {
  path: string;
  before: string;
  after: string;
  truncated: boolean;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** Linear structural comparison, bounded presentation. Arrays remain ordered values. */
export function fieldChanges(before: unknown, after: unknown, limit = 200) {
  const changes: FieldChange[] = [];
  let truncated = false;
  const display = (v: unknown) =>
    v === undefined
      ? "Not present"
      : typeof v === "string"
        ? v
        : JSON.stringify(v, null, 2);
  function visit(a: unknown, b: unknown, path: string) {
    if (a === b) return;
    if (changes.length >= limit) {
      truncated = true;
      return;
    }
    if (object(a) && object(b))
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        visit(
          a[key],
          b[key],
          path + "/" + key.replaceAll("~", "~0").replaceAll("/", "~1"),
        );
    else {
      const left = display(a),
        right = display(b);
      if (left === right) return;
      changes.push({
        path: path || "/",
        before: left.slice(0, 6000),
        after: right.slice(0, 6000),
        truncated: left.length > 6000 || right.length > 6000,
      });
    }
  }
  visit(before, after, "");
  return { changes, truncated };
}
export function changedText(before: string, after: string) {
  const left = before.split("\n"),
    right = after.split("\n");
  let prefix = 0,
    suffix = 0;
  while (
    prefix < left.length &&
    prefix < right.length &&
    left[prefix] === right[prefix]
  )
    prefix++;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - suffix - 1] === right[right.length - suffix - 1]
  )
    suffix++;
  const start = Math.max(0, prefix - 2),
    leftEnd = Math.min(left.length, left.length - suffix + 2),
    rightEnd = Math.min(right.length, right.length - suffix + 2);
  const a = left.slice(start, leftEnd).join("\n"),
    b = right.slice(start, rightEnd).join("\n");
  return {
    startLine: start + 1,
    before: a.slice(0, 12000),
    after: b.slice(0, 12000),
    truncated: a.length > 12000 || b.length > 12000,
  };
}
