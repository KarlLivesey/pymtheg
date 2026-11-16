// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStudio } from "../dist/studio/server.js";
const source =
  "op read() -> Unit cost calls exact 1; flow f() -> Unit { call read(); }";
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "pym-studio-"));
  let app;
  try {
    await writeFile(join(dir, "main.pym"), source);
    app = await startStudio({ path: dir });
    await fn(app, dir);
  } finally {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  }
}
function api(app, path, body, extra = {}) {
  return fetch(new URL(path, app.url), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + app.token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
test("local API is authenticated and blocks cross-origin access and escaping paths", async () =>
  fixture(async (app, dir) => {
    assert.equal((await fetch(new URL("/api/project", app.url))).status, 401);
    assert.equal(
      (
        await api(app, "/api/project", undefined, {
          Origin: "https://evil.invalid",
        })
      ).status,
      403,
    );
    const project = await (await api(app, "/api/project")).json();
    assert.equal(project.files[0].text, source);
    const p = await api(app, "/api/save", {
      path: "../outside.pym",
      text: "bad",
      expectedHash: null,
    });
    assert.equal(p.status, 403);
    await symlink("/tmp", join(dir, "escape"));
    assert.equal(
      (
        await api(app, "/api/save", {
          path: "escape/outside.pym",
          text: "bad",
          expectedHash: null,
        })
      ).status,
      403,
    );
  }));
test("save uses an expected hash and preserves an external edit on conflict", async () =>
  fixture(async (app, dir) => {
    const initial = await (await api(app, "/api/project")).json();
    await writeFile(join(dir, "main.pym"), "external edit");
    const response = await api(app, "/api/save", {
      path: "main.pym",
      text: "my edit",
      expectedHash: initial.files[0].hash,
    });
    assert.equal(response.status, 409);
    assert.equal(
      await readFile(join(dir, "main.pym"), "utf8"),
      "external edit",
    );
  }));
test("Studio uses real unsaved compiler inputs and retains versioned results", async () =>
  fixture(async (app) => {
    const complete = new Promise((resolve) => {
      const off = app.service.subscribe((e) => {
        if (e.kind === "run" && e.run.status === "completed") {
          off();
          resolve(e.run);
        }
      });
    });
    const req = {
      clientId: "test",
      revision: 2,
      file: "main.pym",
      buffers: {
        "main.pym": source.replace("call read();", "call read(); call read();"),
      },
      kind: "check",
      entry: "f",
      seed: "42",
      maxSteps: 6,
      maxSamples: 10,
    };
    assert.equal((await api(app, "/api/run", req)).status, 202);
    const run = await complete;
    assert.equal(run.request.revision, 2);
    assert.equal(
      run.report.results.find((r) => r.propertyId.includes("#f/cost/"))
        .witnessOrDerivation.maximum,
      "2",
    );
    assert.deepEqual(run.report.session.staleFiles, []);
  }));
test("named scenarios save the validated scope and refuse configuration conflicts", async () =>
  fixture(async (app, dir) => {
    const original = await app.service.project();
    const saved = await app.service.saveScenario(
      "small",
      { file: "main.pym", entry: "f", scope: {} },
      original.configHash,
    );
    assert.equal(saved.config.scenarios.small.entry, "f");
    const external = {
      version: 1,
      scenarios: { other: { file: "main.pym", entry: "f" } },
    };
    await mkdir(join(dir, ".pymtheg"), { recursive: true });
    await writeFile(
      join(dir, ".pymtheg/settings.json"),
      JSON.stringify(external),
    );
    await assert.rejects(
      () =>
        app.service.saveScenario(
          "small",
          { file: "main.pym", entry: "f" },
          saved.hash,
        ),
      /changed on disk/,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(dir, ".pymtheg/settings.json"), "utf8")),
      external,
    );
  }));
test("a corrupt recovery database is reported without altering source or suppressing local checks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pym-corrupt-recovery-"));
  let app;
  try {
    const { mkdir } = await import("node:fs/promises");
    await writeFile(join(dir, "main.pym"), source);
    await mkdir(join(dir, ".pymtheg/shared"), { recursive: true });
    const damaged = "not a sqlite database";
    await writeFile(join(dir, ".pymtheg/shared/drafts.sqlite"), damaged);
    app = await startStudio({ path: dir });
    const project = await app.service.project();
    assert.equal(project.recovery.enabled, false);
    assert.match(project.recovery.error, /Recovery unavailable/);
    assert.equal(project.files[0].text, source);
    const finished = new Promise((resolve) => {
      const off = app.service.subscribe((e) => {
        if (e.kind === "run" && e.run.status === "completed") {
          off();
          resolve(e.run);
        }
      });
    });
    await app.service.start({
      clientId: "recovery-test",
      revision: 0,
      file: "main.pym",
      buffers: {},
      kind: "check",
      entry: "f",
      seed: "42",
      maxSteps: 6,
      maxSamples: 10,
    });
    const run = await finished;
    assert.ok(run.report.results.some((r) => r.completion === "complete"));
    assert.equal(
      await readFile(join(dir, ".pymtheg/shared/drafts.sqlite"), "utf8"),
      damaged,
    );
  } finally {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("source creation protects existing and excluded files and creates requested folders", async () =>
  fixture(async (app, root) => {
    await assert.rejects(
      app.service.save("main.pym", "", null),
      /already exists/,
    );
    await app.service.save("missing/new.pym", "", null);
    assert.equal(await readFile(join(root, "missing/new.pym"), "utf8"), "");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "dist"));
    await assert.rejects(
      app.service.save("dist/new.pym", "", null),
      /excluded/,
    );
    await mkdir(join(root, "research"));
    await mkdir(join(root, ".pymtheg"), { recursive: true });
    await writeFile(
      join(root, ".pymtheg/settings.json"),
      JSON.stringify({
        version: 1,
        scenarios: {},
        sources: { include: ["**/*.pym"] },
      }),
    );
    await app.service.save(
      "research/design.pym",
      "flow main() -> Unit {}",
      null,
    );
    assert.ok(
      (await app.service.files()).some((f) => f.path === "research/design.pym"),
    );
  }));
