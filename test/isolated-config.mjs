// SPDX-License-Identifier: MIT
// Loaded before every test file (npm test: node --import): the user's
// Pymtheg configuration, where trust answers live (D22, C-44), goes to a
// fresh temporary folder, so no test reads or writes the real one. Child
// processes inherit it, MCP test servers included.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_INHERITED_ENV_VARS } from "@modelcontextprotocol/client/stdio";

process.env.PYMTHEG_TEST = "1";
if (!process.env.PYMTHEG_CONFIG_HOME)
  process.env.PYMTHEG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "pym-config-"));

// MCP test servers start with the SDK's default environment, which lists
// the variables a child inherits; the isolated folder must be one of them.
// PYMTHEG_TEST goes with it, so a child that loses only the folder refuses to
// write (local-trust.ts) rather than touching the real file.
for (const name of ["PYMTHEG_CONFIG_HOME", "PYMTHEG_TEST"])
  if (!DEFAULT_INHERITED_ENV_VARS.includes(name))
    DEFAULT_INHERITED_ENV_VARS.push(name);
