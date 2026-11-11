import { linkedTextChange } from "../../src/architecture/text-change";
import { relationshipText } from "../../src/architecture/relationship-text";
import { useEffect, useState } from "react";
import { z } from "zod";
import { entitySchema } from "../../src/architecture/schema";
import { api } from "./api";
const recordSchema = z.object({ entity: entitySchema, data: z.unknown() });
type TargetRecord = z.infer<typeof recordSchema>;
/** Fetch only an opened target, using the retained revision rather than current paths. */
export function LinkedTargetComparison({
  target,
  beforeTarget,
  before,
  after,
  label,
  initiallyOpen = false,
}: {
  target: string;
  beforeTarget?: string | undefined;
  before?: string | undefined;
  after: string;
  /** What the earlier revision is, e.g. "reviewed version" or "version when this link was added". */
  label: string;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [records, setRecords] = useState<{
    before: TargetRecord | null;
    after: TargetRecord | null;
  }>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setRecords(undefined);
    setError("");
    const load = async (revision: string | undefined, id: string) => {
      if (!revision) return null;
      try {
        return recordSchema.parse(
          await api(
            `architecture/record?revision=${encodeURIComponent(revision)}&id=${encodeURIComponent(id)}`,
            undefined,
            controller.signal,
          ),
        );
      } catch (error) {
        if (error instanceof Error && "status" in error && error.status === 404)
          return null;
        throw error;
      }
    };
    void Promise.all([
      load(before, beforeTarget ?? target),
      load(after, target),
    ])
      .then(([before, after]) => {
        if (!controller.signal.aborted) setRecords({ before, after });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => controller.abort();
  }, [open, target, beforeTarget, before, after]);
  const show = (record: TargetRecord | null, previous: boolean) => {
    if (!record)
      return (
        <p>
          {previous
            ? before
              ? `No retained target at the ${label}.`
              : "No earlier revision is recorded for this link."
            : "Target is missing from this revision. Repair the link before accepting it."}
        </p>
      );
    const text =
      typeof record.data === "string"
        ? record.data
        : (JSON.stringify(record.data, null, 2) ?? "");
    return (
      <>
        <p>
          {record.entity.name} · <code>{record.entity.document}</code>
        </p>
        <pre>{text.slice(0, 12000)}</pre>
        {text.length > 12000 && (
          <p>
            Excerpt: first 12,000 characters. The full document remains in this
            saved revision.
          </p>
        )}
      </>
    );
  };
  const previousText =
    typeof records?.before?.data === "string" ? records.before.data : "";
  const currentText =
    typeof records?.after?.data === "string" ? records.after.data : "";
  const changes = linkedTextChange(previousText, currentText);
  const formattingOnly =
    previousText !== currentText &&
    relationshipText(previousText) === relationshipText(currentText);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="linked-target-comparison"
    >
      <summary>Compare linked target with {label}</summary>
      {error ? (
        <p role="alert">Could not load the comparison: {error}</p>
      ) : !records ? (
        <p role="status">Loading retained versions…</p>
      ) : (
        <>
          {formattingOnly && (
            <p>
              Only prose formatting or line endings changed. Evidence still
              refers to its exact saved source.
            </p>
          )}
          {!formattingOnly && changes.lineEndingsNormalized && (
            <p>
              Line endings are normalized below; original text is preserved in
              each saved revision.
            </p>
          )}
          {!formattingOnly &&
            (changes.removed.length > 0 || changes.added.length > 0) && (
              <section aria-label="Changed lines">
                <h3>Changed lines, starting at {changes.line}</h3>
                <pre>
                  {changes.removed.map((line, i) => (
                    <span className="diff-removed" key={`old-${i}`}>
                      {"− " + line + "\n"}
                    </span>
                  ))}
                  {changes.added.map((line, i) => (
                    <span className="diff-added" key={`new-${i}`}>
                      {"+ " + line + "\n"}
                    </span>
                  ))}
                </pre>
                {changes.truncated && (
                  <p>
                    Comparison limited to the first 12,000 characters of each
                    version.
                  </p>
                )}
              </section>
            )}
          <div className="plan-form-grid">
            <section aria-label="Previously reviewed target">
              <h3>Previously reviewed</h3>
              {show(records.before, true)}
            </section>
            <section aria-label="Current linked target">
              <h3>Current target</h3>
              {show(records.after, false)}
            </section>
          </div>
        </>
      )}
    </details>
  );
}
