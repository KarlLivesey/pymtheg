import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ProjectView } from "../../src/studio/protocol";
import type { SavedWorkspace } from "../../src/studio/recovery";
export function useRecovery(
  project: ProjectView | null,
  workspace: SavedWorkspace,
) {
  const owner = useRef(crypto.randomUUID());
  const [status, setStatus] = useState<
    "loading" | "saving" | "saved" | "error"
  >("loading");
  const [error, setError] = useState("");
  const [acknowledged, setAcknowledged] = useState<{
    text: string;
    revision: number;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const revision = useRef<number | null>(null),
    pending = useRef<string | null>(null),
    busy = useRef(false),
    stopped = useRef(false);
  const text = JSON.stringify(workspace);
  useEffect(() => {
    if (!project) return;
    if (!project.recovery.enabled) {
      setStatus("error");
      setError(
        project.recovery.error ??
          "Local recovery is unavailable. Save your source before closing.",
      );
      return;
    }
    if (revision.current === null) revision.current = project.recovery.revision;
    if (stopped.current) return;
    pending.current = text;
    setStatus("saving");
    async function save() {
      if (busy.current) return;
      busy.current = true;
      try {
        while (pending.current !== null && !stopped.current) {
          const next = pending.current;
          pending.current = null;
          const result = await api("recovery", {
            expectedRevision: revision.current,
            owner: owner.current,
            workspace: JSON.parse(next) as unknown,
          });
          if (
            !result ||
            typeof result !== "object" ||
            !("revision" in result) ||
            typeof result.revision !== "number"
          )
            throw Error("Invalid recovery acknowledgement");
          revision.current = result.revision;
          setAcknowledged({ text: next, revision: result.revision });
        }
        if (!stopped.current) setStatus("saved");
      } catch (e) {
        stopped.current = true;
        setStatus("error");
        setError(
          `Local recovery was not saved. ${String(e)} Keep this window open or save your source files.`,
        );
      } finally {
        busy.current = false;
      }
    }
    void save();
  }, [project?.recovery.enabled, text, retry]);
  const effectiveStatus =
    status === "saved" && acknowledged?.text !== text ? "saving" : status;
  const hasDraft =
    workspace.drafts.length > 0 ||
    !!workspace.context?.typeDraft ||
    !!workspace.context?.declarationDraft ||
    !!workspace.context?.operationDraft ||
    !!workspace.context?.implementationDrafts?.length ||
    !!workspace.context?.rangeDrafts?.length ||
    !!workspace.context?.interfaceDraft ||
    !!workspace.context?.newDesign;
  useEffect(() => {
    if (
      effectiveStatus !== "saving" &&
      !(effectiveStatus === "error" && hasDraft)
    )
      return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [effectiveStatus, hasDraft]);
  return {
    observeExternal: (event: { revision: number; owner: string | null }) => {
      if (
        event.owner === owner.current ||
        event.revision <= (revision.current ?? -1)
      )
        return;
      stopped.current = true;
      setStatus("error");
      setError(
        "Another Studio window now owns recovery. This window’s source and forms are kept here, but its recovery is paused. Review recovery before taking ownership back.",
      );
    },
    status: effectiveStatus,
    acknowledgedRevision: acknowledged?.revision ?? null,
    currentAcknowledged: acknowledged?.text === text,
    error,
    resume: (reviewedRevision: number) => {
      revision.current = reviewedRevision;
      stopped.current = false;
      setError("");
      setRetry((n) => n + 1);
    },
  };
}
