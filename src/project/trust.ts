// SPDX-License-Identifier: MIT
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { ProjectTrust } from "../shared/config.js";

/** D22: the question init asks once, worded as trust. */
export const trustQuestion = [
  "Do you trust this repository?",
  "  Trusted: the languages' official tools may run on it (for Go today, the",
  "    go toolchain, offline and with cgo off). That runs this repository's",
  "    build scripts and macros, as building it would.",
  "  Source only: Pymtheg never runs anything from this repository.",
  "You can change this later in .pymtheg/settings.json (graph.trust).",
].join("\n");

/** What each answer means, as reported after init. */
export function trustSummary(trust: ProjectTrust): string {
  return trust === "trusted"
    ? "Trusted: the languages' official tools may run on this project, as building it would."
    : "Source only: Pymtheg never runs anything from this project.";
}

/**
 * Asks the trust question once on a terminal. Trusted is preselected, since
 * that is the usual case (D22): Enter accepts it.
 */
export async function askTrust(
  input: Readable,
  output: Writable,
): Promise<ProjectTrust> {
  const prompt = createInterface({ input, output, terminal: false });
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
      if (line === null) return "source-only";
      const answer = line.trim().toLowerCase();
      if (answer === "" || answer === "y" || answer === "yes") return "trusted";
      if (answer === "n" || answer === "no") return "source-only";
      output.write('Answer "y" (trusted) or "n" (source only).\n');
    }
  } finally {
    prompt.close();
  }
}
