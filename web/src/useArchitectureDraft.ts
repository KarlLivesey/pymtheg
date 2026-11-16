// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  architectureDraftViewSchema,
  type ArchitectureDraft,
} from "../../src/architecture/draft";
import { DraftWriter } from "../../src/architecture/draft-writer";

export function useArchitectureDraft() {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [ready, setReady] = useState(false),
    [restored, setRestored] = useState<ArchitectureDraft | null>(null),
    [status, setStatus] = useState("Loading draft recovery…"),
    [error, setError] = useState("");
  const writer = useRef<DraftWriter | null>(null);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    void api("architecture/draft", undefined, controller.signal)
      .then((raw) => {
        if (!live) return;
        const result = architectureDraftViewSchema.parse(raw);
        writer.current = new DraftWriter(
          result.version,
          result.draft,
          async (version, draft) =>
            architectureDraftViewSchema.parse(
              await api("architecture/draft", { version, draft }),
            ),
          (status, error) => {
            if (live) {
              setStatus(status);
              setError(error);
            }
          },
        );
        setRestored(result.draft);
        setReady(true);
        setError("");
        setStatus("Draft recovery ready");
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [refreshVersion]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (writer.current?.pending || writer.current?.blocked) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  function persist(value: ArchitectureDraft | null) {
    writer.current?.persist(value);
  }
  async function clear() {
    if (!writer.current) throw Error("Draft recovery is not ready");
    await writer.current.clear();
    setRestored(null);
  }
  async function afterCommit() {
    if (!writer.current)
      return "The design was saved. Recovery is not ready; reload to review saved drafts.";
    const warning = await writer.current.finishCommitted(() => {
      setReady(false);
      setRestored(null);
      setRefreshVersion((n) => n + 1);
    });
    if (!warning) setRestored(null);
    return warning;
  }
  function download() {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(writer.current?.value ?? restored, null, 2)], {
          type: "application/json",
        }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = "architecture-draft.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return {
    refresh: () => {
      if (
        writer.current?.pending ||
        writer.current?.blocked ||
        writer.current?.value
      )
        throw Error(
          "Keep or discard the current recovery draft before loading another.",
        );
      setReady(false);
      setRefreshVersion((n) => n + 1);
    },
    ready,
    restored,
    status,
    error,
    persist,
    clear,
    afterCommit,
    download,
    dismiss: () => setRestored(null),
    keep: () => {
      setRestored(writer.current?.value ?? null);
    },
  };
}
