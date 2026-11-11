import {
  newPlanItem,
  resolveArchitectureTarget,
} from "../../src/architecture/planning";
import { useState, useEffect, useRef } from "react";
import { LinkedTargetComparison } from "./LinkedTargetComparison";
import { SourcePlanLinks } from "./SourcePlanLinks";
import { ArchitectureConflictReview } from "./ArchitectureConflictReview";
import { api, ApiError } from "./api";
import {
  linkComparisonBase,
  planItemSchema,
  indexSchema,
  type PlanItem,
  type ArchitectureEntity,
} from "../../src/architecture/schema";

export function PlanEditor({
  revision,
  entitiesRevision,
  revisions,
  entities,
  initial,
  targetRecord,
  onSaved,
  onCancel,
  onDraft,
  onBaseChanged,
  onOpenSource,
}: {
  revision: string;
  entitiesRevision: string;
  revisions: { id: string; label: string; created: string }[];
  entities: ArchitectureEntity[];
  initial?: PlanItem | undefined;
  targetRecord?:
    | { document: string; originalId: string; itemIndex?: number | undefined }
    | undefined;
  onSaved: (id: string) => Promise<void>;
  onCancel: () => void;
  onDraft: (item: PlanItem) => void;
  onBaseChanged: (revision: string) => void;
  onOpenSource?: ((file: string) => void) | undefined;
}) {
  const [item, setItem] = useState<PlanItem>(
    initial ?? newPlanItem(crypto.randomUUID()),
  );
  const initialItem = useRef(JSON.stringify(item));
  const hasEdited = useRef(false);
  const [conflict, setConflict] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [replacementTargets, setReplacementTargets] = useState<
    Record<number, string>
  >({});
  const [previousTargets, setPreviousTargets] = useState<
    Record<number, string>
  >({});
  const [revisionQuery, setRevisionQuery] = useState("");
  const matchingRevisions = revisions
    .filter((r) =>
      (r.label + " " + r.created + " " + r.id)
        .toLowerCase()
        .includes(revisionQuery.toLowerCase()),
    )
    .slice(0, 50);
  const evidenceRevision = revisions.find(
    (r) => r.id === item.evidenceRevision,
  );
  if (
    evidenceRevision &&
    !matchingRevisions.some((r) => r.id === evidenceRevision.id)
  )
    matchingRevisions.unshift(evidenceRevision);
  const [target, setTarget] = useState(""),
    [relation, setRelation] =
      useState<PlanItem["links"][number]["kind"]>("depends-on"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (JSON.stringify(item) !== initialItem.current) hasEdited.current = true;
    if (!hasEdited.current) return;
    onDraft(item);
  }, [item, revision, targetRecord]);
  const editing = !!targetRecord;
  const idConflict =
    !editing &&
    entities.some(
      (e) => e.id === "plan:" + item.id || e.conflictOf === "plan:" + item.id,
    );
  const change = (field: keyof PlanItem, value: unknown) =>
    setItem((old) => ({ ...old, [field]: value }));
  return (
    <section
      className="architecture-import"
      aria-label="Planning record"
      inert={busy}
      aria-busy={busy}
    >
      <h2>
        {editing ? "Edit planning record" : "What does this design need?"}
      </h2>
      <p>
        Keep one requirement, decision or open question here. Link it to the
        parts it affects. Saving keeps the previous revision.
      </p>
      {item.originRevision && (
        <p>
          Proposal based on stored revision{" "}
          <code>{item.originRevision.slice(0, 12)}</code>. Saving this decision
          leaves the imported contract unchanged.
        </p>
      )}
      <details>
        <summary>Record identity</summary>
        <p>
          Links use this ID. Changing it does not silently redirect existing
          links.
        </p>
        <label>
          Record ID
          <input
            className="text-input"
            value={item.id}
            maxLength={120}
            onChange={(e) => change("id", e.target.value)}
          />
        </label>
      </details>
      <div className="plan-form-grid">
        <label>
          Kind
          <select
            aria-label="Kind"
            value={item.kind}
            onChange={(e) => change("kind", e.target.value)}
          >
            {[
              "requirement",
              "decision",
              "risk",
              "component",
              "milestone",
              "test",
              "evidence",
            ].map((k) => (
              <option key={k} value={k}>
                {k.replaceAll("-", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            aria-label="Status"
            value={item.status}
            onChange={(e) => change("status", e.target.value)}
          >
            {[
              "proposed",
              "accepted",
              "in-progress",
              "implemented",
              "reviewed",
              "superseded",
            ].map((k) => (
              <option key={k} value={k}>
                {k.replaceAll("-", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Short title
          <input
            className="text-input"
            autoFocus
            value={item.title}
            onChange={(e) => change("title", e.target.value)}
          />
        </label>
        <label>
          Owner or team
          <input
            className="text-input"
            value={item.owner}
            onChange={(e) => change("owner", e.target.value)}
          />
        </label>
      </div>
      <label>
        What and why
        <textarea
          aria-label="What and why"
          rows={3}
          value={item.detail}
          onChange={(e) => change("detail", e.target.value)}
          placeholder="Describe the intended behaviour, reason or question."
        />
      </label>
      <label>
        How will we know it is done?
        <textarea
          aria-label="How will we know it is done?"
          rows={2}
          value={item.acceptance}
          onChange={(e) => change("acceptance", e.target.value)}
          placeholder="Describe an observable result or acceptance check."
        />
      </label>
      <fieldset>
        <legend>Link to another planning record or document</legend>
        <p>
          For a source component, use “Connect to a checked component” below.
        </p>
        <select
          aria-label="Relationship"
          value={relation}
          onChange={(e) => setRelation(e.target.value as typeof relation)}
        >
          {[
            "depends-on",
            "satisfies",
            "tests",
            "implements",
            "supersedes",
            "supports",
          ].map((r) => (
            <option key={r} value={r}>
              {r.replaceAll("-", " ")}
            </option>
          ))}
        </select>
        <input
          className="text-input"
          aria-label="Planning record or document"
          list="architecture-record-targets"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Find a planning record or document"
        />
        <datalist id="architecture-record-targets">
          {entities
            .filter((e) => e.kind !== "owner" && !e.id.startsWith("source:"))
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </datalist>
        <button
          className="button secondary"
          disabled={!target.trim()}
          onClick={() => {
            if (target.trim().startsWith("source:")) {
              setError(
                "Use Connect to a checked component below to select current source.",
              );
              return;
            }
            const resolved = resolveArchitectureTarget(entities, target);
            if (!resolved.ok) {
              setError(resolved.message);
              return;
            }
            if (
              !item.links.some(
                (link) => link.kind === relation && link.target === resolved.id,
              )
            )
              change("links", [
                ...item.links,
                { kind: relation, target: resolved.id },
              ]);
            setTarget("");
            setError("");
          }}
        >
          Add link
        </button>
        {item.links.some((link) => !link.target.startsWith("source:")) && (
          <section aria-label="Review linked targets">
            <p>
              Check that the linked records below still describe the decisions
              you intended. Review the current titles and content; this does not
              verify their correctness or evidence.
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={() => change("linkReviewRevision", entitiesRevision)}
            >
              I reviewed these linked targets
            </button>
            {item.linkReviewRevision === entitiesRevision && (
              <p>
                Linked targets reviewed against this displayed version. Save the
                record to keep this acknowledgement.
              </p>
            )}
          </section>
        )}
        {item.links.map((link, i) => (
          <div key={i}>
            <p>
              {link.kind} ·{" "}
              {(() => {
                const target = entities.find((e) => e.id === link.target);
                if (link.target.startsWith("source:")) {
                  const separator = link.target.lastIndexOf("#");
                  return `${link.target.slice(separator + 1)} · ${link.target.slice(7, separator)}`;
                }
                return target
                  ? `${target.name} · ${target.document}`
                  : link.target;
              })()}{" "}
              <button
                className="text-link"
                aria-label={"Remove link " + (i + 1)}
                onClick={() =>
                  change(
                    "links",
                    item.links.filter((_, j) => i !== j),
                  )
                }
              >
                Remove
              </button>
            </p>
            {!link.target.startsWith("source:") && (
              <details>
                <summary>Choose a different target for this link</summary>
                <p>
                  Compare the old and new target before saving. This changes
                  only this plan’s link.
                </p>
                <input
                  className="text-input"
                  aria-label={`Replacement target for link ${i + 1}`}
                  list="architecture-record-targets"
                  value={replacementTargets[i] ?? ""}
                  onChange={(e) =>
                    setReplacementTargets((old) => ({
                      ...old,
                      [i]: e.target.value,
                    }))
                  }
                />
                <button
                  className="button secondary"
                  disabled={!replacementTargets[i]?.trim()}
                  onClick={() => {
                    const resolved = resolveArchitectureTarget(
                      entities,
                      replacementTargets[i]!,
                    );
                    if (!resolved.ok) {
                      setError(resolved.message);
                      return;
                    }
                    setPreviousTargets((old) => ({
                      ...old,
                      [i]: old[i] ?? link.target,
                    }));
                    change(
                      "links",
                      item.links.map((entry, j) =>
                        j === i ? { ...entry, target: resolved.id } : entry,
                      ),
                    );
                    setError("");
                  }}
                >
                  Replace link {i + 1}
                </button>
              </details>
            )}
            {!link.target.startsWith("source:") && (
              <LinkedTargetComparison
                beforeTarget={previousTargets[i]}
                target={link.target}
                before={linkComparisonBase(item, link.target).revision}
                after={entitiesRevision}
                initiallyOpen={item.links.length === 1}
              />
            )}
          </div>
        ))}
        <SourcePlanLinks
          item={item}
          revision={entitiesRevision}
          onChange={setItem}
          onOpenSource={onOpenSource}
          onBusyChange={setSourceBusy}
        />
      </fieldset>
      <details>
        <summary>Record supporting evidence</summary>
        <p>
          Status is your recorded claim. Pymtheg does not automatically prove
          it. Identify the source and the exact revision checked.
        </p>
        <label>
          Evidence or review notes
          <textarea
            aria-label="Evidence or review notes"
            rows={3}
            value={item.evidence}
            onChange={(e) => change("evidence", e.target.value)}
          />
        </label>
        {revisions.length > 50 && (
          <label>
            Find an evidence revision
            <input
              value={revisionQuery}
              onChange={(e) => setRevisionQuery(e.target.value)}
              placeholder="Revision name or date"
            />
          </label>
        )}
        <label>
          Revision the evidence concerns
          <select
            aria-label="Revision the evidence concerns"
            value={item.evidenceRevision}
            onChange={(e) => change("evidenceRevision", e.target.value)}
          >
            <option value="">Choose a saved revision</option>
            {item.evidenceRevision && !evidenceRevision && (
              <option value={item.evidenceRevision}>
                Unavailable saved revision ·{" "}
                {item.evidenceRevision.slice(0, 12)}
              </option>
            )}
            {matchingRevisions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} · {r.created} · {r.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        {evidenceRevision && (
          <p>
            Evidence concerns “{evidenceRevision.label}”, saved{" "}
            {evidenceRevision.created}.
          </p>
        )}
        <button
          className="text-link"
          onClick={() => change("evidenceRevision", entitiesRevision)}
        >
          Use currently viewed revision
        </button>
      </details>
      {idConflict && (
        <p role="alert">
          This record ID already exists. Choose another ID for the new record.
          Changing this field never loads an existing record.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {conflict && (
        <ArchitectureConflictReview
          path={targetRecord?.document ?? "architecture/plan.json"}
          recordId={targetRecord?.originalId ?? item.id}
          itemIndex={targetRecord?.itemIndex}
          baseRevision={revision}
          local={item}
          onChoose={(revision, current, useCurrent) => {
            onBaseChanged(revision);
            if (useCurrent && current && typeof current !== "string")
              setItem(current);
            setError("");
            setConflict(false);
          }}
        />
      )}

      <button
        className="button primary"
        disabled={
          busy ||
          sourceBusy ||
          idConflict ||
          !item.id.trim() ||
          !item.title.trim() ||
          !item.owner.trim()
        }
        onClick={() => {
          if (target.trim()) {
            setError(
              "There is an unfinished link. Choose Add link, or clear its target, before saving this record.",
            );
            return;
          }
          setBusy(true);
          setError("");
          void api("architecture/plan", {
            revision,
            target: targetRecord,
            item: planItemSchema.parse(item),
            label: (editing ? "Update: " : "Add: ") + item.title.slice(0, 140),
          })
            .then((raw) => {
              const saved = indexSchema.parse(raw),
                entity = saved.entities.find(
                  (e) =>
                    (e.id === "plan:" + item.id ||
                      e.conflictOf === "plan:" + item.id) &&
                    e.document ===
                      (targetRecord?.document ?? "architecture/plan.json"),
                );
              if (!entity)
                throw Error(
                  "Saved record is not present in the returned revision",
                );
              return onSaved(entity.id);
            })
            .catch((e) => {
              setError(String(e));
              if (
                e instanceof ApiError &&
                e.status === 409 &&
                e.conflictKind !== "request"
              )
                setConflict(true);
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Saving record…" : "Save planning record"}
      </button>
      <button className="button secondary" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
