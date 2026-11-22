// SPDX-License-Identifier: MIT
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { ProjectTrust } from "../shared/config.js";

/** D22: the question init asks once, worded as trust. */
export const trustQuestion = [
  "Do you trust this repository?",
  "  Trusted: the languages' official build tools may run on this project;",
  "    for some languages that runs the repository's build scripts and",
  "    macros, as building it would.",
  "  Source only: Pymtheg never runs anything from this repository.",
  "The answer is kept for this checkout on this machine only (.pymtheg/local/trust.json).",
].join("\n");

/** D22: how a checkout with no answer on this machine gets one. */
export const trustAnswerHow =
  'No trust answer on this machine, so nothing from this repository is run. Answer once: pymtheg init (asks on a terminal), pymtheg init --trust or --source-only, or over MCP pass trust: "trusted" or "source-only" to code_graph after asking your user "Do you trust this repository?".';

/** What each answer means, as reported after init. */
export function trustSummary(trust: ProjectTrust): string {
  return trust === "trusted"
    ? "Trusted: the languages' official build tools may run on this project; for some languages that runs its build scripts and macros, as building it would."
    : "Source only: Pymtheg never runs anything from this project.";
}

/** The prompt was cancelled (Ctrl-C): nothing is answered or written. */
export class TrustCancelled extends Error {
  constructor() {
    super("Cancelled at the trust question; nothing was written.");
  }
}

/**
 * Asks the trust question once on a terminal. Trusted is preselected, since
 * that is the usual case (D22): Enter accepts it. An aborted `signal`
 * (Ctrl-C) closes the prompt and rejects with TrustCancelled.
 */
export async function askTrust(
  input: Readable,
  output: Writable,
  signal?: AbortSignal,
): Promise<ProjectTrust> {
  signal?.throwIfAborted();
  const prompt = createInterface({ input, output, terminal: false });
  let aborted = false;
  const abort = () => {
    aborted = true;
    prompt.close();
  };
  signal?.addEventListener("abort", abort, { once: true });
  // Input that ends without an answer is no answer: nothing is trusted.
  const ended = new Promise<null>((resolve) =>
    prompt.once("close", () => resolve(null)),
  );
  try {
    output.write(trustQuestion + "\n");
    for (;;) {
      const line = await Promise.race([
        prompt.question("Trust this repository? [Y/n] "),
        ended,
      ]);
      if (aborted || signal?.aborted) throw new TrustCancelled();
      if (line === null) return "source-only";
      const answer = line.trim().toLowerCase();
      if (answer === "" || answer === "y" || answer === "yes") return "trusted";
      if (answer === "n" || answer === "no") return "source-only";
      output.write('Answer "y" (trusted) or "n" (source only).\n');
    }
  } catch (error) {
    if (aborted || signal?.aborted) throw new TrustCancelled();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    prompt.close();
  }
}
