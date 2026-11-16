// SPDX-License-Identifier: MIT
// Test-only preload: observe completion without relying on transfer deletion.
// The production supervisor disconnects only after reaping and removing sources.
import { connect } from "node:net";
import { once } from "node:events";
if (process.argv[1]?.endsWith("/capture-supervisor.js")) {
  const socket = connect(process.env.PYM_TEST_SUPERVISOR_SOCKET);
  await once(socket, "connect");
  socket.write(`${process.pid}\n`);
  socket.unref();
  process.once("beforeExit", () => socket.end("STOPPED\n"));
}
