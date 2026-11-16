// SPDX-License-Identifier: MIT
import { useState } from "react";
import {
  beginRangeDraft,
  rangeDraftMatches,
  type RangeDraft,
  type NumericRange,
} from "../../src/studio/range-data";
import { validateNumericRange } from "../../src/studio/numeric-range";
export function StateRangeEditor(props: {
  file: string;
  range: NumericRange;
  draft?: RangeDraft | undefined;
  disabled: boolean;
  onDraft: (draft: RangeDraft | null) => void;
  onApply: (draft: RangeDraft) => Promise<void>;
}) {
  const [attempted, setAttempted] = useState(false);
  const value = props.draft ?? beginRangeDraft(props.file, props.range);
  const stale = !!props.draft && !rangeDraftMatches(props.draft, props.range);
  let validation = "",
    rangeWarning = "";
  try {
    const bounds = validateNumericRange(
      value.min,
      value.max,
      props.range.type,
      props.range.label,
    );
    if (props.range.initialValue !== undefined) {
      const initial = BigInt(props.range.initialValue);
      if (initial < bounds.min || initial > bounds.max)
        rangeWarning = `The current starting value ${initial} is outside these bounds. Applying this range will report a design error; change the starting value or the range.`;
    }
  } catch (error) {
    validation = String(error).replace(/^Error: /, "");
  }
  return (
    <form
      className="state-range-editor"
      aria-label={`Range for ${props.range.label}`}
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (!validation && !stale) void props.onApply(value);
      }}
    >
      <p>
        Allowed values. Change both bounds, then apply them together. This does
        not change the initial value or safety rules.
      </p>
      <div className="state-range-inputs">
        {(["min", "max"] as const).map((key) => (
          <label key={key}>
            {key === "min" ? "Minimum" : "Maximum"}
            <input
              aria-label={`${key === "min" ? "Minimum" : "Maximum"} for ${props.range.label}`}
              data-block-action={key === "min" ? "range-min" : undefined}
              inputMode="text"
              maxLength={4096}
              value={value[key]}
              disabled={props.disabled || stale}
              onChange={(event) => {
                setAttempted(true);
                props.onDraft({ ...value, [key]: event.target.value });
              }}
            />
          </label>
        ))}
      </div>
      {stale ? (
        <div className="message" role="status">
          This state changed since you started. Your unfinished range is{" "}
          {value.min || "(blank)"} to {value.max || "(blank)"}; the current
          range is {props.range.min} to {props.range.max}.
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => {
              props.onDraft(null);
              setAttempted(false);
            }}
          >
            Restart with current range
          </button>
        </div>
      ) : validation && attempted ? (
        <p role="status">{validation}</p>
      ) : null}
      {rangeWarning && (
        <p className="message notice-message" role="status">
          {rangeWarning}
        </p>
      )}
      <div className="state-range-actions">
        <button
          type="submit"
          className="button secondary"
          disabled={props.disabled || stale || !props.draft || !!validation}
        >
          Apply range
        </button>
        {props.draft && (
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => {
              props.onDraft(null);
              setAttempted(false);
            }}
          >
            Discard range edit
          </button>
        )}
      </div>
    </form>
  );
}
