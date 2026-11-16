// SPDX-License-Identifier: MIT
import { useEffect, useState } from "react";
import { withdrawalPageSchema } from "../../src/architecture/acknowledgements";
import type { z } from "zod";
import { api } from "./api";
export function BranchWithdrawals({
  id,
  count,
}: {
  id: string;
  count: number;
}) {
  const [open, setOpen] = useState(false),
    [offset, setOffset] = useState(0);
  const [page, setPage] = useState<z.infer<typeof withdrawalPageSchema> | null>(
      null,
    ),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setPage(null);
    setError("");
    void api(
      `architecture/withdrawals?id=${encodeURIComponent(id)}&offset=${offset}`,
      undefined,
      controller.signal,
    )
      .then((raw) => {
        if (!controller.signal.aborted)
          setPage(withdrawalPageSchema.parse(raw));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => controller.abort();
  }, [id, count, open, offset]);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>All withdrawal explanations ({count})</summary>
      <p>
        These reviewers independently withdrew the same acknowledgement. Each
        explanation is retained; none reactivates the review.
      </p>
      {error ? (
        <p role="alert">Could not load withdrawal history: {error}</p>
      ) : !page ? (
        <p role="status">Loading withdrawal explanations…</p>
      ) : (
        <>
          {page.items.map((entry, index) => (
            <article key={offset + index}>
              <p>{entry.reviewer || "Reviewer not recorded"}</p>
              <p>{entry.reason || "No reason recorded"}</p>
              <small>{entry.created || "Date not recorded"}</small>
            </article>
          ))}
          <div>
            {offset > 0 && (
              <button onClick={() => setOffset(Math.max(0, offset - 20))}>
                Previous explanations
              </button>
            )}
            {page.nextOffset !== null && (
              <button onClick={() => setOffset(page.nextOffset!)}>
                Next explanations
              </button>
            )}
          </div>
        </>
      )}
    </details>
  );
}
