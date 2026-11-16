// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
import { newPlanItem } from "../dist/architecture/planning.js";

test("source refresh and concurrent plan edits expose different recovery actions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-source-review-api-"));
  let app;
  try {
    const path = join(root, "source.pym");
    await writeFile(path, "flow decide() -> Bool { return true; }");
    app = await startStudio({ path: root });
    const call = (endpoint, data) =>
      fetch(new URL("/api/" + endpoint, app.url), {
        method: data ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + app.token,
          ...(data ? { "Content-Type": "application/json" } : {}),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    const viewed = await (await call("architecture/source-contracts")).json();
    await writeFile(path, "flow decide() -> Bool {\n  return true;\n}");
    const item = {
      ...newPlanItem("R1"),
      title: "Reviewed source",
      sourceSelectionSnapshot: viewed.snapshotId,
      links: [{ kind: "depends-on", target: "source:source.pym#decide" }],
    };
    const stale = await call("architecture/plan", {
      revision: "",
      label: "Reviewed source",
      item,
    });
    assert.equal(stale.status, 409);
    const issue = await stale.json();
    assert.equal(issue.conflictKind, "request");
    assert.match(issue.error, /Source changed since review/);
    const fresh = await (await call("architecture/source-contracts")).json();
    item.sourceSelectionSnapshot = fresh.snapshotId;
    const response = await call("architecture/plan", {
      revision: "",
      label: "Reviewed source",
      item,
    });
    assert.equal(
      response.status,
      200,
      JSON.stringify(await response.clone().json()),
    );
    const saved = await response.json();
    const record = await app.service.architectureRecord(saved.id, "plan:R1");
    const target = { document: record.entity.document, originalId: "R1" };
    await app.service.savePlanItem(
      saved.id,
      { ...record.data, title: "Concurrent edit" },
      "Other editor",
      new AbortController().signal,
      target,
    );
    const conflict = await call("architecture/plan", {
      revision: saved.id,
      label: "My edit",
      target,
      item: { ...record.data, title: "My different edit" },
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).conflictKind, "architecture");
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
