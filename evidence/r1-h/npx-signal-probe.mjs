// R1-H: start `npx ./TARBALL studio|mcp` in WORKDIR, wait for readiness, send
// ONE signal to the npx process, and report the process tree before and after.
//   node npx-signal-probe.mjs WORKDIR studio|mcp SIGINT|SIGTERM
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const [work, mode, signal] = process.argv.slice(2);
const tree = (root) => {
  const rows = execFileSync("ps", ["-eo", "pid=,ppid=,pgid=,args="], { encoding: "utf8" })
    .trim().split("\n").map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map(([, pid, ppid, pgid, args]) => ({ pid: +pid, ppid: +ppid, pgid: +pgid, args: args.slice(0, 120) }));
  const out = [], want = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of rows) if (!want.has(r.pid) && want.has(r.ppid)) { want.add(r.pid); grew = true; }
  }
  for (const r of rows) if (want.has(r.pid)) out.push(r);
  return out;
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const child = spawn("npx", ["--yes", "./pymtheg-1.0.0.tgz", mode, "sample", ...(mode === "studio" ? ["--port", "0"] : [])], {
  cwd: work, stdio: ["pipe", "pipe", "pipe"], detached: true,
});
let text = "";
const ready = new Promise((resolve) => {
  child.stdout.on("data", (c) => { text += c; if (mode === "studio" && /Open in Firefox/.test(text)) resolve(); else if (mode === "mcp" && /"id":1/.test(text)) resolve(); });
});
if (mode === "mcp") child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "p", version: "1" } } }) + "\n");
await ready;
const before = tree(child.pid);
const exited = new Promise((r) => child.on("exit", (code, sig) => r({ code, sig })));
process.kill(child.pid, signal);
// Named safety budget: only turns a hang into a recorded observation; no
// timing property is claimed.
const SAFETY_BUDGET_MS = 20000;
let budget;
const npx = await Promise.race([
  exited,
  new Promise((r) => (budget = setTimeout(() => r({ stillRunningAfterSafetyBudget: true }), SAFETY_BUDGET_MS))),
]);
clearTimeout(budget);
if (npx.stillRunningAfterSafetyBudget) {
  const survivors = tree(child.pid);
  try { process.kill(-child.pid, "SIGKILL"); } catch {}
  for (const p of survivors) try { process.kill(-p.pgid, "SIGKILL"); } catch {}
  console.log(JSON.stringify({ mode, signal, npx, before, survivors }, null, 1));
  process.exit(0);
}
// npx has exited; wait (bounded by state, not time) until every descendant is
// gone or the remaining ones are known to keep running: poll their liveness a
// fixed number of times, yielding to the event loop between polls.
let survivors = [];
for (let i = 0; i < 200; i++) {
  survivors = before.filter((p) => p.pid !== child.pid && alive(p.pid));
  if (!survivors.length) break;
  await new Promise((r) => setImmediate(r));
}
for (const p of survivors) try { process.kill(-p.pgid, "SIGKILL"); } catch {}
console.log(JSON.stringify({ mode, signal, npx, before, survivors }, null, 1));
