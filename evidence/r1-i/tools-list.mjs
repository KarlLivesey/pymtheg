// R1-I: print the MCP server's full tools/list reply (sorted by tool name).
//   node evidence/r1-i/tools-list.mjs PROJECT_DIR > tools.json
// Raw JSON-RPC over stdio against the built dist/; no sleeps, waits for replies.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const project = resolve(process.argv[2] ?? ".");
const bin = resolve("dist/cli/main.js");
const child = spawn(process.execPath, [bin, "mcp", project], { stdio: ["pipe", "pipe", "inherit"] });
const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
let buffer = "";
child.stdout.on("data", (c) => {
  buffer += c;
  for (let i; (i = buffer.indexOf("\n")) >= 0; ) {
    const m = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    if (m.id === 1) {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    } else if (m.id === 2) {
      const tools = [...m.result.tools].sort((a, b) => a.name.localeCompare(b.name));
      process.stdout.write(JSON.stringify({ tools }, null, 1) + "\n");
      child.stdin.end();
    }
  }
});
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "r1-i", version: "1" } } });
