import { useRef, useState, type SetStateAction } from "react";

export type DraftEdit<T> = (current: T) => T;
export type DraftUpdate<T> = (edit: DraftEdit<T>) => void;

/** Nested editors forward edits; only the owning form holds draft state. */
export function useDraftUpdate<T>(_value: T, onChange: DraftUpdate<T>) {
  return onChange;
}

/** Linearize accepted edits at the owner, including multiple events before render.
 * Props never reset an editor-local pending copy: there is only one current draft. */
export function useDraftState<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const current = useRef(value);
  const change = (edit: SetStateAction<T>) => {
    const next =
      typeof edit === "function"
        ? (edit as DraftEdit<T>)(current.current)
        : edit;
    current.current = next;
    setValue(next);
  };
  return [value, change, () => current.current] as const;
}
