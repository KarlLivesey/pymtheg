import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  declarationTypePageSchema,
  declarationTypeItemSchema,
} from "../../src/studio/declaration-type-protocol";
import type { z } from "zod";
type Item = z.infer<typeof declarationTypeItemSchema>;
export const ProjectTypeContext = createContext<{
  file: string;
  runId: string | undefined;
  register: (item: Item) => void;
} | null>(null);
export function ProjectTypeSearch({
  onlyOutcomes,
  onChoose,
}: {
  onlyOutcomes: boolean;
  onChoose: (item: Item) => void;
}) {
  const context = useContext(ProjectTypeContext);
  const [query, setQuery] = useState(""),
    [directory, setDirectory] = useState(".");
  const [page, setPage] = useState<z.infer<
    typeof declarationTypePageSchema
  > | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const [inventoryId, setInventoryId] = useState<string | undefined>();
  useEffect(() => {
    controller.current?.abort();
    setPage(null);
    setInventoryId(undefined);
    setBusy(false);
    setError("");
    return () => controller.current?.abort();
  }, [context?.runId, context?.file]);
  if (!context) return null;
  async function search(offset = 0, fresh = false) {
    if (!context?.runId) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      const result = declarationTypePageSchema.parse(
        await api(
          "declaration",
          {
            action: "types",
            runId: context.runId,
            file: context.file,
            query: {
              query,
              directory,
              offset,
              limit: 20,
              kind: onlyOutcomes ? "choice" : "all",
              refresh: fresh,
              ...(!fresh && inventoryId ? { inventoryId } : {}),
            },
          },
          abort.signal,
        ),
      );
      if (abort.signal.aborted) return;
      setPage(result);
      setInventoryId(result.inventoryId);
    } catch (error) {
      if (!abort.signal.aborted) setError(String(error));
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <details className="project-type-search">
      <summary>Find a type in another file</summary>
      <p>
        Choose a definition from your project. The preview will check it and
        show the required import.
      </p>
      <label>
        Find type
        <input
          value={query}
          onChange={(e) => {
            controller.current?.abort();
            setBusy(false);
            setError("");
            setQuery(e.target.value);
            setPage(null);
          }}
          placeholder="Name or relative file"
        />
      </label>
      <label>
        Search folder
        <input
          value={directory}
          onChange={(e) => {
            controller.current?.abort();
            setBusy(false);
            setError("");
            setDirectory(e.target.value);
            setInventoryId(undefined);
            setPage(null);
          }}
        />
      </label>
      <div className="version-pages">
        <button
          type="button"
          disabled={busy || !context.runId}
          onClick={() => void search()}
        >
          Search project types
        </button>
        <button
          type="button"
          disabled={busy || !context.runId}
          onClick={() => void search(0, true)}
        >
          Refresh type sources
        </button>
      </div>
      {busy && <p role="status">Reading type definitions…</p>}
      {error && <p role="alert">{error}</p>}
      {page && (
        <>
          <p>
            {page.total} matching types. {page.meaning}
          </p>
          {!page.complete && (
            <div className="message">
              Search is incomplete.
              <ul>
                {page.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          <ul>
            {page.items.map((item, i) => (
              <li key={item.symbolId + ":" + i}>
                <button
                  type="button"
                  disabled={item.status !== "candidate"}
                  onClick={() => {
                    try {
                      context.register(item);
                      onChoose(item);
                    } catch (error) {
                      setError(String(error));
                    }
                  }}
                >
                  Use {item.name} from {item.file}
                </button>
                {item.status !== "candidate" && (
                  <span>
                    {" "}
                    Fix{" "}
                    {item.status === "duplicate"
                      ? "duplicate names"
                      : "syntax errors"}{" "}
                    before using this definition.
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="version-pages">
            <button
              type="button"
              disabled={busy || page.offset === 0}
              onClick={() => void search(Math.max(0, page.offset - 20))}
            >
              Previous types
            </button>
            <span>
              {page.items.length
                ? `${page.offset + 1}–${page.offset + page.items.length}`
                : "0"}{" "}
              of {page.total}
            </span>
            <button
              type="button"
              disabled={busy || page.nextOffset === null}
              onClick={() => void search(page.nextOffset!)}
            >
              More types
            </button>
          </div>
        </>
      )}
    </details>
  );
}
