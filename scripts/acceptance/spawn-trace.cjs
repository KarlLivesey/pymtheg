// SPDX-License-Identifier: MIT
// Preloaded into every Node process of an acceptance scenario through
// NODE_OPTIONS=--require. It appends one JSON line per child process to
// $ACC_SPAWN_LOG, so the harness can see whether Pymtheg starts java, quint,
// go, cargo or rustc, including programs started by absolute path (a PATH shim
// alone cannot see `node .../quint/dist/src/cli.js`). It never changes what
// the child process does.
"use strict";
const log = process.env.ACC_SPAWN_LOG;
if (log) {
  const fs = require("node:fs");
  const childProcess = require("node:child_process");
  const record = (via, file, args) => {
    try {
      fs.appendFileSync(
        log,
        JSON.stringify({
          pid: process.pid,
          parent: process.argv.slice(1, 3),
          via,
          file: String(file),
          args: Array.isArray(args) ? args.map(String).slice(0, 12) : [],
        }) + "\n",
      );
    } catch {
      // Tracing must never break the traced program.
    }
  };
  const proto = childProcess.ChildProcess.prototype;
  const spawn = proto.spawn;
  proto.spawn = function (options) {
    // options.args is the full argv, argv[0] included; record the arguments only.
    record("spawn", options && options.file, options && Array.isArray(options.args) ? options.args.slice(1) : []);
    return spawn.apply(this, arguments);
  };
  for (const name of ["spawnSync", "execFileSync", "execSync"]) {
    const original = childProcess[name];
    childProcess[name] = function (file, args) {
      record(name, file, Array.isArray(args) ? args : []);
      return original.apply(this, arguments);
    };
  }
  require("node:module").syncBuiltinESMExports();
}
