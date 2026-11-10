import { parentPort, workerData } from "node:worker_threads";
import { analyseFile } from "../analysis/index.js";
import { sourceCatalogue } from "../architecture/source-contracts.js";
try {
  const {
    file,
    buffers,
    root,
    projectWide,
    related,
    sourcePolicy,
    additionalEntries,
  } = workerData as {
    file: string;
    buffers?: Record<string, string>;
    root?: string;
    projectWide?: boolean;
    related?: boolean;
    sourcePolicy?: import("../shared/source-policy.js").SourcePolicy;
    additionalEntries?: string[];
  };
  const options = {
    ...(additionalEntries ? { additionalEntries } : {}),
    ...(projectWide ? { projectWide } : {}),
    ...(related ? { related } : {}),
    ...(sourcePolicy ? { sourcePolicy } : {}),
    ...(buffers ? { buffers } : {}),
    ...(root ? { root } : {}),
  };
  const r = analyseFile(
    file,
    (message) => parentPort!.postMessage(message),
    options,
  );
  const catalogue = workerData.sourceContracts
    ? sourceCatalogue(r.ir, root!)
    : undefined;
  parentPort!.postMessage({
    kind: "done",
    value: { ...r, sourceCatalogue: catalogue },
  });
} catch (e) {
  parentPort!.postMessage({ kind: "failed", value: String(e) });
}
