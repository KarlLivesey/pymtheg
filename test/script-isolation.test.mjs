// SPDX-License-Identifier: MIT
// C-44b: measurement and replay scripts that run `pymtheg init` or index a
// copy keep the user's Pymtheg configuration and cache in their scratch
// (scripts/isolated-home.mjs), as the suite does. Two replay runs once wrote
// trust answers into a real account's configuration.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scripts = new URL("../scripts/", import.meta.url).pathname;
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "fixtures" || name === "node_modules" ? [] : files(path);
    return /\.(mjs|sh)$/.test(name) && !name.endsWith(".test.mjs")
      ? [path]
      : [];
  });
}

test("every script that indexes or runs init isolates the user's configuration and cache", () => {
  const missing = files(scripts).filter((path) => {
    const text = readFileSync(path, "utf8");
    return (
      /indexProject|executeGraph|cli\/main|dist\/cli|pymtheg init|"init"/.test(
        text,
      ) && !/isolated-home\.mjs|PYMTHEG_CONFIG_HOME/.test(text)
    );
  });
  assert.deepEqual(missing, []);
});

test("isolated-home puts both folders in the run's scratch and keeps folders already set", () => {
  const scratch = mkdtempSync(join(tmpdir(), "pym-iso-"));
  const env = { ...process.env, PYM_SCRATCH: scratch };
  delete env.PYMTHEG_CONFIG_HOME;
  delete env.PYMTHEG_CACHE_HOME;
  const probe = `await import(${JSON.stringify(join(scripts, "isolated-home.mjs"))}); console.log(JSON.stringify([process.env.PYMTHEG_CONFIG_HOME, process.env.PYMTHEG_CACHE_HOME]))`;
  const run = (environment) =>
    JSON.parse(
      spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
        env: environment,
        encoding: "utf8",
      }).stdout,
    );
  const [config, cache] = run(env);
  assert.ok(config.startsWith(join(scratch, "pym-config-")), config);
  assert.ok(cache.startsWith(join(scratch, "pym-cache-")), cache);
  assert.deepEqual(
    run({
      ...env,
      PYMTHEG_CONFIG_HOME: "/kept/a",
      PYMTHEG_CACHE_HOME: "/kept/b",
    }),
    ["/kept/a", "/kept/b"],
  );
});
