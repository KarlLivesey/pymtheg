// SPDX-License-Identifier: MIT
import type { Snapshot } from "../language/project.js";
import type { ProjectIR } from "../semantic/core.js";
import type { Report } from "../reporting/report.js";
export type AnalysisProgress =
  | { kind: "snapshot"; value: Snapshot }
  | { kind: "partial"; value: Report };
export type WorkerMessage =
  | AnalysisProgress
  | {
      kind: "done";
      value: {
        ir: ProjectIR;
        report: Report;
        sourceCatalogue?: import("./source-contracts.js").SourceCatalogue;
      };
    }
  | { kind: "failed"; value: string };
