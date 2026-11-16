// SPDX-License-Identifier: MIT
import type { SymbolView } from "../../src/studio/protocol";
import { describeShape } from "../../src/studio/shape-description";
export { describeShape } from "../../src/studio/shape-description";
export function InterfaceHint({
  symbol,
  current,
  onEdit,
}: {
  symbol: SymbolView | undefined;
  current: boolean;
  onEdit?: () => void;
}) {
  if (!symbol?.callable) return null;
  return (
    <aside className="interface-hint" aria-label="Inputs and output">
      <details>
        <summary>
          <strong>{symbol.name}: what goes in and comes back</strong>
        </summary>
        {!current ? (
          <p>
            Last checked interface shown below. Check again if you change its
            inputs or output.
          </p>
        ) : null}
        <>
          <dl>
            {symbol.callable.parameters.length ? (
              symbol.callable.parameters.map((p) => (
                <div key={p.name}>
                  <dt>{p.name}</dt>
                  <dd>
                    {describeShape(p.shape)}
                    {p.mode === "take"
                      ? "; this call takes ownership"
                      : p.mode === "borrow"
                        ? "; this call only borrows it"
                        : ""}
                    {p.bound ? `; declared limit ${p.bound}` : ""}
                  </dd>
                </div>
              ))
            ) : (
              <div>
                <dt>Inputs</dt>
                <dd>This component takes no inputs.</dd>
              </div>
            )}
            <div>
              <dt>Returns</dt>
              <dd>{describeShape(symbol.callable.result)}</dd>
            </div>
          </dl>
          <p className="muted">
            Type a component name for suggestions. Ctrl / ⌘ Space opens
            completions; Tab moves through inserted placeholders.
          </p>
        </>
      </details>
      {onEdit && (
        <button className="button secondary" onClick={onEdit}>
          Edit inputs and output
        </button>
      )}
    </aside>
  );
}
