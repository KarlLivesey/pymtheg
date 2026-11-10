import test from "node:test";
import assert from "node:assert/strict";
import { reportStatus } from "../dist/reporting/status.js";
import { emptyReport } from "../dist/reporting/report.js";
test("a completed session with unresolved evidence is visibly not fully checked", () => {
  const report = emptyReport("check");
  report.session.state = "Completed";
  report.results = [{ completion: "incomplete", outcome: "inconclusive" }];
  assert.equal(reportStatus(report), "Not fully checked");
  report.results = [];
  assert.equal(reportStatus(report), "Requested checks finished");
  report.session.staleFiles = ["changed.pym"];
  assert.equal(reportStatus(report), "Earlier source snapshot");
});
