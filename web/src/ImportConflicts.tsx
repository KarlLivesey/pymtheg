import { useState } from "react";
import type { z } from "zod";
import type {
  importConflictSchema,
  importResolutionSchema,
} from "../../src/architecture/schema";
type Conflict = z.infer<typeof importConflictSchema>;
type Resolution = z.infer<typeof importResolutionSchema>;
function Version({ text, side }: { text: string | null; side: string }) {
  return (
    <>
      <pre>
        {text === null ? "Document absent or removed" : text.slice(0, 32768)}
      </pre>
      {text !== null && text.length > 32768 && (
        <p>
          Preview shows the first 32,768 characters. Download the complete
          version to review it.
        </p>
      )}
      {text !== null && (
        <button
          type="button"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([text], { type: "text/plain" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = `conflict-${side}.txt`;
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download full {side} version
        </button>
      )}
    </>
  );
}
export function ImportConflicts({
  conflicts,
  busy,
  onReview,
}: {
  conflicts: Conflict[];
  busy: boolean;
  onReview: (choices: Resolution[]) => void;
}) {
  const [choices, setChoices] = useState<Record<string, Resolution["choice"]>>(
    {},
  );
  return (
    <section aria-label="Resolve import conflicts">
      <h3>Review {conflicts.length} conflicting documents</h3>
      <p>
        Nothing has been saved. Choose what to keep for each document, then
        review the updated import.
      </p>
      {conflicts.map((conflict) => (
        <article key={conflict.path}>
          <h4>{conflict.path}</h4>
          <p>{conflict.reason}</p>
          <details>
            <summary>Your current version</summary>
            <Version text={conflict.local} side="current" />
          </details>
          <details>
            <summary>Incoming version</summary>
            <Version text={conflict.incoming} side="incoming" />
          </details>
          <label>
            Keep which version of {conflict.path}?
            <select
              value={choices[conflict.path] ?? ""}
              onChange={(e) =>
                setChoices({
                  ...choices,
                  [conflict.path]: e.target.value as Resolution["choice"],
                })
              }
            >
              <option value="">Choose after reviewing</option>
              {conflict.choices.map((choice) => (
                <option key={choice} value={choice}>
                  {
                    {
                      "keep-local": "Keep my current version",
                      "take-incoming":
                        "Use incoming version (or remove if deleted)",
                      "keep-both": "Keep both as separate documents",
                    }[choice]
                  }
                </option>
              ))}
            </select>
          </label>
          {choices[conflict.path] === "keep-both" && (
            <p>
              Your current document stays as a local fork. Later source
              refreshes update the separate incoming copy. Existing plan links
              stay on your local copy. Needs attention will flag upstream
              changes for those plans until you review them.
            </p>
          )}
        </article>
      ))}
      <button
        className="button primary"
        disabled={busy || conflicts.some((c) => !choices[c.path])}
        onClick={() =>
          onReview(
            conflicts.map((c) => ({
              path: c.path,
              localHash: c.localHash,
              incomingHash: c.incomingHash,
              choice: choices[c.path]!,
            })),
          )
        }
      >
        Review resolved import
      </button>
    </section>
  );
}
