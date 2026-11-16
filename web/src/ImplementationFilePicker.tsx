// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { implementationFilesPageSchema } from "../../src/implementation/protocol";
import { api } from "./api";

export function ImplementationFilePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [page, setPage] = useState<z.infer<
    typeof implementationFilesPageSchema
  > | null>(null);
  const [directory, setDirectory] = useState(".");
  const [scope, setScope] = useState(".");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inventory = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api(
      "implementation/files",
      {
        ...(inventory.current
          ? { inventoryId: inventory.current }
          : { directory: scope }),
        query,
        offset,
        limit: 20,
      },
      controller.signal,
    )
      .then((raw) => {
        const result = implementationFilesPageSchema.parse(raw);
        if (!controller.signal.aborted) {
          inventory.current = result.inventoryId;
          setPage(result);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [scope, query, offset, refresh]);
  const selected = new Set(
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const current = page?.query === query && page.offset === offset;
  function select(path: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(path);
    else next.delete(path);
    onChange([...next].join("\n"));
  }
  function reload(nextScope = scope) {
    inventory.current = null;
    setPage(null);
    setOffset(0);
    setScope(nextScope);
    setRefresh((value) => value + 1);
  }
  return (
    <fieldset className="implementation-file-picker">
      <legend>Choose code files</legend>
      <p>
        Browse candidate TypeScript and JavaScript files. File contents are
        checked only when you capture a version.
      </p>
      <div className="implementation-file-filters">
        <label>
          Folder to browse
          <input
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                reload(directory);
              }
            }}
          />
        </label>
        <button
          type="button"
          className="button secondary"
          onClick={() => reload(directory)}
        >
          Browse folder
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => reload()}
        >
          Refresh file list
        </button>
      </div>
      <label>
        Find code files
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOffset(0);
            setPage(null);
          }}
          placeholder="File name or relative path"
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      </label>
      {loading && <p role="status">Listing code candidates…</p>}
      {error && (
        <p role="alert">
          {error} Use Refresh file list to start again, or enter selected paths
          below.
        </p>
      )}
      {current && page && (
        <>
          <p>
            Browsing {page.directory}: {page.total} matching files ·{" "}
            {selected.size} selected. The list stays fixed while paging; refresh
            to discover new paths.
          </p>
          <div
            className="implementation-file-list"
            role="region"
            aria-label="Implementation file candidates"
            tabIndex={0}
          >
            {page.files.map((path) => (
              <label key={path}>
                <input
                  type="checkbox"
                  checked={selected.has(path)}
                  disabled={loading}
                  onChange={(event) => select(path, event.target.checked)}
                />
                {path}
              </label>
            ))}
            {!page.files.length && (
              <p>
                No matching code files in this folder. Try another folder or
                enter paths below.
              </p>
            )}
          </div>
          <div className="implementation-file-filters">
            <button
              type="button"
              className="button secondary"
              disabled={loading || offset === 0}
              onClick={() => {
                setOffset(Math.max(0, offset - 20));
                setPage(null);
              }}
            >
              Previous files
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={loading || page.nextOffset === null}
              onClick={() => {
                setOffset(page.nextOffset!);
                setPage(null);
              }}
            >
              Next files
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={loading || !page.files.length}
              onClick={() =>
                onChange([...new Set([...selected, ...page.files])].join("\n"))
              }
            >
              Select this page
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!selected.size}
              onClick={() => onChange("")}
            >
              Clear file selection
            </button>
          </div>
          {!page.complete && (
            <p className="message notice-message">
              File discovery is incomplete. You can capture selected files, but
              this list does not cover all source paths.
            </p>
          )}
          {page.warnings.length > 0 && (
            <details>
              <summary>File discovery notes ({page.warningCount})</summary>
              <ul>
                {page.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
              {page.warningCount > page.warnings.length && (
                <p>Showing the first {page.warnings.length} notes.</p>
              )}
            </details>
          )}
        </>
      )}
    </fieldset>
  );
}
