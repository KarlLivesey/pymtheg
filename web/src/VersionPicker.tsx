// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from "react";
import {
  versionCatalogSchema,
  type versionMetadataSchema,
} from "../../src/implementation/protocol";
import type { z } from "zod";
import { api } from "./api";
type Version = z.infer<typeof versionMetadataSchema>;
const categories = {
  all: "All checkpoints",
  design: "Design changes",
  code: "Code captures",
  links: "Link updates",
};
export function VersionPicker({
  kind,
  value,
  onChange,
  refresh,
}: {
  kind: "plan" | "code";
  value: string;
  onChange: (id: string) => void;
  refresh: string;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<keyof typeof categories>(
    kind === "code" ? "code" : "all",
  );
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<z.infer<typeof versionCatalogSchema> | null>(
    null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const pin = useRef<{ key: string; hash: string } | null>(null);
  const key = JSON.stringify([query, category, refresh, retry]);
  useEffect(() => {
    const controller = new AbortController();
    const prior = pin.current?.key === key ? pin.current.hash : undefined;
    const params = new URLSearchParams({
      query,
      category,
      offset: String(offset),
      limit: "20",
    });
    if (value) params.set("selectedId", value);
    if (prior) params.set("catalogHash", prior);
    setBusy(true);
    setError("");
    void api(
      "implementation/versions?" + params.toString(),
      undefined,
      controller.signal,
    )
      .then((raw) => {
        if (controller.signal.aborted) return;
        const result = versionCatalogSchema.parse(raw);
        pin.current = { key, hash: result.catalogHash };
        setPage(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [key, offset, value]);
  const selected =
    page?.selected?.id === value
      ? page.selected
      : page?.items.find((v) => v.id === value);
  const items: Version[] = page?.items ?? [];
  const options =
    selected && !items.some((v) => v.id === selected.id)
      ? [selected, ...items]
      : items;
  const label = kind === "plan" ? "Plan at checkpoint" : "Code version";
  return (
    <section
      className="version-picker"
      aria-label={
        kind === "plan" ? "Plan version selector" : "Code version selector"
      }
    >
      <label>
        Find a {kind === "plan" ? "plan checkpoint" : "code version"}
        <input
          value={query}
          maxLength={256}
          placeholder="Search all retained versions"
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      {kind === "plan" && (
        <label>
          Checkpoint type
          <select
            aria-label="Checkpoint type"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as keyof typeof categories);
              setOffset(0);
            }}
          >
            {Object.entries(categories).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        {label}
        <select
          aria-label={label}
          value={value}
          disabled={busy || !!error}
          onChange={(e) => onChange(e.target.value)}
        >
          {(!value || !options.some((v) => v.id === value)) && (
            <option value={value}>
              {value
                ? "Selected checkpoint is unavailable"
                : "Choose a retained version…"}
            </option>
          )}
          {options.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
              {v.labelCount > 1
                ? ` · ${v.created.slice(0, 19).replace("T", " ")} · ${v.id.slice(0, 8)}`
                : ""}
              {kind === "plan" && v.current ? " · current" : ""}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <p className="version-context">
          {categories[selected.category]} ·{" "}
          <time dateTime={selected.created}>
            {selected.created.replace("T", " ").replace(/\.\d+Z$/, " UTC")}
          </time>
          {page &&
            !page.items.some((v) => v.id === selected.id) &&
            " · selected outside this filtered page"}
        </p>
      )}
      <div className="version-pages">
        <button
          className="text-link"
          disabled={busy || offset === 0 || !!error}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          Previous {kind === "plan" ? "plan checkpoints" : "code versions"}
        </button>
        <span role="status">
          {busy
            ? "Loading versions…"
            : error
              ? "Version list needs refresh"
              : page
                ? `${page.total ? offset + 1 : 0}–${Math.min(offset + items.length, page.total)} of ${page.total}`
                : "No versions loaded"}
        </span>
        <button
          className="text-link"
          disabled={busy || !page || page.nextOffset === null || !!error}
          onClick={() => setOffset(page!.nextOffset!)}
        >
          More {kind === "plan" ? "plan checkpoints" : "code versions"}
        </button>
      </div>
      {page && !busy && !error && page.total === 0 && (
        <p>
          No matching retained versions. Your selected version is unchanged.
        </p>
      )}
      {error && (
        <div role="alert" className="message error">
          <p>{error}</p>
          <button
            onClick={() => {
              setOffset(0);
              setRetry((n) => n + 1);
            }}
          >
            Refresh this version list
          </button>
        </div>
      )}
    </section>
  );
}
