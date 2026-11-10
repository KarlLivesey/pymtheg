import { useState } from "react";
import { api } from "./api";
import {
  documentSchema,
  overviewSchema,
  planSchema,
  planItemSchema,
  type PlanItem,
} from "../../src/architecture/schema";

/** Compare the retained base, current head and local draft; never use the draft as its own base. */
export function ArchitectureConflictReview({
  path,
  recordId,
  itemIndex,
  baseRevision,
  local,
  onChoose,
}: {
  path: string;
  recordId?: string | undefined;
  itemIndex?: number | undefined;
  baseRevision: string;
  local: unknown;
  onChoose: (
    revision: string,
    current: PlanItem | string | null,
    useCurrent: boolean,
  ) => void;
}) {
  const [review, setReview] = useState<{
      revision: string;
      starting: PlanItem | string | null;
      current: PlanItem | string | null;
    } | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [showAll, setShowAll] = useState(false);
  async function load() {
    setLoading(true);
    setError("");
    try {
      const current = overviewSchema.parse(await api("architecture"));
      if (!current.index) throw Error("No current architecture is available");
      async function readValue(revision: string) {
        if (!revision) return null;
        const overview =
          revision === current.index!.id
            ? current
            : overviewSchema.parse(
                await api(
                  "architecture?revision=" + encodeURIComponent(revision),
                ),
              );
        if (!overview.index?.documents.some((d) => d.path === path))
          return null;
        const document = documentSchema.parse(
          await api(
            "architecture/document?revision=" +
              revision +
              "&path=" +
              encodeURIComponent(path),
          ),
        );
        if (recordId === undefined) return document.text;
        const items = planSchema.parse(JSON.parse(document.text)).items;
        return itemIndex === undefined
          ? (items.find((item) => item.id === recordId) ?? null)
          : items[itemIndex]?.id === recordId
            ? items[itemIndex]!
            : null;
      }
      // A positional target identifies a duplicate only within its original document.
      // Never present another occurrence as the record that was being edited.
      if (recordId !== undefined && itemIndex !== undefined) {
        const documents = await Promise.all(
          [baseRevision, current.index.id].map(async (revision) => {
            const doc = documentSchema.parse(
              await api(
                "architecture/document?revision=" +
                  revision +
                  "&path=" +
                  encodeURIComponent(path),
              ),
            );
            return planSchema.parse(JSON.parse(doc.text)).items;
          }),
        );
        const startingItems = documents[0]!,
          currentItems = documents[1]!;
        if (
          startingItems.filter((item) => item.id === recordId).length > 1 ||
          currentItems.filter((item) => item.id === recordId).length > 1
        ) {
          if (
            JSON.stringify(
              startingItems.filter((item) => item.id === recordId),
            ) !==
              JSON.stringify(
                currentItems.filter((item) => item.id === recordId),
              ) ||
            currentItems[itemIndex]?.id !== recordId
          )
            throw Error(
              "These duplicate definitions changed or moved. Your draft is retained. Close this form and reopen the intended current definition before applying it; no positional match was assumed.",
            );
        }
      }
      const [starting, value] = await Promise.all([
        readValue(baseRevision),
        readValue(current.index.id),
      ]);
      setReview({ revision: current.index.id, starting, current: value });
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  }
  const fields = [
    ["title", "Title"],
    ["kind", "Kind"],
    ["owner", "Owner"],
    ["status", "Status"],
    ["detail", "What and why"],
    ["acceptance", "Acceptance check"],
    ["evidence", "Supporting evidence"],
    ["evidenceRevision", "Evidence revision"],
    ["links", "Connections"],
  ] as const;
  const values = review ? [review.starting, review.current, local] : [];
  const readField = (value: unknown, key: string) =>
    value && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : undefined;
  const changedFields = fields.filter(
    ([key]) =>
      key === "title" ||
      showAll ||
      new Set(values.map((value) => JSON.stringify(readField(value, key))))
        .size > 1,
  );
  function render(value: unknown) {
    if (value === null || value === undefined)
      return <p>Not present in this version.</p>;
    const plan = planItemSchema.safeParse(value);
    if (plan.success)
      return (
        <>
          <dl>
            {changedFields.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  {key === "links"
                    ? plan.data.links.length
                      ? plan.data.links.map((link) => (
                          <p key={link.kind + link.target}>
                            {link.kind.replaceAll("-", " ")}: {link.target}
                          </p>
                        ))
                      : "No connections"
                    : String(plan.data[key] || "Not specified")}
                </dd>
              </div>
            ))}
          </dl>
          <details>
            <summary>Complete record</summary>
            <pre>{JSON.stringify(value, null, 2)}</pre>
          </details>
        </>
      );
    return (
      <pre>
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return (
    <section
      className="architecture-conflict-review"
      aria-label="Review conflicting edit"
    >
      <h3>Resolve this edit without losing either version</h3>
      <p>
        Your draft is retained. Compare it with the version you started from and
        the current saved version, then choose which to continue editing. This
        choice does not save anything.
      </p>
      <button
        className="button secondary"
        disabled={loading}
        onClick={() => void load()}
      >
        {loading ? "Loading saved versions…" : "Review current version"}
      </button>
      {error && <p role="alert">{error}</p>}
      {review && (
        <>
          {recordId !== undefined && (
            <label>
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
              />{" "}
              Show unchanged fields too
            </label>
          )}
          <div className="architecture-conflict-columns">
            {[
              ["Starting version", review.starting],
              ["Current stored version", review.current],
              ["Your draft", local],
            ].map(([title, value]) => (
              <section key={String(title)}>
                <h4>{String(title)}</h4>
                {render(value)}
              </section>
            ))}
          </div>
          <p>
            If someone changes the saved version again, Pymtheg will check for
            another conflict when you save.
          </p>
          <button
            className="button primary"
            onClick={() => onChoose(review.revision, review.current, false)}
          >
            Continue with my draft
          </button>
          <button
            className="button secondary"
            disabled={review.current === null}
            onClick={() => onChoose(review.revision, review.current, true)}
          >
            Continue with stored version
          </button>
        </>
      )}
    </section>
  );
}
