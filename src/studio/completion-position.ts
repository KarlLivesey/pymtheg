import { ChangeSet, Text } from "@codemirror/state";
import type { SymbolView } from "./protocol.js";

export interface CompletionSite {
  offset: number;
  changes: { from: number; to: number }[];
}
/** Bounded, persistent-document history. Never guess a mapping after eviction. */
export class CompletionPositions {
  private baseline: { source: string; doc: Text } | undefined;
  private steps: {
    before: Text;
    after: Text;
    changes: ChangeSet;
    structural: boolean;
  }[] = [];
  record(before: Text, after: Text, changes: ChangeSet): void {
    let structural = false;
    changes.iterChanges((from, to, _a, _b, inserted) => {
      if (
        /[{}]/.test(before.sliceString(from, to)) ||
        /[{}]/.test(inserted.toString())
      )
        structural = true;
    });
    this.steps.push({ before, after, changes, structural });
    if (this.steps.length > 128) this.steps.shift();
  }
  site(
    checked: string | undefined,
    current: Text,
    offset: number,
  ): CompletionSite | undefined {
    if (checked === undefined) return undefined;
    if (this.baseline?.source !== checked)
      this.baseline = { source: checked, doc: Text.of(checked.split("\n")) };
    const baseline = this.baseline.doc;
    if (current.eq(baseline)) return { offset, changes: [] };
    const start = this.steps.findLastIndex((step) => step.before.eq(baseline));
    if (start < 0) return undefined;
    let composed = ChangeSet.empty(this.steps[start]!.before.length);
    for (let i = start; i < this.steps.length; i++) {
      const step = this.steps[i]!;
      if (
        step.structural ||
        (i > start && !this.steps[i - 1]!.after.eq(step.before))
      )
        return undefined;
      composed = composed.compose(step.changes);
    }
    if (!this.steps.at(-1)!.after.eq(current)) return undefined;
    const changes: CompletionSite["changes"] = [];
    composed.iterChangedRanges((from, to) => changes.push({ from, to }));
    return { offset: composed.invertedDesc.mapPos(offset, -1), changes };
  }
}
export function completionCaller(
  symbols: SymbolView[],
  file: string,
  site: CompletionSite | undefined,
): SymbolView | undefined {
  if (!site) return undefined;
  return symbols.find(
    (symbol) =>
      symbol.callable &&
      symbol.span.file === file &&
      symbol.span.start <= site.offset &&
      site.offset < symbol.span.end &&
      symbol.headerEnd !== undefined &&
      !site.changes.some(
        (change) =>
          change.from <= symbol.headerEnd! && change.to >= symbol.span.start,
      ),
  );
}
