import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  blockDocumentSchema,
  replaceBlockField,
  insertBlock,
  moveBlock,
  applyBlockEdit,
  appendCallOutcome,
  addCancellation,
  addResourceStep,
  createResourceStep,
  type BlockDocument,
  type BlockField,
  type BlockSection,
  type DesignBlock,
} from "../../src/studio/block-document";
import { api } from "./api";
import { StateRangeEditor } from "./StateRangeEditor";
import {
  applyRangeDraft,
  rangesIn,
  type RangeDraft,
} from "../../src/studio/range-data";
type FocusTarget = { blockId?: string; sectionId?: string; action?: string };
const insertedBlock = (section: BlockSection): FocusTarget => ({
  blockId: `${section.id}/${section.blocks.length - (["return", "propagate"].includes(section.blocks.at(-1)?.kind ?? "") ? 1 : 0)}`,
});

export function BlockEditor(props: {
  file: string;
  runId: string | undefined;
  value: string;
  readonly: boolean;
  range: { start: number; end: number } | null;
  onChange: (text: string) => void;
  rangeDrafts: RangeDraft[];
  onRangeDrafts: (update: (old: RangeDraft[]) => RangeDraft[]) => void;
  onCheck: () => void;
  onText: (start?: number) => void;
  onInterface: (symbolId: string) => void;
  onType: (symbolId: string) => void;
  onResource: (symbolId: string) => void;
  onOperation: (symbolId: string) => void;
  onCreate: () => void;
  onUndo: () => void;
  onRedo: () => void;
  appliedFocus?:
    | { file: string; text: string; name?: string | undefined }
    | undefined;
  onAppliedFocus?: (() => void) | undefined;
}) {
  const [document, setDocument] = useState<BlockDocument | null>(null);
  const docRef = useRef(document);
  const latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [structuring, setStructuring] = useState(false);
  const structureActive = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [visible, setVisible] = useState(20);
  const [callChoices, setCallChoices] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [resourceTypes, setResourceTypes] = useState<Record<string, string>>(
    {},
  );
  const [resourceSteps, setResourceSteps] = useState<
    Record<string, { name: string; state: string }>
  >({});
  const root = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{
    file: string;
    text: string;
    before: string;
    target: FocusTarget;
    trigger: Element | null;
  } | null>(null);
  docRef.current = document;
  useEffect(() => {
    if (!props.runId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api(
      "blocks",
      { runId: props.runId, file: props.file },
      controller.signal,
    )
      .then((raw) => {
        const next = blockDocumentSchema.parse(raw);
        if (controller.signal.aborted) return;
        setDocument((prior) =>
          prior?.text === latest.current.value &&
          next.text !== latest.current.value
            ? prior
            : !next.parsed &&
                prior?.file === next.file &&
                prior.text === next.text
              ? { ...prior, parsed: false }
              : next,
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [props.file, props.runId]);
  useEffect(() => {
    setDocument(null);
    setVisible(20);
    setCallChoices({});
    setOpenSections({});
    setResourceTypes({});
    setResourceSteps({});
  }, [props.file]);
  useEffect(() => {
    if (props.range)
      root.current
        ?.querySelectorAll(".visual-selected")
        .item(root.current.querySelectorAll(".visual-selected").length - 1)
        ?.scrollIntoView({ block: "center" });
  }, [props.range, document]);
  const current = document?.text === props.value;
  const editable = current && !props.readonly && !structuring;
  useLayoutEffect(() => {
    const request = props.appliedFocus;
    if (
      !request ||
      request.file !== props.file ||
      request.text !== document?.text ||
      !root.current
    )
      return;
    const index = document.blocks.findIndex(
      (block) => block.title === request.name,
    );
    if (index >= visible) {
      setVisible(index + 1);
      return;
    }
    const active = window.document.activeElement;
    if (
      active &&
      active !== window.document.body &&
      !active.closest("[role=dialog]")
    ) {
      props.onAppliedFocus?.();
      return;
    }
    const target =
      index >= 0
        ? [
            ...root.current.querySelectorAll<HTMLElement>("[data-block-id]"),
          ].find((node) => node.dataset.blockId === document.blocks[index]!.id)
        : null;
    if (target) {
      let parent = target.parentElement;
      while (parent && parent !== root.current) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      target.focus();
      target.scrollIntoView({ block: "nearest" });
    } else
      root.current.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    props.onAppliedFocus?.();
  }, [props.appliedFocus, document, visible]);
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    if (
      pending.file !== props.file ||
      (props.value !== pending.text && props.value !== pending.before)
    ) {
      pendingFocus.current = null;
      return;
    }
    if (
      !document ||
      document.text !== pending.text ||
      props.value !== pending.text ||
      !root.current
    ) {
      // The old card leaves the tree while the changed source is checked.
      // Keep keyboard focus in this editor until its exact projection arrives.
      const active = window.document.activeElement;
      if (
        props.value === pending.text &&
        root.current &&
        (!active ||
          active === window.document.body ||
          active === pending.trigger)
      ) {
        const status =
          root.current.querySelector<HTMLElement>(".visual-status");
        status?.focus();
        pending.trigger = status;
      }
      return;
    }
    if (structuring) return;
    pendingFocus.current = null;
    const active = window.document.activeElement;
    if (active && active !== window.document.body && active !== pending.trigger)
      return;
    const node = pending.target.blockId
      ? [...root.current.querySelectorAll<HTMLElement>("[data-block-id]")].find(
          (element) => element.dataset.blockId === pending.target.blockId,
        )
      : [
          ...root.current.querySelectorAll<HTMLElement>("[data-section-id]"),
        ].find(
          (element) => element.dataset.sectionId === pending.target.sectionId,
        );
    const control = pending.target.action
      ? node?.querySelector<HTMLElement>(
          `[data-block-action="${pending.target.action}"]:not(:disabled)`,
        )
      : node?.querySelector<HTMLElement>(
          "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), .visual-add > summary",
        );
    (
      control ??
      node ??
      root.current.querySelector<HTMLElement>(".visual-status button")
    )?.focus();
  }, [document, props.file, props.value, structuring]);
  useEffect(() => {
    if (!document || document.text !== props.value) return;
    const keys = new Set(
      props.rangeDrafts
        .filter((draft) => draft.file === props.file)
        .map((draft) => draft.key),
    );
    const hasDraft = (block: DesignBlock): boolean =>
      !!(block.numericRange && keys.has(block.numericRange.key)) ||
      (block.children ?? []).some(hasDraft);
    const owners = document.blocks.filter(hasDraft);
    if (owners.length) {
      setOpenSections((old) => ({
        ...old,
        ...Object.fromEntries(owners.map((b) => [`definition/${b.id}`, true])),
      }));
      const last = Math.max(...owners.map((b) => document.blocks.indexOf(b)));
      setVisible((n) => Math.max(n, last + 1));
    }
  }, [document, props.file, props.rangeDrafts]);
  const disclosure = (id: string) => ({
    open: openSections[id] ?? false,
    onToggle: (event: React.SyntheticEvent<HTMLDetailsElement>) => {
      const open = event.currentTarget.open;
      setOpenSections((old) =>
        old[id] === open ? old : { ...old, [id]: open },
      );
    },
  });
  function changeField(field: BlockField, value: string) {
    const doc = docRef.current;
    if (!doc || doc.text !== props.value || props.readonly) return;
    try {
      const next = replaceBlockField(doc, field, value);
      docRef.current = next;
      setDocument(next);
      props.onChange(next.text);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  async function structure(
    make: (doc: BlockDocument) => string,
    target?: FocusTarget,
    format = true,
  ) {
    const doc = docRef.current;
    if (!doc || !editable || structureActive.current) return;
    structureActive.current = true;
    setStructuring(true);
    const trigger = window.document.activeElement;
    try {
      const proposed = make(doc);
      const formatted = format
        ? await api("format", {
            file: props.file,
            text: proposed,
          })
        : { text: proposed };
      if (
        !formatted ||
        typeof formatted !== "object" ||
        !("text" in formatted) ||
        typeof formatted.text !== "string"
      )
        throw Error(
          "The source formatter did not return source. No changes were applied.",
        );
      if (!mounted.current) return;
      if (
        latest.current.file !== props.file ||
        latest.current.value !== doc.text
      ) {
        setError(
          "The source changed while this step was prepared. Check it and try again.",
        );
        return;
      }
      const text = formatted.text;
      pendingFocus.current = {
        file: props.file,
        text,
        before: doc.text,
        trigger,
        target: target ?? {
          blockId:
            (trigger?.closest("[data-block-id]") as HTMLElement | null)?.dataset
              .blockId ?? "",
        },
      };
      docRef.current = null;
      props.onChange(text);
      setError("");
      props.onCheck();
      return true;
    } catch (e) {
      setError(String(e));
    } finally {
      structureActive.current = false;
      setStructuring(false);
    }
  }
  const sourceNote = (from: number, to: number, key: string) => {
    if (!document) return null;
    const text = document.text.slice(from, to).trim();
    if (!text) return null;
    return (
      <div className="visual-note" key={key}>
        <span>Retained source · notes or syntax</span>
        <pre>{text}</pre>
      </div>
    );
  };
  function fieldView(field: BlockField) {
    const raw = document!.text.slice(field.span.start, field.span.end);
    let value = raw;
    const unanswered =
      field.placeholder !== undefined && raw === field.placeholderSource;
    if (unanswered) value = "";
    if (field.format === "text") {
      try {
        value = JSON.parse(raw) as string;
      } catch {
        /* retained raw */
      }
    }
    return (
      <div key={field.id}>
        <label className="visual-field">
          <span>{field.label}</span>
          {field.choices ? (
            <select
              aria-label={field.label}
              value={value}
              disabled={!editable}
              onChange={(e) => {
                changeField(field, e.target.value);
                props.onCheck();
              }}
            >
              {!field.choices.includes(value) && (
                <option value={value}>{value || "Choose a state…"}</option>
              )}
              {field.choices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label={field.label}
              value={value}
              placeholder={field.placeholder}
              disabled={!editable}
              onChange={(e) => changeField(field, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  props.onCheck();
                }
              }}
            />
          )}
          <small>{field.help}</small>
        </label>
        {unanswered && field.suggestions && (
          <div className="visual-suggestions">
            {field.suggestions.length ? (
              <>
                <span>Use an input from this component:</span>
                {field.suggestions.map((name) => (
                  <button
                    key={name}
                    className="button secondary"
                    disabled={!editable}
                    onClick={() => {
                      changeField(field, name);
                      props.onCheck();
                    }}
                  >
                    Use {name}
                  </button>
                ))}
              </>
            ) : (
              <span>Enter a value or expression for this input.</span>
            )}
            {field.suggestionsComplete === false && (
              <small>
                Suggestions are limited; other compatible values may be
                available.
              </small>
            )}
          </div>
        )}
      </div>
    );
  }
  function sectionView(section: BlockSection, depth: number) {
    let previous = section.span.start + 1;
    const resourceStep = resourceSteps[section.id];
    const selectedResource = section.resources.find(
      (resource) => resource.name === resourceStep?.name,
    );
    return (
      <section
        className="visual-section"
        aria-label={section.label}
        key={section.id}
        data-section-id={section.id}
        tabIndex={-1}
      >
        <h4>{section.label}</h4>
        {section.blocks.map((b, i) => {
          const note = sourceNote(previous, b.span.start, b.id + "/note");
          previous = b.span.end;
          return (
            <div key={b.id}>
              {note}
              {blockView(b, depth, { section, index: i })}
            </div>
          );
        })}
        {sourceNote(previous, section.span.end - 1, section.id + "/tail")}
        {!section.blocks.length && (
          <p className="visual-empty">
            No steps yet. Add a step or an open question.
          </p>
        )}
        <details className="visual-add" {...disclosure(section.id)}>
          <summary>Add a step</summary>
          <div className="visual-add-options">
            {(
              [
                ["Open question", 'unknown "What should happen here?";'],
                [
                  "Decision",
                  'if unknown "Choose the condition" {\n  unknown "What happens when true?";\n} else {\n  unknown "What happens otherwise?";\n}',
                ],
                [
                  "Repeat",
                  'for item in unknown "How many repetitions?" {\n  unknown "What happens each time?";\n}',
                ],
                ["Return a result", 'return unknown "Choose the result";'],
              ] as const
            ).map(([label, source]) => (
              <button
                type="button"
                className="button secondary"
                disabled={!editable}
                key={label}
                onClick={() =>
                  structure(
                    (doc) => insertBlock(doc.text, section, source),
                    insertedBlock(section),
                  )
                }
              >
                {label}
              </button>
            ))}
            {document!.calls.length > 0 && (
              <div className="visual-call-add">
                <label>
                  Component to call
                  <select
                    aria-label="Component to call"
                    value={callChoices[section.id] ?? ""}
                    onChange={(e) =>
                      setCallChoices((old) => ({
                        ...old,
                        [section.id]: e.target.value,
                      }))
                    }
                    disabled={!editable}
                  >
                    <option value="">Choose a component…</option>
                    {document!.calls.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!editable || !callChoices[section.id]}
                  onClick={() =>
                    structure((doc) => {
                      const call = doc.calls.find(
                        (c) => c.name === callChoices[section.id],
                      );
                      if (!call)
                        throw Error("Choose a currently available component.");
                      let binding = "callResult",
                        n = 1;
                      while (doc.text.includes(binding))
                        binding = `callResult${n++}`;
                      return insertBlock(
                        doc.text,
                        section,
                        `call ${call.name}(${call.params.map((p) => `${p.mode === "value" ? "" : p.mode + " "}unknown ${JSON.stringify("Choose " + p.name)}`).join(", ")})${call.returnsUnit ? "" : ` as ${binding}`};`,
                      );
                    }, insertedBlock(section))
                  }
                >
                  Add call
                </button>
                <small>
                  New inputs remain open questions. Handle the returned outcome
                  in a following step.
                </small>
              </div>
            )}
            {document!.resourceTypes.length > 0 && (
              <div className="visual-call-add">
                <label>
                  Resource to create
                  <select
                    aria-label="Resource to create"
                    value={resourceTypes[section.id] ?? ""}
                    disabled={!editable}
                    onChange={(e) =>
                      setResourceTypes((old) => ({
                        ...old,
                        [section.id]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Choose a resource type…</option>
                    {document!.resourceTypes.map((resource) => (
                      <option key={resource.name} value={resource.name}>
                        {resource.name} · starts in {resource.initial}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button secondary"
                  disabled={!editable || !resourceTypes[section.id]}
                  onClick={() =>
                    structure(
                      (doc) =>
                        createResourceStep(
                          doc,
                          section,
                          resourceTypes[section.id]!,
                        ),
                      insertedBlock(section),
                    )
                  }
                >
                  Create resource
                </button>
                <small>
                  Creates a local name and a cleanup obligation. It does not add
                  cleanup automatically.
                </small>
                {document!.resourceTypeCount >
                  document!.resourceTypes.length && (
                  <small>
                    Showing the first 100 resource types. Use Text for other
                    definitions.
                  </small>
                )}
              </div>
            )}
            {section.resources.length > 0 && (
              <div className="visual-call-add">
                <label>
                  Resource to change
                  <select
                    aria-label="Resource to change"
                    value={resourceStep?.name ?? ""}
                    disabled={!editable}
                    onChange={(e) =>
                      setResourceSteps((old) => ({
                        ...old,
                        [section.id]: { name: e.target.value, state: "" },
                      }))
                    }
                  >
                    <option value="">Choose an in-scope resource…</option>
                    {section.resources.map((resource) => (
                      <option key={resource.name} value={resource.name}>
                        {resource.name} · {resource.resource}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  New state
                  <select
                    aria-label="New state"
                    value={resourceStep?.state ?? ""}
                    disabled={!editable || !selectedResource}
                    onChange={(e) =>
                      setResourceSteps((old) => ({
                        ...old,
                        [section.id]: {
                          name: resourceStep!.name,
                          state: e.target.value,
                        },
                      }))
                    }
                  >
                    <option value="">Choose a declared state…</option>
                    {selectedResource?.states.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button secondary"
                  disabled={
                    !editable || !selectedResource || !resourceStep?.state
                  }
                  onClick={() =>
                    structure(
                      (doc) =>
                        addResourceStep(
                          doc,
                          section,
                          resourceStep!.name,
                          resourceStep!.state,
                        ),
                      insertedBlock(section),
                    )
                  }
                >
                  Add state change
                </button>
                <small>
                  The checker assesses legal transitions and ownership. State
                  changes may require an effect in “Edit inputs and output”.
                </small>
                {section.resourceCount > section.resources.length && (
                  <small>
                    Showing the first 100 in-scope resources. Use Text for the
                    rest.
                  </small>
                )}
                {selectedResource &&
                  selectedResource.stateCount >
                    selectedResource.states.length && (
                    <small>
                      Showing the first 100 declared states. Use Text for the
                      rest.
                    </small>
                  )}
              </div>
            )}
          </div>
        </details>
      </section>
    );
  }
  function blockView(
    b: DesignBlock,
    depth: number,
    position?: { section: BlockSection; index: number },
  ) {
    const focused =
      props.range &&
      props.range.start >= b.span.start &&
      props.range.start < b.span.end;
    return (
      <article
        className={`visual-block visual-${b.kind}${focused ? " visual-selected" : ""}`}
        aria-label={b.title}
        key={b.id}
        data-block-id={b.id}
        tabIndex={-1}
      >
        <div className="visual-block-heading">
          <div>
            <span className="visual-kind">
              {b.kind === "flow"
                ? "Component"
                : b.kind === "op"
                  ? "External operation"
                  : b.kind === "rule"
                    ? "Reusable decision"
                    : position
                      ? "Step"
                      : ({
                          "data-field": "Data field",
                          outcome: "Possible outcome",
                          "state-value": "State value",
                          event: "Event",
                          invariant: "Must always hold",
                          machine: "Event model",
                          resource: "Resource lifecycle",
                          type: "Data shape",
                        }[b.kind] ?? b.kind)}
            </span>
            <h3>{b.title}</h3>
          </div>
          <button
            className="text-link"
            onClick={() => props.onText(b.span.start)}
          >
            View text
          </button>
        </div>
        {b.summary && <p className="visual-summary">{b.summary}</p>}
        {b.lifecycle && (
          <div className="visual-lifecycle" aria-label={`${b.title} lifecycle`}>
            <p>
              Starts in <strong>{b.lifecycle.initial}</strong>. Cleanup is
              complete in <strong>{b.lifecycle.terminal.join(" or ")}</strong>.
            </p>
            <div className="visual-state-list" aria-label="Declared states">
              {b.lifecycle.states.map((state) => (
                <span
                  key={state}
                  className={
                    b.lifecycle!.terminal.includes(state)
                      ? "visual-state terminal"
                      : "visual-state"
                  }
                >
                  {state}
                  {state === b.lifecycle!.initial ? " · initial" : ""}
                  {b.lifecycle!.terminal.includes(state)
                    ? " · cleanup complete"
                    : ""}
                </span>
              ))}
            </div>
            <h4>Allowed state changes</h4>
            <ul>
              {b.lifecycle.transitions.map((edge, i) => (
                <li key={i}>
                  <strong>{edge.from}</strong>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> to </span>
                  <strong>{edge.to}</strong>
                </li>
              ))}
            </ul>
            {(b.lifecycle.stateCount > b.lifecycle.states.length ||
              b.lifecycle.terminalCount > b.lifecycle.terminal.length ||
              b.lifecycle.transitionCount > b.lifecycle.transitions.length) && (
              <p>
                Showing up to 40 states, cleanup states and transitions. The
                complete lifecycle ({b.lifecycle.stateCount} states,{" "}
                {b.lifecycle.terminalCount} cleanup states,{" "}
                {b.lifecycle.transitionCount} transitions) is available in Text.
              </p>
            )}
            <p className="visual-footnote">
              These are the declared rules. Each path, including cancellation,
              still needs a cleanup check.
            </p>
          </div>
        )}
        <div className="visual-component-actions">
          {b.symbolId && ["op", "flow"].includes(b.kind) && (
            <button
              className="text-link"
              disabled={!editable}
              onClick={() => props.onOperation(b.symbolId!)}
            >
              {b.kind === "flow"
                ? "Edit component rules, budgets and bounds"
                : "Edit operation rules and work"}
            </button>
          )}
          {b.symbolId && b.kind === "resource" && (
            <button
              className="text-link"
              disabled={!editable}
              onClick={() => props.onResource(b.symbolId!)}
            >
              Edit lifecycle rules
            </button>
          )}
          {b.symbolId && b.kind === "type" && (
            <button
              className="text-link"
              disabled={!editable}
              onClick={() => props.onType(b.symbolId!)}
            >
              Add or remove fields and outcomes
            </button>
          )}
          {b.symbolId && ["flow", "op", "rule"].includes(b.kind) && (
            <button
              className="text-link"
              disabled={!editable}
              onClick={() => props.onInterface(b.symbolId!)}
            >
              Edit inputs and output
            </button>
          )}
          {b.canAddCancellation && (
            <button
              className="text-link"
              disabled={!editable}
              onClick={() =>
                structure((doc) => addCancellation(doc, b), {
                  blockId: `${b.id}/cancel/0`,
                })
              }
            >
              Add cancellation steps
            </button>
          )}
        </div>
        {b.fields.map(fieldView)}
        {b.numericRange && (
          <StateRangeEditor
            key={b.numericRange.key}
            file={props.file}
            range={b.numericRange}
            draft={props.rangeDrafts.find(
              (draft) =>
                draft.file === props.file && draft.key === b.numericRange!.key,
            )}
            disabled={!editable}
            onDraft={(draft) => {
              const others = props.rangeDrafts.filter(
                (item) =>
                  item.file !== props.file || item.key !== b.numericRange!.key,
              );
              if (draft && others.length >= 32) {
                setError(
                  "There are 32 unfinished range edits. Apply or discard one before starting another.",
                );
                return;
              }
              props.onRangeDrafts((old) => [
                ...old.filter(
                  (item) =>
                    item.file !== props.file ||
                    item.key !== b.numericRange!.key,
                ),
                ...(draft ? [draft] : []),
              ]);
            }}
            onApply={async (draft) => {
              if (
                await structure(
                  (doc) => applyRangeDraft(doc, draft),
                  { blockId: b.id, action: "range-min" },
                  false,
                )
              )
                props.onRangeDrafts((old) =>
                  old.filter(
                    (item) =>
                      item.file !== props.file || item.key !== draft.key,
                  ),
                );
            }}
          />
        )}

        {b.children && (
          <div className="visual-children">
            {b.children.map((item) => blockView(item, depth + 1))}
          </div>
        )}
        {b.callResult?.hasOutcomeStep && (
          <p className="visual-footnote">
            This result already has outcome steps below. Edit those steps to
            change how it is handled.
          </p>
        )}
        {b.callResult && !b.callResult.hasOutcomeStep && (
          <div className="visual-call-outcomes">
            {b.callResult.canDecide && (
              <>
                <p>This call returns a yes/no value.</p>
                <button
                  className="button secondary"
                  disabled={!editable}
                  onClick={() =>
                    structure((doc) => appendCallOutcome(doc, b, "decide"), {
                      blockId: position
                        ? `${position.section.id}/${position.index + 1}`
                        : b.id,
                    })
                  }
                >
                  Decide from this result
                </button>
                <small>
                  Adds a yes branch and a no branch, each with an open question.
                </small>
              </>
            )}
            {!!b.callResult.outcomeCount && (
              <p>
                Declared outcomes:{" "}
                {b.callResult.outcomes
                  .slice(0, 8)
                  .map((outcome) => outcome.tag)
                  .join(", ")}
                {b.callResult.outcomeCount > 8
                  ? ` · ${b.callResult.outcomeCount - 8} more`
                  : ""}
                .
              </p>
            )}
            {b.callResult.outcomeCount > 0 && (
              <button
                className="button secondary"
                disabled={
                  !editable ||
                  b.callResult.outcomeCount !== b.callResult.outcomes.length
                }
                onClick={() =>
                  structure((doc) => appendCallOutcome(doc, b, "handle"), {
                    blockId: position
                      ? `${position.section.id}/${position.index + 1}`
                      : b.id,
                  })
                }
              >
                Handle each outcome
              </button>
            )}
            {b.callResult.canReturn && (
              <button
                className="button secondary"
                disabled={!editable}
                onClick={() =>
                  structure((doc) => appendCallOutcome(doc, b, "return"), {
                    blockId: position
                      ? `${position.section.id}/${position.index + 1}`
                      : b.id,
                  })
                }
              >
                Return this result
              </button>
            )}
            {!!b.callResult.outcomeCount && (
              <small>
                Handling adds an open question for every declared outcome.
                Returning ends this path.
              </small>
            )}
            {b.callResult.outcomeCount !== b.callResult.outcomes.length && (
              <p>
                This outcome set is too large for the block builder. Use Text to
                handle all {b.callResult.outcomeCount} cases.
              </p>
            )}
          </div>
        )}
        {depth < 12
          ? b.sections.map((s) => sectionView(s, depth + 1))
          : b.sections.length > 0 && (
              <p>Nested steps continue in the text editor.</p>
            )}
        <details className="visual-source" {...disclosure(`source/${b.id}`)}>
          <summary>
            {b.fields.length || b.sections.length
              ? "Source and contracts"
              : "View definition"}
          </summary>
          <pre>{document!.text.slice(b.span.start, b.span.end)}</pre>
        </details>
        {position && (
          <div className="visual-step-actions">
            <button
              className="text-link"
              disabled={!editable || position.index === 0}
              onClick={() =>
                structure(
                  (doc) =>
                    moveBlock(doc.text, position.section, position.index, -1),
                  {
                    blockId: `${position.section.id}/${position.index - 1}`,
                    action: "up",
                  },
                )
              }
              aria-label={`Move ${b.title} up`}
              data-block-action="up"
            >
              Move up
            </button>
            <button
              className="text-link"
              disabled={
                !editable ||
                position.index === position.section.blocks.length - 1
              }
              onClick={() =>
                structure(
                  (doc) =>
                    moveBlock(doc.text, position.section, position.index, 1),
                  {
                    blockId: `${position.section.id}/${position.index + 1}`,
                    action: "down",
                  },
                )
              }
              aria-label={`Move ${b.title} down`}
              data-block-action="down"
            >
              Move down
            </button>
            <button
              className="text-link"
              disabled={!editable}
              onClick={() =>
                structure(
                  (doc) =>
                    applyBlockEdit(doc.text, {
                      span: b.span,
                      expected: doc.text.slice(b.span.start, b.span.end),
                      insert: "",
                    }),
                  position.section.blocks.length > 1
                    ? {
                        blockId: `${position.section.id}/${Math.min(position.index, position.section.blocks.length - 2)}`,
                      }
                    : { sectionId: position.section.id },
                )
              }
              aria-label={`Remove ${b.title}`}
            >
              Remove
            </button>
          </div>
        )}
      </article>
    );
  }
  let before = 0;
  return (
    <div className="block-editor" aria-label="Visual block editor" ref={root}>
      <div className="visual-intro">
        <div>
          <h2>Build the design, step by step</h2>
          <p>
            These cards edit your source. Open questions stay visible until you
            decide.
          </p>
        </div>
        <div className="visual-history">
          <button
            className="button primary"
            disabled={!editable}
            onClick={props.onCreate}
          >
            Add to this design
          </button>
          <button
            className="button secondary"
            disabled={props.readonly}
            onClick={props.onUndo}
          >
            Undo
          </button>
          <button
            className="button secondary"
            disabled={props.readonly}
            onClick={props.onRedo}
          >
            Redo
          </button>
        </div>
      </div>
      <div className="visual-status" role="status" tabIndex={-1}>
        {structuring
          ? "Preparing source edit…"
          : loading
            ? "Loading checked blocks…"
            : !document
              ? "Check this source to open its blocks."
              : !current
                ? "Source changed. Check to refresh the blocks before editing."
                : !document.parsed
                  ? "Some text is incomplete. Your fields and source are retained; check after correcting it."
                  : "Blocks match the current source. Changes are unsaved until you save."}
        <button className="text-link" onClick={props.onCheck}>
          Check source
        </button>
      </div>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {document &&
        current &&
        props.rangeDrafts
          .filter(
            (draft) =>
              draft.file === props.file &&
              !rangesIn(document).some((range) => range.key === draft.key),
          )
          .map((draft) => (
            <div className="message" role="status" key={draft.key}>
              Unfinished range for {draft.label}: this state was removed,
              renamed, or cannot be edited in Blocks. Your input is preserved
              above. Inspect Text or discard the range edit; it will not be
              applied to another state.
              <button onClick={() => props.onText()}>Inspect Text</button>
            </div>
          ))}
      {document && current && (
        <>
          {document.blocks.slice(0, visible).map((b) => {
            const note = sourceNote(before, b.span.start, b.id + "/prefix");
            before = b.span.end;
            return (
              <div key={b.id}>
                {note}
                {b.kind === "flow" ? (
                  blockView(b, 0)
                ) : (
                  <details
                    className="visual-definition"
                    {...disclosure(`definition/${b.id}`)}
                  >
                    <summary>
                      <strong>{b.title}</strong>
                      <span>
                        {b.kind === "op"
                          ? "External operation"
                          : b.kind === "rule"
                            ? "Reusable decision"
                            : b.summary}
                      </span>
                    </summary>
                    {blockView(b, 0)}
                  </details>
                )}
              </div>
            );
          })}
          {visible < document.blocks.length ? (
            <button
              className="button secondary"
              onClick={() => setVisible((v) => v + 20)}
            >
              Show more components ({document.blocks.length - visible}{" "}
              remaining)
            </button>
          ) : (
            sourceNote(before, document.text.length, "suffix")
          )}
          {document.truncated && (
            <p className="message">
              This view stops at 1,200 blocks. The complete source is available
              in Text; omitted content is preserved.
            </p>
          )}
          {!document.blocks.length && (
            <p>
              No complete components yet. Use the inputs-and-output builder or
              edit the retained source in Text.
            </p>
          )}
          <p className="visual-footnote">
            Move actions take leading notes with the next step. Remove keeps its
            notes. Undo uses the same history as Text.
          </p>
        </>
      )}
    </div>
  );
}
