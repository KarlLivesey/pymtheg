// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { startStudio } from "../dist/studio/server.js";

test("invalid writes, invalid archives and store contention return actionable request errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-request-errors-"));
  let app;
  try {
    app = await startStudio({ path: root });
    const request = async (path, data) => {
      const response = await fetch(new URL("/api/" + path, app.url), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + app.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });
      return { status: response.status, body: await response.json() };
    };
    const missing = await request("implementation/observe", {
      files: ["a.ts"],
      label: "Capture",
    });
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /Invalid request:.*expectedRevision/);
    assert.ok(!missing.body.error.includes('"code"'));
    const invalid = await request("architecture/history-preview", {
      schema: "not-an-archive",
    });
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.error, /Nothing was imported/);
    assert.equal((await app.service.architectureOverview()).index, null);
    assert.ok(!invalid.body.error.includes('"code"'));
    const missingFile = await request("implementation/observe", {
      files: ["absent.ts"],
      label: "Missing",
      expectedRevision: null,
    });
    assert.equal(missingFile.status, 400);
    assert.match(missingFile.body.error, /not found/);
    for (const [file, message] of [
      [".", /Choose source files/],
      ["../outside.ts", /outside the project root/],
    ]) {
      const refused = await request("implementation/observe", {
        files: [file],
        label: "Invalid source choice",
        expectedRevision: null,
      });
      assert.equal(refused.status, 400);
      assert.match(refused.body.error, message);
      assert.equal((await app.service.architectureOverview()).index, null);
    }
    const versions = await fetch(
      new URL("/api/implementation/versions?limit=-5", app.url),
      { headers: { Authorization: "Bearer " + app.token } },
    );
    const invalidPage = await versions.json();
    assert.equal(versions.status, 400);
    assert.ok(!invalidPage.error.includes('"code"'));
    app.service.exportArchitectureHistory = async () => {
      throw Error(
        "Portable history exceeds the 64 MiB archive limit. Existing history was not changed.",
      );
    };
    const exported = await fetch(
      new URL("/api/architecture/history", app.url),
      { headers: { Authorization: "Bearer " + app.token } },
    );
    const quota = await exported.json();
    assert.equal(exported.status, 413);
    assert.match(quota.error, /individual revision/);
    assert.match(quota.error, /no revision-subset option/);
    app.service.observeImplementation = async () => {
      throw Error("database is locked");
    };
    const busy = await request("implementation/observe", {});
    assert.equal(busy.status, 503);
    assert.match(busy.body.error, /another writer.*Retry/);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("architecture read routes return 400 for bad paging and 404 for missing retained content", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-read-errors-"));
  let app, store;
  try {
    store = await ArchitectureStore.open(root);
    const saved = store.save("Docs", "fixture", [
      { path: "readme.md", text: "# Hello" },
    ]);
    store.close();
    store = null;
    app = await startStudio({ path: root });
    const get = async (path, params) => {
      const url = new URL("/api/architecture/" + path, app.url);
      for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, String(value));
      const response = await fetch(url, {
        headers: { Authorization: "Bearer " + app.token },
      });
      return { status: response.status, body: await response.json() };
    };
    for (const path of ["document", "export", "search-page", "record"]) {
      const missing = await get(path, {
        revision: "unknown",
        path: "readme.md",
        q: "Hello",
        id: "missing",
      });
      assert.equal(missing.status, 404, JSON.stringify(missing));
    }
    assert.equal(
      (await get("document", { revision: saved.id, path: "missing.md" }))
        .status,
      404,
    );
    for (const params of [
      { offset: -1 },
      { offset: "NaN" },
      { offset: 0.5 },
      { limit: 0 },
      { limit: 101 },
      { limit: "oops" },
    ])
      assert.equal(
        (
          await get("search-page", {
            revision: saved.id,
            q: "Hello",
            ...params,
          })
        ).status,
        400,
      );
    assert.equal(
      (await get("search-page", { revision: saved.id, q: "Hello" })).status,
      200,
    );
  } finally {
    await app?.close();
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("implementation and review history reject unknown requested revisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-version-errors-"));
  let app, store;
  try {
    store = await ArchitectureStore.open(root);
    const saved = store.save("Known", "fixture", [
      { path: "a.md", text: "# Known" },
    ]);
    store.close();
    store = null;
    app = await startStudio({ path: root });
    for (const query of [
      { planRevision: "missing" },
      { planRevision: saved.id, codeRevision: "missing" },
    ]) {
      const response = await fetch(new URL("/api/implementation", app.url), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + app.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(query),
      });
      assert.equal(response.status, 404, JSON.stringify(await response.json()));
    }
    await assert.rejects(
      app.service.branchReviewHistory("missing"),
      (error) => error.status === 404,
    );
  } finally {
    await app?.close();
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
