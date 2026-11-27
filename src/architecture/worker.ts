// SPDX-License-Identifier: MIT
import "../shared/quiet-warnings.js";
import { errorMessage } from "../shared/error-message.js";
import { prepareHeadingIdentities } from "./heading-identities.js";
import { parentPort, workerData } from "node:worker_threads";
import { validateHistory } from "./history.js";
import { indexArchitecture } from "./model.js";
try {
  parentPort!.postMessage({
    kind: "indexed",
    value: Array.isArray(workerData)
      ? indexArchitecture(workerData)
      : workerData.kind === "prepare"
        ? (() => {
            const documents = prepareHeadingIdentities(
              workerData.current,
              workerData.next,
            );
            return { documents, index: indexArchitecture(documents) };
          })()
        : validateHistory(workerData.archive),
  });
} catch (error) {
  parentPort!.postMessage({ kind: "failed", message: errorMessage(error) });
}
