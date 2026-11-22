// SPDX-License-Identifier: MIT
import { useState } from "react";
import {
  projectSetupSchema,
  type ProjectSetup as Setup,
} from "../../src/shared/project-setup";
import type { WorkspaceIdentity } from "../../src/shared/workspace";
import { api, ApiError } from "./api";
import { ImportConflicts } from "./ImportConflicts";
import type { z } from "zod";
import type { importResolutionSchema } from "../../src/architecture/schema";
export function ProjectSetup({
  name,
  workspace,
  trust: current,
  onUpdate,
  onClose,
}: {
  name: string;
  workspace: WorkspaceIdentity | null;
  /** D22: the trust that applies on this machine (null before init). */
  trust: "trusted" | "source-only" | "unanswered" | null;
  onUpdate: (value: Setup) => void;
  onClose: () => void;
}) {
  const [projectName, setProjectName] = useState(workspace?.name ?? name),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Setup | null>(null);
  const [allowBrokenLinks, setAllowBrokenLinks] = useState(false);
  // D22: asked when this checkout has no answer on this machine (a new
  // project, or a clone of an initialised one); trusted is preselected.
  const [trust, setTrust] = useState<"trusted" | "source-only">("trusted");
  const ask = !workspace || current === "unanswered";
  async function run(
    importDocuments: boolean,
    resolutions?: z.infer<typeof importResolutionSchema>[],
  ) {
    setBusy(true);
    setError("");
    try {
      const value = projectSetupSchema.parse(
        await api("project/initialize", {
          name: projectName,
          importDocuments,
          allowBrokenLinks,
          ...(ask ? { trust } : {}),
          ...(resolutions ? { resolutions } : {}),
          ...(importDocuments || resolutions
            ? { previewToken: result?.documentation.previewToken }
            : {}),
        }),
      );
      setResult(value);
      if (!importDocuments) setAllowBrokenLinks(false);
      onUpdate(value);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setResult(null);
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  const docs = result?.documentation;
  return (
    <div className="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-setup-title"
        className="modal"
        onKeyDown={(event) => {
          if (busy && event.key === "Escape") event.stopPropagation();
        }}
      >
        <h2 id="project-setup-title">Set up this project</h2>
        <p>
          Start empty, or bring in existing design documents. Your source files
          and existing plans are preserved.
        </p>
        <p>
          Project identity and design files can be committed with your
          repository. Planning history stays local until you share an export
          from Architecture → Export all history.
        </p>
        <label>
          Project name
          <input
            className="text-input"
            autoFocus
            value={projectName}
            maxLength={160}
            disabled={busy || !!workspace || !!result}
            onChange={(event) => setProjectName(event.target.value)}
          />
        </label>
        {ask && !result && (
          <fieldset className="trust-question">
            <legend>Do you trust this repository?</legend>
            <label>
              <input
                type="radio"
                name="trust"
                checked={trust === "trusted"}
                disabled={busy}
                onChange={() => setTrust("trusted")}
              />{" "}
              Trusted: the languages' official tools may run on it, which runs
              its build scripts and macros as building it would.
            </label>
            <label>
              <input
                type="radio"
                name="trust"
                checked={trust === "source-only"}
                disabled={busy}
                onChange={() => setTrust("source-only")}
              />{" "}
              Source only: Pymtheg starts no program on this repository's
              behalf, neither a build tool nor Git; it only reads files.
            </label>
          </fieldset>
        )}
        {result?.trust && result.trust !== "unanswered" && (
          <p>
            {result.trust === "trusted"
              ? "Trusted: the languages' official tools may run on this project."
              : "Source only: Pymtheg starts no program on this project's behalf; it only reads files."}{" "}
            Kept for this checkout in your own Pymtheg configuration, never in
            the repository; run pymtheg trust --revoke to answer again.
          </p>
        )}
        {!result && (
          <button
            className="button primary"
            disabled={busy || !projectName.trim()}
            onClick={() => void run(false)}
          >
            {busy
              ? "Preparing project…"
              : workspace
                ? "Review project setup"
                : "Create project workspace"}
          </button>
        )}
        {error && <p role="alert">{error}</p>}
        {docs && (
          <section aria-label="Existing documentation">
            {docs.status === "none" ? (
              <p>
                Your workspace is ready. There are no existing design documents
                to import; start with a requirement or a component.
              </p>
            ) : docs.status === "unavailable" ? (
              <p>
                Workspace ready. Documentation could not be previewed:{" "}
                {docs.message}
              </p>
            ) : (
              <>
                <p>
                  {docs.total === 0 ? (
                    "No upstream design documents remain. Review the changes below."
                  ) : (
                    <>
                      {docs.total} existing{" "}
                      {docs.total === 1 ? "document" : "documents"}
                      {docs.status === "imported"
                        ? " imported into this project"
                        : docs.status === "unchanged"
                          ? ` already ${docs.total === 1 ? "matches" : "match"} the saved architecture`
                          : " found; nothing imported yet"}
                      .
                    </>
                  )}
                </p>
                {docs.changes && (
                  <section aria-label="Documentation changes">
                    <p>
                      {docs.changes.added.length} added,{" "}
                      {docs.changes.changed.length} changed,{" "}
                      {docs.changes.removed.length} removed.
                    </p>
                    {(["added", "changed", "removed"] as const).map(
                      (kind) =>
                        docs.changes![kind].length > 0 && (
                          <div key={kind}>
                            <strong>
                              {kind === "added"
                                ? "Added"
                                : kind === "changed"
                                  ? "Changed"
                                  : "Removed"}
                            </strong>
                            <ul>
                              {docs.changes![kind].slice(0, 20).map((path) => (
                                <li key={path}>{path}</li>
                              ))}
                            </ul>
                            {docs.changes![kind].length > 20 && (
                              <p>
                                {docs.changes![kind].length - 20} more {kind}{" "}
                                paths; the full preview retains them.
                              </p>
                            )}
                          </div>
                        ),
                    )}
                  </section>
                )}
                <ul>
                  {docs.files?.slice(0, 20).map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
                {(docs.total ?? 0) > 20 && (
                  <p>Showing the first 20 document paths.</p>
                )}
                {docs.warnings?.map((warning, i) => (
                  <p key={i}>{warning}</p>
                ))}
                {!!docs.review?.conflicts.length && (
                  <ImportConflicts
                    key={docs.previewToken}
                    conflicts={docs.review.conflicts}
                    busy={busy}
                    onReview={(choices) => void run(false, choices)}
                  />
                )}
                {!!docs.review?.newlyBrokenAuthoredLinks.length && (
                  <section aria-label="Planning links affected by setup">
                    <h3>This import breaks planning links</h3>
                    <ul>
                      {docs.review.newlyBrokenAuthoredLinks.map((link, i) => (
                        <li key={i}>
                          {link.name}: {link.target}
                        </li>
                      ))}
                    </ul>
                    <label>
                      <input
                        type="checkbox"
                        checked={allowBrokenLinks}
                        onChange={(e) => setAllowBrokenLinks(e.target.checked)}
                      />
                      Keep the old revisions and import with these unresolved
                      links
                    </label>
                  </section>
                )}
                {(docs.status === "preview" ||
                  docs.status === "needs_review") &&
                  !docs.review?.conflicts.length && (
                    <button
                      className="button primary"
                      disabled={
                        busy ||
                        (!!docs.review?.newlyBrokenAuthoredLinks.length &&
                          !allowBrokenLinks)
                      }
                      onClick={() => void run(true)}
                    >
                      {busy
                        ? "Importing documents…"
                        : docs.total === 0
                          ? "Apply document removals"
                          : `Import ${docs.total} ${docs.total === 1 ? "document" : "documents"}`}
                    </button>
                  )}
                <p>
                  Imported text is retained in full. Importing does not verify
                  its claims.
                </p>
              </>
            )}
          </section>
        )}
        <div className="modal-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            {result ? "Continue designing" : "Close"}
          </button>
        </div>
      </section>
    </div>
  );
}
