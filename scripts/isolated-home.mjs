// SPDX-License-Identifier: MIT
// Imported first by every measurement and replay script that runs
// `pymtheg init` or indexes a copy: the user's Pymtheg configuration (trust
// answers, D22 and C-44) and cache go to fresh folders in the run's scratch
// (`$PYM_SCRATCH`, else the temporary folder), as in the test suite
// (test/isolated-config.mjs), so a run never reads or writes the account's
// real ones. Child processes inherit both. Folders already set are kept.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = process.env.PYM_SCRATCH || tmpdir();
mkdirSync(scratch, { recursive: true });
if (!process.env.PYMTHEG_CONFIG_HOME)
  process.env.PYMTHEG_CONFIG_HOME = mkdtempSync(join(scratch, "pym-config-"));
if (!process.env.PYMTHEG_CACHE_HOME)
  process.env.PYMTHEG_CACHE_HOME = mkdtempSync(join(scratch, "pym-cache-"));
