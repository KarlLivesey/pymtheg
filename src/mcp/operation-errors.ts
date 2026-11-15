/** Presentation of operational failures shared by owned MCP workers. Never retries writes. */
export function operationError(error: unknown, fallback = "error") {
  const e = error as {
    code?: string;
    errcode?: number;
    message?: string;
    action?: string;
    retryable?: boolean;
  };
  const message = String(e?.message ?? error);
  const code = typeof e?.code === "string" ? e.code : fallback;
  // A library code is authoritative; user-supplied identifiers in its message
  // can contain words such as SQLITE_BUSY without being database failures.
  const libraryCode = [
    "invalid-input",
    "link-not-found",
    "link-ambiguous",
    "ambiguous-selector",
    "selector-not-found",
    "record-conflict",
    "graph-changed",
  ].includes(code);
  const locked =
    code === "locked" ||
    e?.errcode === 5 ||
    e?.errcode === 6 ||
    (!libraryCode &&
      /database (?:is )?locked|SQLITE_(?:BUSY|LOCKED)/i.test(message));
  const collision =
    (typeof e?.errcode === "number" && (e.errcode & 255) === 19) ||
    /(?:UNIQUE|FOREIGN KEY) constraint failed|Invalid or duplicate added link origin\/key/i.test(
      message,
    );
  if (locked || collision)
    return {
      code: locked ? "locked" : "concurrent-update",
      message: locked
        ? "Another writer is holding the project database."
        : "A database update could not commit; another server may be indexing or writing this project.",
      retryable: true,
      action:
        "Wait for other indexing/writing jobs to finish, then explicitly retry. Reconcile interrupted mutations with list, unlinked, history or read_architecture first; a prior write may already have committed. If this repeats, report the failure. No complete answer is claimed.",
    };
  return {
    code,
    message: message.slice(0, 2048),
    retryable:
      e?.retryable ??
      (code === "graph-changed" ||
        code === "busy" ||
        code === "concurrent-update"),
    action:
      e?.action ??
      "Correct the input, finish active jobs, or narrow the query. Reconcile interrupted mutations before retrying. No complete answer is claimed.",
  };
}
