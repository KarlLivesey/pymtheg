import type { GraphJob } from "./graph-jobs.js";
export interface GraphDeadline {
  expired: Promise<void>;
  clear(): void;
}
/** The deadline selects a response shape; it never decides whether a graph is valid. */
export function graphDeadline(milliseconds: number): GraphDeadline {
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, milliseconds);
  });
  return { expired, clear: () => clearTimeout(timer) };
}
export async function waitForGraph(
  job: GraphJob,
  signal: AbortSignal,
  cancel: () => Promise<unknown>,
  progress: (value: unknown) => void,
  deadline: GraphDeadline | null,
): Promise<void> {
  const abort = () => {
    void cancel();
  };
  job.listeners.add(progress);
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) abort();
    if (deadline) await Promise.race([job.done, deadline.expired]);
    else await job.done;
    // A cancelled request still joins its worker, even if its deadline also fired.
    if (signal.aborted) await job.done;
  } finally {
    deadline?.clear();
    job.listeners.delete(progress);
    signal.removeEventListener("abort", abort);
  }
}
