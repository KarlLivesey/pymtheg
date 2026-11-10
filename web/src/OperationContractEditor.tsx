import { ContractLimitsEditor } from "./ContractLimitsEditor";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api";
import { OperationRulesEditor } from "./OperationRulesEditor";
import {
  operationDescriptionSchema,
  operationDraftSchema,
  type OperationDescription,
  type OperationDraft,
  type OperationContract,
} from "../../src/studio/operation-data";
import {
  readSourceEditPreview,
  type SourceEditPreview,
} from "../../src/studio/interface-data";

export function OperationContractEditor(props: {
  file: string;
  name: string;
  symbolId: string;
  runId?: string | undefined;
  initialDraft: OperationDraft | null;
  recoverySaved: boolean;
  loadError?: string | undefined;
  onDraft: (value: OperationDraft) => void;
  onClose: () => void;
  onRefresh: () => void;
  onApply: (preview: SourceEditPreview) => Promise<void>;
}) {
  const [current, setCurrent] = useState<OperationDescription | null>(null);
  const [baseline, setBaseline] = useState(
    props.initialDraft?.baseline ?? null,
  );
  const [edit, setEdit] = useState<OperationContract | null>(
    props.initialDraft?.edit ?? null,
  );
  const [preview, setPreview] = useState<SourceEditPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLElement>(null);
  const focus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (focus.current) {
      root.current?.querySelector<HTMLElement>(focus.current)?.focus();
      focus.current = null;
    }
  });
  const generation = useRef(0);
  const mounted = useRef(true);
  const resumed = useRef(!!props.initialDraft);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    generation.current++;
    setCurrent(null);
    setPreview(null);
    setBusy(false);
    setError("");
    if (!props.runId) return;
    const controller = new AbortController();
    void api(
      "interface",
      { action: "operation", runId: props.runId, symbolId: props.symbolId },
      controller.signal,
    )
      .then((raw) => {
        if (controller.signal.aborted) return;
        const value = operationDescriptionSchema.parse(raw);
        if (!value.definition)
          throw Error(value.unsupported ?? "Edit this operation in Text.");
        setCurrent(value);
        if (!baseline) {
          setBaseline(value);
          setEdit({
            ...value.definition,
            ...(value.origins ? { origins: value.origins } : {}),
          });
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => controller.abort();
  }, [props.runId, props.file, props.name]);
  const conflict =
    !!current &&
    !!baseline &&
    current.declarationHash !== baseline.declarationHash;
  function change(value: OperationContract, base = baseline) {
    if (!base) return;
    try {
      const draft = operationDraftSchema.parse({
        file: props.file,
        name: props.name,
        baseline: base,
        edit: value,
      });
      props.onDraft(draft);
      setEdit(draft.edit);
      setBaseline(base);
      generation.current++;
      setPreview(null);
      setError("");
    } catch {
      setError(
        "Keep at most 20 rules and work summaries, with 1,000 characters per expression. Your previous edit is kept.",
      );
    }
  }
  async function previewChanges() {
    if (!current || !edit || conflict || !props.runId) return;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = readSourceEditPreview(
        await api("interface", {
          action: "preview-operation",
          runId: props.runId,
          symbolId: current.symbolId,
          sourceHash: current.sourceHash,
          edit,
        }),
      );
      if (mounted.current && generation.current === request) {
        if (
          next.file !== current.file ||
          (next.baseSnapshotId ?? next.snapshotId) !== current.snapshotId
        )
          throw Error(
            "This preview belongs to another checked operation. Check the current source again.",
          );
        setPreview(next);
      }
    } catch (e) {
      if (mounted.current && generation.current === request)
        setError(String(e));
    } finally {
      if (mounted.current && generation.current === request) setBusy(false);
    }
  }
  const subject =
    (current?.kind ?? baseline?.kind) === "flow" ? "component" : "operation";
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section
        ref={root}
        className="modal interface-modal declaration-editor operation-contract-editor"
        role="dialog"
        aria-modal="true"
        aria-label={
          current?.kind === "flow"
            ? "Edit component contract"
            : "Edit operation contract"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2>
              Edit {current?.kind === "flow" ? "component" : "operation"}{" "}
              contract: {props.name}
            </h2>
            <p>{props.file}</p>
          </div>
          <button className="text-link" onClick={props.onClose}>
            Close
          </button>
        </div>
        <p>
          {current?.kind === "flow"
            ? "Change caller rules, checked return obligations, additional work and total budgets."
            : "Change caller rules, assumed return guarantees and work counts."}
          Inputs, effects, provider rules and other clauses stay in the source.
          Apply creates one unsaved edit; you can undo it in Blocks or Text.
        </p>
        {resumed.current && (
          <p className="message">
            Resumed your unfinished {subject} contract. Review it against the
            current source before applying.
          </p>
        )}
        {props.initialDraft && (
          <p role="status">
            {props.recoverySaved
              ? "Operation form saved locally"
              : `Saving ${subject} form locally…`}
          </p>
        )}
        {(error || props.loadError) && (
          <p className="message error-message" role="alert">
            {error || props.loadError}
          </p>
        )}
        {!current && !error && !props.loadError && (
          <p role="status">Checking the current {subject}…</p>
        )}
        {conflict && current && baseline && edit && (
          <section
            className="message"
            aria-label="Operation changed while editing"
          >
            <h3>This {subject} changed since your form started</h3>
            <p>
              Your form has not overwritten anything. Compare the source
              versions and your rules before choosing how to continue.
            </p>
            <h4>Source when the form started</h4>
            <pre>{baseline.declarationText}</pre>
            <h4>Current source</h4>
            <pre>{current.declarationText}</pre>
            <button
              onClick={() => {
                focus.current = "[data-preview-operation]";
                const { origins, ...rules } = edit;
                change(rules, current);
              }}
            >
              Keep my rule edits against current source
            </button>
            <button
              onClick={() => {
                focus.current = "[data-preview-operation]";
                if (current.definition)
                  change(
                    {
                      ...current.definition,
                      ...(current.origins ? { origins: current.origins } : {}),
                    },
                    current,
                  );
              }}
            >
              Use current {subject} rules
            </button>
          </section>
        )}
        {current && (
          <details className="operation-signature">
            <summary>
              {subject === "component"
                ? "Current component and declared constraints"
                : "Current signature and service assumptions"}
            </summary>
            <pre>{current.declarationText}</pre>
          </details>
        )}
        {edit && (
          <fieldset
            className="declaration-fields"
            disabled={busy || conflict || !current}
          >
            <legend>Rules and work</legend>
            <OperationRulesEditor
              value={edit}
              onChange={change}
              concrete={current?.kind === "flow"}
            />
            <ContractLimitsEditor
              value={edit}
              inputs={current?.parameters ?? []}
              onChange={change}
            />
            <h3>
              {current?.kind === "flow"
                ? "Additional work inside this component"
                : "How much work does one call perform?"}
            </h3>
            {current?.kind === "flow" && (
              <p>
                Overhead is added to called operations and looped steps. Use a
                work budget to limit the total.
              </p>
            )}
            <p>
              Use a count or an input expression, such as{" "}
              <code>items.count + 1</code>. A blank count stays an open
              question.
            </p>
            {edit.costs.map((cost, i) => (
              <div className="interface-field operation-work-row" key={i}>
                <label>
                  Work {i + 1} metric
                  <input
                    data-work-index={i}
                    value={cost.metric}
                    maxLength={120}
                    onChange={(e) =>
                      change({
                        ...edit,
                        costs: edit.costs.map((c, j) =>
                          i === j ? { ...c, metric: e.target.value } : c,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Work {i + 1} count
                  <input
                    value={cost.expression}
                    maxLength={1000}
                    onChange={(e) =>
                      change({
                        ...edit,
                        costs: edit.costs.map((c, j) =>
                          i === j ? { ...c, expression: e.target.value } : c,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Work {i + 1} meaning
                  <select
                    value={cost.quality}
                    onChange={(e) =>
                      change({
                        ...edit,
                        costs: edit.costs.map((c, j) =>
                          i === j
                            ? {
                                ...c,
                                quality: e.target.value as "exact" | "upper",
                              }
                            : c,
                        ),
                      })
                    }
                  >
                    <option value="exact">Exactly this much</option>
                    <option value="upper">At most this much</option>
                  </select>
                </label>
                <button
                  onClick={() => {
                    focus.current =
                      edit.costs.length > 1
                        ? `[data-work-index="${Math.min(i, edit.costs.length - 2)}"]`
                        : "[data-add-work]";
                    change({
                      ...edit,
                      costs: edit.costs.filter((_, j) => i !== j),
                      ...(edit.origins
                        ? {
                            origins: {
                              ...edit.origins,
                              costs: edit.origins.costs.filter(
                                (_, j) => i !== j,
                              ),
                            },
                          }
                        : {}),
                    });
                  }}
                >
                  Remove work summary {i + 1}
                </button>
              </div>
            ))}
            <button
              disabled={edit.costs.length >= 20}
              data-add-work=""
              onClick={() => {
                focus.current = `[data-work-index="${edit.costs.length}"]`;
                change({
                  ...edit,
                  costs: [
                    ...edit.costs,
                    { metric: "", expression: "", quality: "exact" },
                  ],
                  ...(edit.origins
                    ? {
                        origins: {
                          ...edit.origins,
                          costs: [...edit.origins.costs, null],
                        },
                      }
                    : {}),
                });
              }}
            >
              Add work summary
            </button>
          </fieldset>
        )}
        {preview && (
          <section aria-label="Operation edit preview">
            <h3>Review changes and affected components</h3>
            {preview.edits.map((change, i) => (
              <div key={i}>
                <h4>Before</h4>
                <pre>{change.before || "(new clause)"}</pre>
                <h4>After</h4>
                <pre>{change.text || "(removed clause)"}</pre>
              </div>
            ))}
            <ul>
              {preview.affected.map((item) => (
                <li key={item.symbolId}>{item.name}</li>
              ))}
            </ul>
            <p>
              {preview.affectedComplete
                ? "All consumers in the checked project were considered."
                : "Impact is incomplete; correct source errors before relying on this list."}
            </p>
            {preview.notices?.map((notice, i) => (
              <p key={i}>{notice}</p>
            ))}
          </section>
        )}
        <div className="modal-actions">
          <button className="button secondary" onClick={props.onClose}>
            Close and keep form
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={props.onRefresh}
          >
            Check current source
          </button>
          <button
            className="button secondary"
            disabled={!current || !edit || conflict}
            aria-disabled={busy || undefined}
            data-preview-operation=""
            onClick={() => {
              if (!busy) void previewChanges();
            }}
          >
            Preview {current?.kind === "flow" ? "component" : "operation"}{" "}
            changes
          </button>
          <button
            className="button primary"
            disabled={busy || !preview || conflict}
            onClick={() => {
              if (!preview) return;
              setBusy(true);
              void props
                .onApply(preview)
                .catch((e) => {
                  if (mounted.current) {
                    setError(String(e));
                    setPreview(null);
                  }
                })
                .finally(() => {
                  if (mounted.current) setBusy(false);
                });
            }}
          >
            Apply {current?.kind === "flow" ? "component" : "operation"} changes
            and check
          </button>
        </div>
      </section>
    </div>
  );
}
