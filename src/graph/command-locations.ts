import type { SqliteGraphStore } from "./store.js";
import type { SourceRange } from "./types.js";
export interface Located {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  locationSource: "stored-snapshot";
  snapshotHash: string;
}
/** Load only source snapshots needed by returned facts/selectors, once per answer. */
export class GraphLocations {
  private readonly files = new Map<
    string,
    { text: string; hash: string; starts: number[] } | null
  >();
  constructor(private readonly store: SqliteGraphStore) {}
  private file(path: string) {
    if (!this.files.has(path)) {
      const snapshot = this.store.fileSnapshot(path);
      if (!snapshot) this.files.set(path, null);
      else {
        const starts = [0];
        for (let i = 0; i < snapshot.text.length; i++) {
          const c = snapshot.text.charCodeAt(i);
          if (c === 13) {
            if (snapshot.text.charCodeAt(i + 1) === 10) i++;
            starts.push(i + 1);
          } else if (c === 10 || c === 0x2028 || c === 0x2029)
            starts.push(i + 1);
        }
        this.files.set(path, { ...snapshot, starts });
      }
    }
    return this.files.get(path) ?? null;
  }
  lineRange(path: string, line: number): SourceRange | null {
    const file = this.file(path);
    if (!file || line > file.starts.length) return null;
    const start = file.starts[line - 1]!;
    let end = file.starts[line] ?? file.text.length;
    while (end > start && /[\r\n\u2028\u2029]/u.test(file.text[end - 1]!))
      end--;
    return { start, end };
  }
  offset(path: string, line: number, column: number): number | null {
    const range = this.lineRange(path, line);
    return range && column <= range.end - range.start + 1
      ? range.start + column - 1
      : null;
  }
  locate(path: string, range: SourceRange): Located {
    const file = this.file(path);
    if (
      !file ||
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end > file.text.length
    )
      throw Error(`Indexed source range unavailable for ${path}`);
    const position = (offset: number) => {
      let low = 0,
        high = file.starts.length;
      while (low + 1 < high) {
        const middle = (low + high) >>> 1;
        if (file.starts[middle]! <= offset) low = middle;
        else high = middle;
      }
      return { line: low + 1, column: offset - file.starts[low]! + 1 };
    };
    const start = position(range.start),
      end = position(range.end);
    return {
      ...start,
      endLine: end.line,
      endColumn: end.column,
      locationSource: "stored-snapshot",
      snapshotHash: file.hash,
    };
  }
}
