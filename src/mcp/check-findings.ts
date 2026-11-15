import type { Report } from "../reporting/report.js";
import { findingPresenter } from "../reporting/explain.js";
import { interfaceOutput } from "./identities.js";
/** First-page presentation only. The immutable full diagnostics remain in read_run. */
export function firstFindings(root: string, report: Report) {
  let clipped = false;
  const text = (v: unknown, limit: number) => {
    const s = String(v ?? "");
    if (s.length <= limit) return s;
    clipped = true;
    let end = limit;
    if (
      /[\uD800-\uDBFF]/.test(s[end - 1] ?? "") &&
      /[\uDC00-\uDFFF]/.test(s[end] ?? "")
    )
      end--;
    return s.slice(0, end) + "… [read_run for full finding]";
  };
  const items: Record<string, unknown>[] = [];
  const present = findingPresenter(report);
  for (const diagnostic of report.diagnostics.slice(0, 10)) {
    const full = interfaceOutput(
      root,
      present(diagnostic) as unknown as Record<string, unknown>,
    ) as Record<string, any>;
    const location = (l: Record<string, any>) => ({
      file: l.file,
      start: l.start,
      end: l.end,
      line: l.line,
      column: l.column,
      excerpt: l.excerpt === null ? null : text(l.excerpt, 200),
    });
    if (full.relatedLocations.length > 2) clipped = true;
    const item = {
      code: full.code,
      severity: full.severity,
      title: text(full.title, 160),
      message: text(full.message, 800),
      why: text(full.why, 400),
      nextStep: text(full.nextStep, 400),
      evidenceNote: text(full.evidenceNote, 300),
      location: location(full.location),
      relatedLocations: full.relatedLocations.slice(0, 2).map(location),
      relatedLocationCount: full.relatedLocations.length,
    };
    if (Buffer.byteLength(JSON.stringify([...items, item])) > 32768) break;
    items.push(item);
  }
  return {
    items,
    total: report.diagnostics.length,
    offset: 0,
    limit: 10,
    nextOffset: items.length < report.diagnostics.length ? items.length : null,
    truncated: clipped || items.length < report.diagnostics.length,
    previewClipped: clipped,
    fullFindings:
      "For full text use read_run section=findings offset=0 with this runId; for additional findings continue at nextOffset.",
  };
}
