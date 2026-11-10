import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const doc = {
  path: "catalogue.json",
  text: JSON.stringify({
    types: {
      Payload: { number: 1, owner: "contract", rule: "Complete original rule" },
    },
    functions: [
      {
        id: "service.save",
        symbol: "F1",
        name: "save",
        owner: "service",
        status: "specified_not_implemented",
        args: { payload: "Payload" },
        returns: "Unit",
        description: "Save a payload",
        unknownFutureField: { keep: true },
        edges: [],
      },
    ],
  }),
};
test("architecture API preserves imported records, edits a stored copy and keeps prior revisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-arch-api-"));
  let app;
  try {
    app = await startStudio({ path: root });
    const req = async (path, body) => {
      const r = await fetch(new URL("/api/" + path, app.url), {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + app.token,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const value = await r.json();
      assert.equal(r.status, 200, JSON.stringify(value));
      return value;
    };
    const first = await req("architecture/import", {
      label: "first",
      documents: [doc],
    });
    const record = await req(
      "architecture/record?revision=" + first.id + "&id=function%3AF1",
    );
    assert.equal(record.data.unknownFutureField.keep, true);
    assert.equal(record.entity.status, "specified_not_implemented");
    const next = await req("architecture/document", {
      revision: first.id,
      path: "decisions.md",
      text: "# A decision\nStill proposed.",
      label: "Decision added",
    });
    assert.notEqual(next.id, first.id);
    const old = await req("architecture/export?revision=" + first.id);
    assert.equal(
      old.documents.filter((d) => !d.path.startsWith(".pymtheg")).length,
      1,
    );
    assert.equal(old.documents.find((d) => d.path === doc.path).text, doc.text);
    const full = await req("architecture/export?revision=" + next.id);
    assert.equal(
      full.documents.filter((d) => !d.path.startsWith(".pymtheg")).length,
      2,
    );
    assert.equal(full.revision.label, "Decision added");
    assert.equal((await req("architecture")).revisions.length, 2);
    const search = await req(
      "architecture/search?revision=" +
        next.id +
        "&q=" +
        encodeURIComponent("Still proposed"),
    );
    assert.equal(search[0].path, "decisions.md");
    assert.match(search[0].snippet, /Still proposed/);
    const planned = await req("architecture/plan", {
      revision: next.id,
      label: "Record durability requirement",
      item: {
        id: "durability",
        kind: "requirement",
        title: "Retain the accepted write",
        owner: "service",
        status: "proposed",
        detail: "A crash must preserve acknowledged data.",
        acceptance: "Restart after acknowledgement and read the same data.",
        evidence: "",
        evidenceRevision: "",
        links: [{ kind: "depends-on", target: "function:F1" }],
      },
    });
    assert.ok(
      planned.entities.some(
        (e) => e.id === "plan:durability" && e.status === "proposed",
      ),
    );
    assert.ok(
      (
        await req(
          "architecture/record?revision=" + planned.id + "&id=function%3AF1",
        )
      ).dependents.includes("plan:durability"),
    );
    assert.equal(
      (await req("architecture/export?revision=" + next.id)).documents.filter(
        (d) => !d.path.startsWith(".pymtheg"),
      ).length,
      2,
    );
    const restored = await req("architecture/import", {
      label: "Reimport complete bundle",
      bundle: { ...full, index: { ...full.index, indexVersion: 2 } },
    });
    assert.ok(
      restored.entities.some((e) => e.id === "plan:durability"),
      "Adding an older bundle must keep the newer active native plan",
    );
    const bad = structuredClone(full);
    bad.documents[0].text += " ";
    const failed = await fetch(new URL("/api/architecture/import", app.url), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + app.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label: "Forged", bundle: bad }),
    });
    assert.equal(failed.status, 400);
    assert.match((await failed.json()).error, /identity/);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
