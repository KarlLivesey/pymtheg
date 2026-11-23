// SPDX-License-Identifier: MIT
// Child process for the commit-reader test in test/project-trust.test.mjs:
// reads the commit of each <dir> with the file-based reader and prints one
// JSON array of the answers. The test runs it under a bounded SIGKILL, so a
// read that blocks (a FIFO, an endless device) fails the test instead of
// hanging the suite.
// usage: node commit-reader-child.mjs <dir>...
import { gitCommitFromFiles } from "../dist/shared/safe-git.js";

const answers = [];
for (const dir of process.argv.slice(2))
  answers.push(await gitCommitFromFiles(dir));
process.stdout.write(JSON.stringify(answers) + "\n");
