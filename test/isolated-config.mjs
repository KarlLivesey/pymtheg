// SPDX-License-Identifier: MIT
// Loaded before every test file (npm test: node --import): the user's
// Pymtheg configuration, where trust answers live (D22, C-44), goes to a
// fresh temporary folder, so no test reads or writes the real one. Child
// processes inherit it.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.PYMTHEG_CONFIG_HOME)
  process.env.PYMTHEG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "pym-config-"));
