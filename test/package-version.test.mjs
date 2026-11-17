// SPDX-License-Identifier: MIT
// PUB-2: Pymtheg's own version has one source of truth. `--version`, MCP
// server info, doctor and report tool versions all read `identity.version`;
// it must equal the version npm publishes (package.json and the lock root).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { identity } from "../dist/shared/identity-values.js";

const json = (path) =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

test("identity.version equals the package and lock versions", () => {
  const pkg = json("package.json");
  const lock = json("package-lock.json");
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(identity.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
});
