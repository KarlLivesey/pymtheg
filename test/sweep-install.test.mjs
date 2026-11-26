// SPDX-License-Identifier: MIT
// C-42 review round 3: an install that exits 0 without the project's dev
// dependencies (an `.npmrc` with `omit=dev`) was recorded as installed. The
// sweep now installs dev dependencies whatever the project configures, and
// counts a pin as installed only when every package its root and
// workspaces declare is on disk (scripts/sweep/install.mjs).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  installation,
  missingPackages,
} from "../scripts/sweep/install.mjs";

const run = promisify(execFile);
const json = (value) => JSON.stringify(value, null, 2) + "\n";

test("the sweep's installers are told to install dev dependencies", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sweep-dev-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), json({ name: "app" }));
  await writeFile(join(root, "package-lock.json"), json({ lockfileVersion: 3 }));
  assert.ok((await installation(root, root)).args.includes("--include=dev"));
  await rm(join(root, "package-lock.json"));
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  assert.ok(
    (await installation(root, root)).args.includes("--production=false"),
  );
  await rm(join(root, "pnpm-lock.yaml"));
  await writeFile(join(root, "yarn.lock"), "# yarn lockfile v1\n");
  assert.ok(
    (await installation(root, root)).args.includes("--production=false"),
  );
});

test("every package the root and its workspaces declare must be on disk", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sweep-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (path, text) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  };
  await write(
    "package.json",
    json({
      name: "root",
      workspaces: ["packages/*"],
      devDependencies: { "@types/node": "1.0.0" },
    }),
  );
  await write(
    "packages/web/package.json",
    json({
      name: "web",
      dependencies: { kit: "1.0.0" },
      devDependencies: { "local-only": "1.0.0" },
      optionalDependencies: { maybe: "1.0.0" },
    }),
  );
  // kit is hoisted to the root; local-only sits in the workspace.
  await write("node_modules/kit/package.json", json({ name: "kit" }));
  assert.deepEqual(await missingPackages(root), [
    ".: @types/node",
    "packages/web: local-only",
  ]);
  await write(
    "node_modules/@types/node/package.json",
    json({ name: "@types/node" }),
  );
  await write(
    "packages/web/node_modules/local-only/package.json",
    json({ name: "local-only" }),
  );
  // An optional dependency may be absent.
  assert.deepEqual(await missingPackages(root), []);
});

test("an `omit=dev` project installs its dev typings, and without that it is caught as incomplete", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sweep-omit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "local-types"));
  await writeFile(
    join(root, "local-types", "package.json"),
    json({ name: "local-types", version: "1.0.0", types: "index.d.ts" }),
  );
  await writeFile(
    join(root, "local-types", "index.d.ts"),
    "export declare const typed: number;\n",
  );
  await writeFile(
    join(root, "package.json"),
    json({
      name: "app",
      version: "1.0.0",
      devDependencies: { "local-types": "file:./local-types" },
    }),
  );
  await writeFile(join(root, ".npmrc"), "omit=dev\n");
  const env = { ...process.env, npm_config_cache: join(root, ".npm-cache") };
  // The lockfile, offline (a local package only).
  await run(
    "npm",
    ["install", "--package-lock-only", "--offline", "--ignore-scripts"],
    { cwd: root, env },
  );
  // As the project configures: exit 0, the typings absent, and caught.
  await run("npm", ["ci", "--offline", "--ignore-scripts"], { cwd: root, env });
  assert.deepEqual(await missingPackages(root), [".: local-types"]);
  // As the sweep installs: the typings are there.
  const { args } = await installation(root, root);
  await run("npm", [...args, "--offline"], { cwd: root, env });
  assert.deepEqual(await missingPackages(root), []);
});
